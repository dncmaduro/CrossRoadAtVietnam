import { Canvas } from '@react-three/fiber'
import { Game } from './Game'

type GameSceneProps = {
  onCanvasReady: (canvas: HTMLCanvasElement) => void
}

export function GameScene({ onCanvasReady }: GameSceneProps) {
  return (
    <Canvas
      className="game-canvas"
      onCreated={({ gl }) => onCanvasReady(gl.domElement)}
      camera={{ fov: 72, near: 0.05, far: 100, position: [0, 1.7, -10] }}
      dpr={[1, 1.6]}
      shadows
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#cbdde1']} />
      <fog attach="fog" args={['#cbdde1', 30, 56]} />
      <Game />
    </Canvas>
  )
}
