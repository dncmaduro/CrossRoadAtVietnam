import { getLaneConfigs, type LevelConfig, type SignalGroup, type TrafficProfile } from '../levels/level.config'
import type { PathVehicleConfig, TrafficPath, Vec2 } from '../intersection/intersection.types'

export type VehicleKind = 'car' | 'motorcycle' | 'bus' | 'truck'
export type MotorcycleStyle = 'scooter' | 'underbone'

export type VehicleConfig = {
  id: number
  kind: VehicleKind
  speed: number
  laneIndex: number
  laneCenterZ: number
  laneWidth: number
  signalGroup?: SignalGroup
  signalStopX?: number
  direction: 1 | -1
  width: number
  length: number
  startX: number
  spawnDelay: number
  reactionDistance: number
  aggression: number
  lateralBias: number
  style?: MotorcycleStyle
}

export const TRAFFIC_TUNING = {
  lateralCandidates: [-1.03, -0.55, 0, 0.55, 1.03],
  perceptionDistance: 15,
  playerPredictionTime: 0.32,
  playerLongitudinalRange: 4.8,
  playerLateralRange: 1.2,
  vehicleEndX: 18,
  car: {
    acceleration: 3.3,
    braking: 8.5,
    reactionTime: 0.62,
    sideMargin: 0.14,
    steerSpeed: 0.28,
  },
  motorcycle: {
    acceleration: 5.2,
    braking: 10.5,
    reactionTime: 0.32,
    sideMargin: 0.1,
    steerSpeed: 1.9,
  },
  large: {
    acceleration: 1.9,
    braking: 5.7,
    reactionTime: 0.9,
    sideMargin: 0.2,
    steerSpeed: 0.18,
  },
} as const

export const CAR_COLORS = ['#d95c4f', '#e4b942', '#4d81a8', '#e7e2d3', '#6f9b7d']
export const MOTORCYCLE_COLORS = ['#1c2730', '#c85d4c', '#2f6e73', '#d0a93f', '#735b7e']
export const LARGE_VEHICLE_COLORS = ['#d0a33f', '#4b7e86', '#9b5947', '#657f68']

function sampleRange(range: [number, number], seed: number) {
  const fraction = ((seed * 37 + 17) % 100) / 100
  return range[0] + (range[1] - range[0]) * fraction
}

export function pickVehicleKind(profile: TrafficProfile, laneIndex: number, vehicleIndex: number): VehicleKind {
  const roll = ((laneIndex * 7 + vehicleIndex * 13 + 3) % 10) / 10
  const busRatio = profile.busRatio ?? 0
  const truckRatio = profile.truckRatio ?? 0
  if (busRatio > 0 && laneIndex === 0 && vehicleIndex === 0) return 'bus'
  if (truckRatio > 0 && laneIndex === 1 && vehicleIndex === 0) return 'truck'
  if (roll < busRatio) return 'bus'
  if (roll < busRatio + truckRatio) return 'truck'
  return roll < profile.motorcycleRatio ? 'motorcycle' : 'car'
}

export function getVehicleDimensions(kind: VehicleKind) {
  if (kind === 'motorcycle') return { width: 0.56, length: 1.45 }
  if (kind === 'bus') return { width: 1.55, length: 5.2 }
  if (kind === 'truck') return { width: 1.6, length: 4.5 }
  return { width: 1.15, length: 2.7 }
}

export function createVehicleConfigs(level: LevelConfig): VehicleConfig[] {
  const configs: VehicleConfig[] = []

  getLaneConfigs(level).forEach((lane) => {
    const profile = lane.trafficProfile
    for (let vehicleIndex = 0; vehicleIndex < profile.vehiclesPerLane; vehicleIndex += 1) {
      const id = configs.length
      const kind = pickVehicleKind(profile, lane.index, vehicleIndex)
      const motorcycle = kind === 'motorcycle'
      const large = kind === 'bus' || kind === 'truck'
      const dimensions = getVehicleDimensions(kind)
      const speed = sampleRange(profile.speedRange, id + lane.index * 3)
      const aggression = large ? sampleRange([profile.aggressionRange[0] * 0.55, profile.aggressionRange[1] * 0.8], id * 2 + lane.index) : sampleRange(profile.aggressionRange, id * 2 + lane.index)
      const directionOffset = lane.direction === 1 ? -1 : 1

      configs.push({
        id,
        kind,
        speed,
        laneIndex: lane.index,
        laneCenterZ: lane.centerZ,
        laneWidth: lane.laneWidth,
        direction: lane.direction,
        width: dimensions.width,
        length: dimensions.length,
        startX: directionOffset * (12 + vehicleIndex * profile.spawnGap + lane.index * 1.2),
        spawnDelay: vehicleIndex === 0 ? lane.index * 0.12 : 0.25 + vehicleIndex * 0.32 + lane.index * 0.08,
        reactionDistance: sampleRange(
          motorcycle ? profile.motorcycleReactionDistance : profile.carReactionDistance,
          id + vehicleIndex,
        ),
        aggression,
        lateralBias: motorcycle ? ((id % 5) - 2) * 0.14 : ((id % 3) - 1) * 0.06,
        style: motorcycle ? (id % 2 === 0 ? 'scooter' : 'underbone') : undefined,
        signalGroup: level.intersection?.signal ? 'eastWest' : undefined,
        signalStopX: level.intersection?.signal ? level.intersection.crossRoadHalfWidth + 0.38 : undefined,
      })
    }
  })

  return configs
}

