export type TravelDirection = 1 | -1
export type EnvironmentPreset = 'smallStreet' | 'urban' | 'median' | 'motorcycle' | 'arterial' | 'intersection' | 'rushHour'
export type LevelScenario = 'straight' | 'signalizedIntersection' | 'turningIntersection' | 'rushHour'

export type TrafficProfile = {
  vehiclesPerLane: number
  motorcycleRatio: number
  busRatio?: number
  truckRatio?: number
  speedRange: [number, number]
  aggressionRange: [number, number]
  spawnGap: number
  carReactionDistance: [number, number]
  motorcycleReactionDistance: [number, number]
}

export type SignalGroup = 'eastWest' | 'northSouth'

export type SignalConfig = {
  greenDuration: number
  yellowDuration: number
  allRedDuration: number
  initialGroup?: SignalGroup
}

export type IntersectionConfig = {
  crossRoadHalfWidth: number
  pathLength: number
  turnProbability: number
  pathVehicleCount: number
  signal?: SignalConfig
}

export type LaneGroupConfig = {
  laneCount: number
  direction: TravelDirection
  laneWidth: number
  firstLaneCenter: number
  trafficProfile: TrafficProfile
}

export type MedianConfig = {
  width: number
  refugeLength: number
  openingWidth: number
}

export type LevelConfig = {
  id: string
  name: string
  scenario: LevelScenario
  environmentPreset: EnvironmentPreset
  roadLength: number
  roadHalfWidth: number
  sidewalkWidth: number
  playerSpawn: [number, number, number]
  playerBounds: { xMin: number; xMax: number; zMin: number; zMax: number }
  finishZone: { minZ: number; maxZ: number }
  laneGroups: LaneGroupConfig[]
  median?: MedianConfig
  intersection?: IntersectionConfig
}

const quietStreet: TrafficProfile = {
  vehiclesPerLane: 2,
  motorcycleRatio: 0.78,
  speedRange: [3.2, 4.2],
  aggressionRange: [0.25, 0.48],
  spawnGap: 8.2,
  carReactionDistance: [2.3, 2.5],
  motorcycleReactionDistance: [1.15, 1.3],
}

const urbanTraffic: TrafficProfile = {
  vehiclesPerLane: 3,
  motorcycleRatio: 0.5,
  speedRange: [3.6, 5.1],
  aggressionRange: [0.18, 0.66],
  spawnGap: 6.7,
  carReactionDistance: [2.2, 2.45],
  motorcycleReactionDistance: [1.12, 1.28],
}

const motorcycleFlow: TrafficProfile = {
  vehiclesPerLane: 4,
  motorcycleRatio: 0.84,
  speedRange: [4.2, 5.9],
  aggressionRange: [0.42, 0.82],
  spawnGap: 5.7,
  carReactionDistance: [2.2, 2.4],
  motorcycleReactionDistance: [1.05, 1.22],
}

const arterialTraffic: TrafficProfile = {
  vehiclesPerLane: 3,
  motorcycleRatio: 0.58,
  speedRange: [4.2, 5.8],
  aggressionRange: [0.25, 0.7],
  spawnGap: 6.4,
  carReactionDistance: [2.25, 2.5],
  motorcycleReactionDistance: [1.08, 1.25],
}

const rushHourTraffic: TrafficProfile = {
  vehiclesPerLane: 2,
  motorcycleRatio: 0.52,
  busRatio: 0.1,
  truckRatio: 0.1,
  speedRange: [3.6, 5.2],
  aggressionRange: [0.22, 0.72],
  spawnGap: 7.1,
  carReactionDistance: [2.4, 2.75],
  motorcycleReactionDistance: [1.05, 1.24],
}

function createPlayerBounds(roadLength: number, roadHalfWidth: number, sidewalkWidth: number) {
  const sidewalkCenter = roadHalfWidth + sidewalkWidth / 2
  const longitudinalLimit = Math.min(roadLength / 2 - 2, 26)
  return {
    xMin: -longitudinalLimit,
    xMax: longitudinalLimit,
    zMin: -(sidewalkCenter + 1.95),
    zMax: sidewalkCenter + 1.95,
  }
}

function createLevel(
  input: Omit<LevelConfig, 'playerSpawn' | 'playerBounds' | 'finishZone'>,
): LevelConfig {
  const sidewalkCenter = input.roadHalfWidth + input.sidewalkWidth / 2
  return {
    ...input,
    playerSpawn: [0, 1, -sidewalkCenter],
    playerBounds: createPlayerBounds(input.roadLength, input.roadHalfWidth, input.sidewalkWidth),
    finishZone: { minZ: input.roadHalfWidth + 0.3, maxZ: sidewalkCenter + 1.95 },
  }
}

