import type { VehicleKind } from './traffic.config'

export type PlayerTrafficState = {
  active: boolean
  x: number
  z: number
  vx: number
  vz: number
}

export type TrafficSnapshot = {
  id: number
  kind: VehicleKind
  laneIndex: number
  direction: 1 | -1
  laneCenterZ: number
  laneWidth: number
  x: number
  z: number
  speed: number
  width: number
  length: number
  aggression: number
  active: boolean
  routeId?: string
}
