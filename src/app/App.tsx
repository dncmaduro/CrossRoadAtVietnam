import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { PointerLockControls as PointerLockControlsImpl } from 'three-stdlib'
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
  const controls = useRef<PointerLockControlsImpl>(null)
  const status = useGameStore((state) => state.status)
  const start = useGameStore((state) => state.start)
  const restart = useGameStore((state) => state.restart)
  const advanceLevel = useGameStore((state) => state.advanceLevel)
  const setLevelForDebug = useGameStore((state) => state.setLevelForDebug)
  const setResultForDebug = useGameStore((state) => state.setResultForDebug)
  const levelIndex = useGameStore((state) => state.levelIndex)
  const pointerLockAvailable = canUsePointerLock()
  const [sceneReady, setSceneReady] = useState(false)
  const sceneRequestedLock = useRef(false)
  const handleSceneReady = useCallback(() => {
    setSceneReady(true)
    if (sceneRequestedLock.current) {
      sceneRequestedLock.current = false
      controls.current?.lock()
    }
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
    if (status !== 'playing') controls.current?.unlock()
  }, [status])

  useEffect(() => {
    const releasePointerLock = () => {
      if (document.visibilityState !== 'visible') controls.current?.unlock()
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
    action()
    // Embedded previews can expose the API without allowing the document to own pointer lock.
    // A normal standalone deployment is top-level and can lock from this user gesture.
    if (pointerLockAvailable && controls.current) {
      controls.current?.lock()
    } else if (pointerLockAvailable && !sceneReady) {
      // The scene is lazy-loaded, so preserve the intent if the first click wins the race.
      sceneRequestedLock.current = true
    }
  }

  return (
    <main className="game-shell">
      <SceneErrorBoundary>
        <Suspense fallback={null}>
          <GameScene controls={controls} pointerLockAvailable={pointerLockAvailable} onReady={handleSceneReady} />
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
          onContinue={status === 'won' ? advanceLevel : undefined}
          onRestart={() => lockAndPlay(restart)}
        />
      )}

      <div className="desktop-warning">Màn hình rộng được khuyến nghị.</div>
    </main>
  )
}

export default App
