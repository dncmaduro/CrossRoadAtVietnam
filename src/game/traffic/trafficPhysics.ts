import { interactionGroups } from '@react-three/rapier'
import type { PlayerTrafficState } from './traffic.types'

const PLAYER_GROUP = 0
const TRAFFIC_GROUP = 1
const WORLD_GROUP = 2
const PLAYER_RADIUS = 0.35

// @dimforge/rapier3d-compat 0.19.2: ActiveCollisionTypes.ALL.
export const ACTIVE_COLLISION_TYPES_ALL = 60943

export const PLAYER_COLLISION_GROUPS = interactionGroups([PLAYER_GROUP], [PLAYER_GROUP, TRAFFIC_GROUP, WORLD_GROUP])
export const TRAFFIC_COLLISION_GROUPS = interactionGroups([TRAFFIC_GROUP], [PLAYER_GROUP])
export const WORLD_COLLISION_GROUPS = interactionGroups([WORLD_GROUP], [PLAYER_GROUP])

type VehicleCollisionSample = {
  x: number
  z: number
  heading: number
}

function overlapsVehicle(
  vehicle: VehicleCollisionSample,
  length: number,
  width: number,
  playerX: number,
  playerZ: number,
) {
  const cos = Math.cos(vehicle.heading)
  const sin = Math.sin(vehicle.heading)
  const offsetX = playerX - vehicle.x
  const offsetZ = playerZ - vehicle.z
  const localX = cos * offsetX - sin * offsetZ
  const localZ = sin * offsetX + cos * offsetZ

  return Math.abs(localX) <= length / 2 + PLAYER_RADIUS && Math.abs(localZ) <= width / 2 + PLAYER_RADIUS
}

export function didVehicleHitPlayer({
  previous,
  next,
  length,
  width,
  playerState,
  frameDelta,
}: {
  previous: VehicleCollisionSample
  next: VehicleCollisionSample
  length: number
  width: number
  playerState: PlayerTrafficState
  frameDelta: number
}) {
  if (!playerState.active) return false

  const playerSamples = [
    { x: playerState.x, z: playerState.z },
    { x: playerState.x + playerState.vx * frameDelta, z: playerState.z + playerState.vz * frameDelta },
  ]

  return [previous, next].some((vehicle) => playerSamples.some((player) => (
    overlapsVehicle(vehicle, length, width, player.x, player.z)
  )))
}
