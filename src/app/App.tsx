import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { gameAudio } from '../game/audio/AudioManager'
import { LEVELS } from '../game/levels/level.config'
import { useGameStore } from '../store/gameStore'
import { ResultOverlay, StartOverlay } from '../ui/Overlays'
import { SceneErrorBoundary } from './SceneErrorBoundary'

const GameScene = lazy(() => import('./GameScene').then(({ GameScene: Scene }) => ({ default: Scene })))

function canUsePointerLock() {
  if (window.self !== window.top || !('requestPointerLock' in HTMLCanvasElement.prototype)) return false

  const page = document as Document & {
    featurePolicy?: { allowsFeature: (feature: string) => boolean }
    permissionsPolicy?: { allowsFeature: (feature: string) => boolean }
  }
  return page.permissionsPolicy?.allowsFeature('pointer-lock') ?? page.featurePolicy?.allowsFeature('pointer-lock') ?? true
}

function App() {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const status = useGameStore((state) => state.status)
  const start = useGameStore((state) => state.start)
  const restart = useGameStore((state) => state.restart)
  const advanceLevel = useGameStore((state) => state.advanceLevel)
  const setLevelForDebug = useGameStore((state) => state.setLevelForDebug)
  const setResultForDebug = useGameStore((state) => state.setResultForDebug)
  const levelIndex = useGameStore((state) => state.levelIndex)
  const pointerLockAvailable = canUsePointerLock()
  const [pointerLocked, setPointerLocked] = useState(false)
  const handleCanvasReady = useCallback((element: HTMLCanvasElement) => {
    canvas.current = element
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onDebugLevel = (event: KeyboardEvent) => {
      if (event.key >= '1' && event.key <= '8') setLevelForDebug(Number(event.key) - 1)
      if (event.key.toLowerCase() === 'q') setResultForDebug('won')
      if (event.key.toLowerCase() === 'e') setResultForDebug('lost')
    }
    window.addEventListener('keydown', onDebugLevel)
    return () => window.removeEventListener('keydown', onDebugLevel)
  }, [setLevelForDebug, setResultForDebug])

  useEffect(() => {
    const onPointerLockChange = () => setPointerLocked(document.pointerLockElement === canvas.current)
    const onPointerLockError = () => setPointerLocked(false)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('pointerlockerror', onPointerLockError)
    return () => {
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('pointerlockerror', onPointerLockError)
    }
  }, [])

  useEffect(() => {
    if (status !== 'playing' && document.pointerLockElement === canvas.current) document.exitPointerLock()
  }, [status])

  useEffect(() => {
    const releasePointerLock = () => {
      if (document.visibilityState !== 'visible' && document.pointerLockElement === canvas.current) document.exitPointerLock()
    }
    window.addEventListener('blur', releasePointerLock)
    document.addEventListener('visibilitychange', releasePointerLock)
    return () => {
      window.removeEventListener('blur', releasePointerLock)
      document.removeEventListener('visibilitychange', releasePointerLock)
    }
  }, [])

  const lockAndPlay = (action: () => void) => {
    // Audio is created only from the start/restart gesture to satisfy browser autoplay policy.
    gameAudio.activate()
    gameAudio.beginRound()
    // Embedded previews can expose the API without allowing the document to own pointer lock.
    // A normal standalone deployment is top-level and can lock the actual WebGL canvas from this gesture.
    if (pointerLockAvailable) {
      try {
        const request = canvas.current?.requestPointerLock()
        if (request) request.catch(() => undefined)
      } catch {
        // Pointer Lock failure must not prevent gameplay from starting.
      }
    }
    action()
  }

  return (
    <main className="game-shell">
      <SceneErrorBoundary>
        <Suspense fallback={null}>
          <GameScene onCanvasReady={handleCanvasReady} />
        </Suspense>
      </SceneErrorBoundary>

      {status === 'ready' && (
        <StartOverlay
          levelName={LEVELS[levelIndex].name}
          pointerLockAvailable={pointerLockAvailable}
          onStart={() => lockAndPlay(start)}
        />
      )}
      {(status === 'lost' || status === 'won') && (
        <ResultOverlay
          status={status}
          isFinalLevel={levelIndex === LEVELS.length - 1}
          onContinue={status === 'won' ? () => lockAndPlay(advanceLevel) : undefined}
          onRestart={() => lockAndPlay(restart)}
        />
      )}

      {status === 'playing' && (!pointerLockAvailable || !pointerLocked) && (
        <p className="pointer-lock-hint pointer-lock-hint-game">Bấm vào game để điều khiển chuột</p>
      )}

      <div className="desktop-warning">Màn hình rộng được khuyến nghị.</div>
    </main>
  )
}

export default App
