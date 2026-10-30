import { Physics } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import { LEVELS } from '../game/levels/level.config'
import { createIntersectionRuntime } from '../game/intersection/intersection.runtime'
import { useGameStore } from '../store/gameStore'
import { Player } from '../game/player/Player'
import { TrafficManager } from '../game/traffic/TrafficManager'
import type { PlayerTrafficState } from '../game/traffic/traffic.types'
import { World } from '../game/world/World'

export function Game() {
  const roundId = useGameStore((state) => state.roundId)
  const levelIndex = useGameStore((state) => state.levelIndex)
  const level = LEVELS[levelIndex]
  const intersectionRuntime = useMemo(() => createIntersectionRuntime(level.intersection), [level, roundId])
  const playerState = useRef<PlayerTrafficState>({ active: false, x: level.playerSpawn[0], z: level.playerSpawn[2], vx: 0, vz: 0 })

  useEffect(() => {
    playerState.current.active = false
    playerState.current.x = level.playerSpawn[0]
    playerState.current.z = level.playerSpawn[2]
    playerState.current.vx = 0
    playerState.current.vz = 0
  }, [level, roundId])

  return (
    <Physics key={`${roundId}-${level.id}`} gravity={[0, -9.81, 0]} interpolate={false}>
      <hemisphereLight args={['#dbe9ed', '#70806d', 1.6]} />
      <ambientLight intensity={1.15} color="#fff7e6" />
      <directionalLight
        position={[-10, 16, -12]}
        intensity={2.15}
        color="#fff4d6"
        castShadow
        shadow-bias={-0.00025}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
      />
      <World level={level} intersectionRuntime={intersectionRuntime} />
      <TrafficManager level={level} playerState={playerState.current} intersectionRuntime={intersectionRuntime} />
      <Player level={level} trafficState={playerState.current} />
    </Physics>
  )
}
