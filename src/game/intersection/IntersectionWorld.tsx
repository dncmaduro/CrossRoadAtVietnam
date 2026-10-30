import { useRef } from 'react'
import { Box, Cylinder, Sphere } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { LevelConfig, SignalGroup } from '../levels/level.config'
import { useGameStore } from '../../store/gameStore'
import type { IntersectionRuntime, SignalLight } from './intersection.runtime'

function SignalHead({ group, position, rotation = [0, 0, 0], runtime }: { group: SignalGroup; position: [number, number, number]; rotation?: [number, number, number]; runtime: IntersectionRuntime | null }) {
  const bulbs = useRef<Array<THREE.Mesh | null>>([])
  const lastLight = useRef<SignalLight | null>(null)

  useFrame(() => {
    const light = runtime?.getLight(group) ?? 'red'
    if (lastLight.current === light) return
    lastLight.current = light
    const activeIndex = light === 'red' ? 0 : light === 'yellow' ? 1 : 2
    bulbs.current.forEach((bulb, index) => {
      if (!bulb) return
      const material = bulb.material as THREE.MeshStandardMaterial
      const active = index === activeIndex
      material.emissiveIntensity = active ? 0.8 : 0.03
      material.opacity = active ? 1 : 0.48
    })
  })

  return (
    <group position={position} rotation={rotation}>
      <Box args={[0.5, 1.5, 0.42]} castShadow>
        <meshStandardMaterial color="#202a2b" roughness={0.68} />
      </Box>
      {[
        ['#c85047', '#6b1918'],
        ['#dfb64e', '#725419'],
        ['#5eaa68', '#1e5427'],
      ].map(([color, emissive], index) => (
        <Sphere
          key={color}
          ref={(node) => { bulbs.current[index] = node }}
          args={[0.105, 10, 8]}
          position={[0, 0.42 - index * 0.42, 0.23]}
        >
          <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.03} transparent />
        </Sphere>
      ))}
    </group>
  )
}

export function IntersectionWorld({ level, runtime }: { level: LevelConfig; runtime: IntersectionRuntime | null }) {
  const status = useGameStore((state) => state.status)
  const config = level.intersection

  useFrame((_, delta) => runtime?.tick(delta, status === 'playing'))

  if (!config) return null

  const crossRoadLength = level.roadHalfWidth + level.sidewalkWidth
  const stopOffset = config.crossRoadHalfWidth + 0.38
  const signalOffset = config.crossRoadHalfWidth + 1.5
  const cornerOffset = config.crossRoadHalfWidth + 1.1

  return (
    <group>
      <Box args={[config.crossRoadHalfWidth * 2, 0.11, crossRoadLength * 2]} position={[0, -0.025, 0]} receiveShadow>
        <meshStandardMaterial color="#384346" roughness={0.98} />
      </Box>
      <Box args={[0.08, 0.02, crossRoadLength * 2]} position={[0, 0.04, 0]}>
        <meshStandardMaterial color="#cfd4d0" />
      </Box>
      {[-1.5, 1.5].map((x) => (
        <Box key={x} args={[0.08, 0.024, crossRoadLength * 2]} position={[x, 0.045, 0]}>
          <meshStandardMaterial color="#596365" roughness={1} />
        </Box>
      ))}

      {[-stopOffset, stopOffset].map((x) => (
        <Box key={`x-stop-${x}`} args={[0.16, 0.04, level.roadHalfWidth * 2]} position={[x, 0.06, 0]}>
          <meshStandardMaterial color="#f0dfae" />
        </Box>
      ))}
      {[-stopOffset, stopOffset].map((z) => (
        <Box key={`z-stop-${z}`} args={[config.crossRoadHalfWidth * 2, 0.04, 0.16]} position={[0, 0.06, z]}>
          <meshStandardMaterial color="#f0dfae" />
        </Box>
      ))}

      {[-1.4, -0.7, 0, 0.7, 1.4].map((x) => (
        <Box key={`crosswalk-${x}`} args={[0.22, 0.035, level.roadHalfWidth * 2 - 0.5]} position={[x, 0.07, 0]}>
          <meshStandardMaterial color="#e5e4d2" roughness={0.9} />
        </Box>
      ))}

      {config.signal && [
        { group: 'eastWest' as const, position: [-signalOffset, 3.1, -cornerOffset] as [number, number, number], rotation: [0, Math.PI / 2, 0] as [number, number, number] },
        { group: 'eastWest' as const, position: [signalOffset, 3.1, cornerOffset] as [number, number, number], rotation: [0, -Math.PI / 2, 0] as [number, number, number] },
        { group: 'northSouth' as const, position: [cornerOffset, 3.1, -signalOffset] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] },
        { group: 'northSouth' as const, position: [-cornerOffset, 3.1, signalOffset] as [number, number, number], rotation: [0, Math.PI, 0] as [number, number, number] },
      ].map((signal) => (
        <group key={`${signal.group}-${signal.position.join('-')}`}>
          <Cylinder args={[0.08, 0.11, 3.1, 7]} position={[signal.position[0], 1.55, signal.position[2]]} castShadow>
            <meshStandardMaterial color="#4e5753" roughness={0.84} />
          </Cylinder>
          <SignalHead group={signal.group} position={signal.position} rotation={signal.rotation} runtime={runtime} />
        </group>
      ))}
    </group>
  )
}
