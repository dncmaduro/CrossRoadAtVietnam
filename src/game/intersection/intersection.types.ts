import type { SignalGroup } from '../levels/level.config'

export type Vec2 = [number, number]
export type TurnType = 'straight' | 'left' | 'right'

export type TrafficPath = {
  id: string
  start: Vec2
  controlA: Vec2
  controlB: Vec2
  end: Vec2
  length: number
  signalGroup: SignalGroup
  turnType: TurnType
}

export type PathVehicleConfig = {
  id: number
  kind: 'car' | 'motorcycle' | 'bus' | 'truck'
  speed: number
  width: number
  length: number
  aggression: number
  spawnDelay: number
  path: TrafficPath
  visualConfig: {
    id: number
    kind: PathVehicleConfig['kind']
    direction: 1 | -1
    width: number
    length: number
    style?: 'scooter' | 'underbone'
  }
}
