import { useMemo, useRef } from 'react'
import { GameAudio } from '../audio/GameAudio'
import type { LevelConfig } from '../levels/level.config'
import type { IntersectionRuntime } from '../intersection/intersection.runtime'
import { createPathVehicleConfigs, createVehicleConfigs, getTrafficBoundaryX } from './traffic.config'
import type { PlayerTrafficState, TrafficSnapshot } from './traffic.types'
import { PathVehicle } from './PathVehicle'
import { Vehicle } from './Vehicle'

export type SpawnInstruction = {
  x: number
  delay: number
}

type TrafficManagerProps = {
  playerState: PlayerTrafficState
  level: LevelConfig
  intersectionRuntime: IntersectionRuntime | null
}

export function TrafficManager({ playerState, level, intersectionRuntime }: TrafficManagerProps) {
  const vehicles = useMemo(() => createVehicleConfigs(level), [level])
  const pathVehicles = useMemo(() => createPathVehicleConfigs(level), [level])
  const trafficBoundaryX = getTrafficBoundaryX(level)
  const resetOffsets = useRef<number[]>([])
  const positions = useRef(
    new Map<number, TrafficSnapshot>(
      [
        ...vehicles.map((config) => [
          config.id,
          {
            id: config.id,
            kind: config.kind,
            laneIndex: config.laneIndex,
            direction: config.direction,
            x: config.startX,
            z: config.laneCenterZ,
            speed: config.spawnDelay === 0 ? config.speed : 0,
            width: config.width,
            length: config.length,
            aggression: config.aggression,
            active: config.spawnDelay === 0,
            laneCenterZ: config.laneCenterZ,
            laneWidth: config.laneWidth,
          } satisfies TrafficSnapshot,
        ] as [number, TrafficSnapshot]),
        ...pathVehicles.map((config) => [
          config.id,
          {
            id: config.id,
            kind: config.kind,
            laneIndex: -1,
            direction: 1,
            x: config.path.start[0],
            z: config.path.start[1],
            speed: 0,
            width: config.width,
            length: config.length,
            aggression: config.aggression,
            active: false,
            laneCenterZ: 0,
            laneWidth: 1,
            routeId: config.path.id,
          } satisfies TrafficSnapshot,
        ] as [number, TrafficSnapshot]),
      ],
    ),
  )

  const updateVehiclePosition = (id: number, x: number, z: number, speed: number, active: boolean, routeId?: string) => {
    const snapshot = positions.current.get(id)
    if (!snapshot) return
    snapshot.x = x
    snapshot.z = z
    snapshot.speed = speed
    snapshot.active = active
    snapshot.routeId = routeId
  }

  const getTraffic = () => positions.current

  const resetVehicle = (id: number): SpawnInstruction => {
    const config = vehicles.find((vehicle) => vehicle.id === id)
    if (!config) return { x: 0, delay: 0.5 }
    const offset = (resetOffsets.current[id] ?? 0) + 1
    resetOffsets.current[id] = offset
    const spawnX = config.direction === 1 ? -trafficBoundaryX : trafficBoundaryX
    const laneVehicles = vehicles.filter((vehicle) => vehicle.laneIndex === config.laneIndex && vehicle.id !== id)
    const spawnBlocked = laneVehicles.some((vehicle) => {
      const position = positions.current.get(vehicle.id)
      return position?.active === true && Math.abs(position.x - spawnX) < 5.5
    })

    return {
      x: spawnX - config.direction * ((offset % 2) * 1.5),
      delay: (spawnBlocked ? 1.35 : 0.35) + (offset % 3) * 0.18,
    }
  }

  return (
    <group>
      {vehicles.map((config) => (
        <Vehicle
          key={config.id}
          config={config}
          trafficBoundaryX={trafficBoundaryX}
          getTraffic={getTraffic}
          onReset={resetVehicle}
          onUpdate={updateVehiclePosition}
          playerState={playerState}
          intersectionRuntime={intersectionRuntime}
        />
      ))}
      {pathVehicles.map((config) => (
        <PathVehicle
          key={config.id}
          config={config}
          getTraffic={getTraffic}
          onUpdate={updateVehiclePosition}
          playerState={playerState}
          intersectionRuntime={intersectionRuntime}
        />
      ))}
      <GameAudio getTraffic={getTraffic} playerState={playerState} />
    </group>
  )
}