export const LEVELS: LevelConfig[] = [
  createLevel({
    id: 'small-street',
    name: 'NGÕ 2 LÀN',
    scenario: 'straight',
    environmentPreset: 'smallStreet',
    roadLength: 60,
    roadHalfWidth: 3,
    sidewalkWidth: 4.4,
    laneGroups: [
      { laneCount: 1, direction: 1, laneWidth: 3, firstLaneCenter: -1.5, trafficProfile: quietStreet },
      { laneCount: 1, direction: -1, laneWidth: 3, firstLaneCenter: 1.5, trafficProfile: quietStreet },
    ],
  }),
  createLevel({
    id: 'four-lane-street',
    name: 'ĐƯỜNG 4 LÀN',
    scenario: 'straight',
    environmentPreset: 'urban',
    roadLength: 60,
    roadHalfWidth: 7,
    sidewalkWidth: 4.4,
    laneGroups: [
      { laneCount: 2, direction: 1, laneWidth: 3, firstLaneCenter: -4.5, trafficProfile: urbanTraffic },
      { laneCount: 2, direction: -1, laneWidth: 3, firstLaneCenter: 1.5, trafficProfile: urbanTraffic },
    ],
  }),
  createLevel({
    id: 'median-crossing',
    name: 'DẢI PHÂN CÁCH',
    scenario: 'straight',
    environmentPreset: 'median',
    roadLength: 60,
    roadHalfWidth: 6.5,
    sidewalkWidth: 4.4,
    median: { width: 1, refugeLength: 5, openingWidth: 4.8 },
    laneGroups: [
      { laneCount: 2, direction: 1, laneWidth: 3, firstLaneCenter: -5, trafficProfile: urbanTraffic },
      { laneCount: 2, direction: -1, laneWidth: 3, firstLaneCenter: 2, trafficProfile: urbanTraffic },
    ],
  }),
  createLevel({
    id: 'motorcycle-flow',
    name: 'DÒNG XE MÁY',
    scenario: 'straight',
    environmentPreset: 'motorcycle',
    roadLength: 60,
    roadHalfWidth: 7,
    sidewalkWidth: 4.4,
    laneGroups: [
      { laneCount: 2, direction: 1, laneWidth: 3, firstLaneCenter: -4.5, trafficProfile: motorcycleFlow },
      { laneCount: 2, direction: -1, laneWidth: 3, firstLaneCenter: 1.5, trafficProfile: motorcycleFlow },
    ],
  }),
  createLevel({
    id: 'wide-arterial',
    name: 'ĐẠI LỘ 6 LÀN',
    scenario: 'straight',
    environmentPreset: 'arterial',
    roadLength: 64,
    roadHalfWidth: 10,
    sidewalkWidth: 4.6,
    median: { width: 1.1, refugeLength: 5.4, openingWidth: 5.2 },
    laneGroups: [
      { laneCount: 3, direction: 1, laneWidth: 3, firstLaneCenter: -7.5, trafficProfile: arterialTraffic },
      { laneCount: 3, direction: -1, laneWidth: 3, firstLaneCenter: 1.5, trafficProfile: arterialTraffic },
    ],
  }),
  createLevel({
    id: 'signalized-intersection',
    name: 'NGÃ TƯ ĐÈN ĐỎ',
    scenario: 'signalizedIntersection',
    environmentPreset: 'intersection',
    roadLength: 60,
    roadHalfWidth: 7,
    sidewalkWidth: 4.4,
    laneGroups: [
      { laneCount: 2, direction: 1, laneWidth: 3, firstLaneCenter: -4.5, trafficProfile: urbanTraffic },
      { laneCount: 2, direction: -1, laneWidth: 3, firstLaneCenter: 1.5, trafficProfile: urbanTraffic },
    ],
    intersection: {
      crossRoadHalfWidth: 3.6,
      pathLength: 13.5,
      turnProbability: 0.18,
      pathVehicleCount: 8,
      signal: { greenDuration: 7, yellowDuration: 1.5, allRedDuration: 0.8, initialGroup: 'eastWest' },
    },
  }),
  createLevel({
    id: 'turning-intersection',
    name: 'XE RẼ',
    scenario: 'turningIntersection',
    environmentPreset: 'intersection',
    roadLength: 60,
    roadHalfWidth: 7,
    sidewalkWidth: 4.4,
    laneGroups: [
      { laneCount: 2, direction: 1, laneWidth: 3, firstLaneCenter: -4.5, trafficProfile: urbanTraffic },
      { laneCount: 2, direction: -1, laneWidth: 3, firstLaneCenter: 1.5, trafficProfile: urbanTraffic },
    ],
    intersection: { crossRoadHalfWidth: 3.6, pathLength: 13.5, turnProbability: 0.5, pathVehicleCount: 10 },
  }),
  createLevel({
    id: 'rush-hour',
    name: 'GIỜ CAO ĐIỂM',
    scenario: 'rushHour',
    environmentPreset: 'rushHour',
    roadLength: 68,
    roadHalfWidth: 10,
    sidewalkWidth: 4.6,
    median: { width: 1.1, refugeLength: 5.6, openingWidth: 5.2 },
    laneGroups: [
      { laneCount: 3, direction: 1, laneWidth: 3, firstLaneCenter: -7.5, trafficProfile: rushHourTraffic },
      { laneCount: 3, direction: -1, laneWidth: 3, firstLaneCenter: 1.5, trafficProfile: rushHourTraffic },
    ],
    intersection: {
      crossRoadHalfWidth: 3.8,
      pathLength: 15,
      turnProbability: 0.22,
      pathVehicleCount: 10,
      signal: { greenDuration: 6.5, yellowDuration: 1.4, allRedDuration: 0.8, initialGroup: 'eastWest' },
    },
  }),
]

export type LaneConfig = {
  index: number
  centerZ: number
  laneWidth: number
  direction: TravelDirection
  trafficProfile: TrafficProfile
}

export function getLaneConfigs(level: LevelConfig) {
  const lanes: LaneConfig[] = []
  level.laneGroups.forEach((group) => {
    for (let lane = 0; lane < group.laneCount; lane += 1) {
      lanes.push({
        index: lanes.length,
        centerZ: group.firstLaneCenter + lane * group.laneWidth,
        laneWidth: group.laneWidth,
        direction: group.direction,
        trafficProfile: group.trafficProfile,
      })
    }
  })
  return lanes
}
