import { useEffect, type RefObject } from 'react'
import { Canvas } from '@react-three/fiber'
import { PointerLockControls } from '@react-three/drei'
import type { PointerLockControls as PointerLockControlsImpl } from 'three-stdlib'
import { Game } from './Game'

type GameSceneProps = {
  controls: RefObject<PointerLockControlsImpl | null>
  pointerLockAvailable: boolean
  onReady: () => void
}

export function GameScene({ controls, pointerLockAvailable, onReady }: GameSceneProps) {
  useEffect(() => {
    onReady()
  }, [onReady])

  return (
    <Canvas
      className="game-canvas"
      camera={{ fov: 72, near: 0.05, far: 100, position: [0, 1.7, -10] }}
      dpr={[1, 1.6]}
      shadows
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#cbdde1']} />
      <fog attach="fog" args={['#cbdde1', 30, 56]} />
      <PointerLockControls ref={controls} selector="canvas" enabled={pointerLockAvailable} />
      <Game />
    </Canvas>
  )
}