function approximatePathLength(path: Omit<TrafficPath, 'length'>) {
  let length = 0
  let previous: Vec2 = path.start
  for (let index = 1; index <= 24; index += 1) {
    const t = index / 24
    const next: Vec2 = [
      Math.pow(1 - t, 3) * path.start[0] + 3 * Math.pow(1 - t, 2) * t * path.controlA[0] + 3 * (1 - t) * t * t * path.controlB[0] + Math.pow(t, 3) * path.end[0],
      Math.pow(1 - t, 3) * path.start[1] + 3 * Math.pow(1 - t, 2) * t * path.controlA[1] + 3 * (1 - t) * t * t * path.controlB[1] + Math.pow(t, 3) * path.end[1],
    ]
    length += Math.hypot(next[0] - previous[0], next[1] - previous[1])
    previous = next
  }
  return length
}

function makePath(
  id: string,
  start: Vec2,
  controlA: Vec2,
  controlB: Vec2,
  end: Vec2,
  signalGroup: SignalGroup,
  turnType: 'straight' | 'left' | 'right',
): TrafficPath {
  const path = { id, start, controlA, controlB, end, signalGroup, turnType }
  return { ...path, length: approximatePathLength(path) }
}

function createPathForIndex(index: number, pathLength: number, turn: boolean): TrafficPath {
  const lane = index % 2 === 0 ? -1.5 : 1.5
  const side = index % 4 < 2 ? 1 : -1
  const variant = turn ? index % 4 : index % 2
  if (!turn && variant === 0) {
    return makePath(`horizontal-${index}`, [-pathLength, lane], [-pathLength * 0.3, lane], [pathLength * 0.3, lane], [pathLength, lane], 'eastWest', 'straight')
  }
  if (!turn && variant === 1) {
    return makePath(`vertical-${index}`, [lane, -pathLength], [lane, -pathLength * 0.3], [lane, pathLength * 0.3], [lane, pathLength], 'northSouth', 'straight')
  }
  if (variant === 0) {
    return makePath(`west-to-north-${index}`, [-pathLength, lane], [-pathLength * 0.32, lane], [lane, pathLength * 0.34], [lane, pathLength], 'eastWest', 'left')
  }
  if (variant === 1) {
    return makePath(`east-to-south-${index}`, [pathLength, lane], [pathLength * 0.32, lane], [-lane, -pathLength * 0.34], [-lane, -pathLength], 'eastWest', 'right')
  }
  if (variant === 2) {
    return makePath(`south-to-east-${index}`, [lane, -pathLength], [lane, -pathLength * 0.32], [pathLength * 0.34, -lane], [pathLength, -lane], 'northSouth', side > 0 ? 'right' : 'left')
  }
  return makePath(`north-to-west-${index}`, [-lane, pathLength], [-lane, pathLength * 0.32], [-pathLength * 0.34, lane], [-pathLength, lane], 'northSouth', side > 0 ? 'left' : 'right')
}

export function createPathVehicleConfigs(level: LevelConfig): PathVehicleConfig[] {
  const intersection = level.intersection
  if (!intersection) return []
  const profile = level.laneGroups[0].trafficProfile
  const configs: PathVehicleConfig[] = []

  for (let index = 0; index < intersection.pathVehicleCount; index += 1) {
    const turnRoll = ((index * 29 + 11) % 100) / 100
    const turn = turnRoll < intersection.turnProbability
    const path = createPathForIndex(index, intersection.pathLength, turn)
    const kind = pickVehicleKind(profile, 10 + index, index)
    const dimensions = getVehicleDimensions(kind)
    const speed = sampleRange(profile.speedRange, index + 19) * (path.turnType === 'straight' ? 1 : 0.84)
    const visualConfig = {
      id: 100 + index,
      kind,
      direction: 1 as const,
      width: dimensions.width,
      length: dimensions.length,
      style: kind === 'motorcycle' ? (index % 2 === 0 ? 'scooter' as const : 'underbone' as const) : undefined,
    }
    configs.push({
      id: 100 + index,
      kind,
      speed,
      width: dimensions.width,
      length: dimensions.length,
      aggression: sampleRange(profile.aggressionRange, index * 3 + 7),
      spawnDelay: 0.35 + index * 0.44,
      path,
      visualConfig,
    })
  }

  return configs
}
