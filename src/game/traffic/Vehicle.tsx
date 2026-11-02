import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { Box, Cylinder, Icosahedron } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { useGameStore } from '../../store/gameStore'
import type { IntersectionRuntime } from '../intersection/intersection.runtime'
import type { SpawnInstruction } from './TrafficManager'
import type { VehicleConfig, VehicleKind } from './traffic.config'
import { CAR_COLORS, FORCE_WAVE_MOTORCYCLE_VISUAL, LARGE_VEHICLE_COLORS, TRAFFIC_TUNING } from './traffic.config'
import { ACTIVE_COLLISION_TYPES_ALL, didVehicleHitPlayer, TRAFFIC_COLLISION_GROUPS } from './trafficPhysics'
import type { PlayerTrafficState, TrafficSnapshot } from './traffic.types'

type VehicleProps = {
  config: VehicleConfig
  trafficBoundaryX: number
  onReset: (id: number) => SpawnInstruction
  onUpdate: (id: number, x: number, z: number, speed: number, active: boolean) => void
  getTraffic: () => Map<number, TrafficSnapshot>
  playerState: PlayerTrafficState
  intersectionRuntime: IntersectionRuntime | null
}

type WheelRefs = MutableRefObject<Array<THREE.Object3D | null>>
export type VehicleVisualConfig = Pick<VehicleConfig, 'id' | 'kind' | 'direction' | 'width' | 'length' | 'style'>

function getMotorcycleVisualStyle(style: VehicleVisualConfig['style']): VehicleVisualConfig['style'] {
  return FORCE_WAVE_MOTORCYCLE_VISUAL ? 'underbone' : style ?? 'scooter'
}

// Traffic advances along X, so each wheel axle runs laterally along Z.
// CylinderGeometry starts with its long axis on Y; bake Y -> Z once so the
// animated wheel object can stay at zero rotation and spin only around Z.
const WHEEL_GEOMETRY_ROTATION_X = Math.PI / 2
const ROAD_SURFACE_Y = -0.02
const WHEEL_LOCAL_Y = 0.29

export function getVehicleWheelRadius(config: VehicleVisualConfig) {
  if (config.kind === 'motorcycle') {
    const style = getMotorcycleVisualStyle(config.style)
    return style === 'underbone' ? 0.34 : 0.29
  }
  if (config.kind === 'car') return config.style === 'compactEv' ? 0.36 : 0.31
  return 0.36
}

function getVehicleBodyY(config: VehicleVisualConfig) {
  if (config.kind === 'motorcycle') return 0.42
  if (config.kind === 'bus' || config.kind === 'truck') return 0.9
  return 0.65
}

function getVehicleVisualOffsetY(config: VehicleVisualConfig) {
  const wheelCenterY = ROAD_SURFACE_Y + getVehicleWheelRadius(config)
  return wheelCenterY - getVehicleBodyY(config) - WHEEL_LOCAL_Y
}

type VehicleRuntime = {
  active: boolean
  wait: number
  spawnX: number
  lateralOffset: number
  targetLateralOffset: number
  speed: number
  targetSpeed: number
}

type LeadVehicle = {
  snapshot: TrafficSnapshot
  gap: number
}

function moveTowards(current: number, target: number, maxDelta: number) {
  if (Math.abs(target - current) <= maxDelta) return target
  return current + Math.sign(target - current) * maxDelta
}

function clampLateralOffset(config: VehicleConfig, offset: number) {
  const maximum = Math.min(config.kind === 'bus' || config.kind === 'truck' ? 0.34 : 1.1, config.laneWidth / 2 - config.width / 2 - 0.08)
  return THREE.MathUtils.clamp(offset, -maximum, maximum)
}

function isLargeVehicle(kind: VehicleKind) {
  return kind === 'bus' || kind === 'truck'
}

export function getVehicleColor(config: VehicleVisualConfig) {
  if (config.kind === 'motorcycle') {
    const style = getMotorcycleVisualStyle(config.style)
    const palette = style === 'underbone'
      ? ['#c7c9c2', '#e1e1d7', '#c7c9c2', '#29383d', '#315d69', '#74383b', '#68746e']
      : ['#c8cbc5', '#dfded7', '#b9bfbc', '#d3d4ce', '#adb4b1']
    return palette[config.id % palette.length]
  }
  if (config.kind === 'car' && config.style === 'compactEv') {
    const palette = ['#d6bb3f', '#e7e4dc', '#9fc8cc', '#a85d57', '#2b3438']
    return palette[config.id % palette.length]
  }
  if (config.kind === 'bus' || config.kind === 'truck') return LARGE_VEHICLE_COLORS[config.id % LARGE_VEHICLE_COLORS.length]
  return CAR_COLORS[config.id % CAR_COLORS.length]
}

type LoftSection = {
  x: number
  top: number
  bottom: number
  halfWidth: number
  sideY?: number
  topDrop?: number
  bottomRise?: number
}

const SCOOTER_REAR_SECTIONS: LoftSection[] = [
  { x: -1.0, top: 0.76, bottom: 0.5, halfWidth: 0.14, sideY: 0.65 },
  { x: -0.84, top: 0.92, bottom: 0.46, halfWidth: 0.23, sideY: 0.7 },
  { x: -0.48, top: 1.0, bottom: 0.42, halfWidth: 0.29, sideY: 0.72 },
  { x: -0.1, top: 0.96, bottom: 0.42, halfWidth: 0.28, sideY: 0.7 },
  { x: 0.16, top: 0.82, bottom: 0.48, halfWidth: 0.23, sideY: 0.64 },
  { x: 0.25, top: 0.68, bottom: 0.52, halfWidth: 0.16, sideY: 0.59 },
]

const SCOOTER_APRON_SECTIONS: LoftSection[] = [
  { x: 0.1, top: 0.72, bottom: 0.4, halfWidth: 0.16, sideY: 0.56 },
  { x: 0.16, top: 0.98, bottom: 0.48, halfWidth: 0.21, sideY: 0.74 },
  { x: 0.25, top: 1.24, bottom: 0.64, halfWidth: 0.24, sideY: 0.94 },
  { x: 0.38, top: 1.4, bottom: 0.94, halfWidth: 0.21, sideY: 1.18 },
  { x: 0.5, top: 1.34, bottom: 1.12, halfWidth: 0.15, sideY: 1.24 },
  { x: 0.58, top: 1.24, bottom: 1.16, halfWidth: 0.11, sideY: 1.2 },
]

const SCOOTER_FLOORBOARD_SECTIONS: LoftSection[] = [
  { x: -0.42, top: 0.54, bottom: 0.46, halfWidth: 0.14, sideY: 0.5 },
  { x: -0.28, top: 0.57, bottom: 0.46, halfWidth: 0.2, sideY: 0.51 },
  { x: 0.04, top: 0.57, bottom: 0.45, halfWidth: 0.22, sideY: 0.5 },
  { x: 0.3, top: 0.58, bottom: 0.47, halfWidth: 0.18, sideY: 0.52 },
  { x: 0.4, top: 0.55, bottom: 0.48, halfWidth: 0.12, sideY: 0.51 },
]

const SCOOTER_SEAT_SECTIONS: LoftSection[] = [
  { x: -0.88, top: 0.98, bottom: 0.9, halfWidth: 0.12, sideY: 0.94 },
  { x: -0.72, top: 1.07, bottom: 0.89, halfWidth: 0.19, sideY: 0.98 },
  { x: -0.45, top: 1.11, bottom: 0.89, halfWidth: 0.23, sideY: 1.0 },
  { x: -0.12, top: 1.12, bottom: 0.9, halfWidth: 0.25, sideY: 1.01 },
  { x: 0.14, top: 1.08, bottom: 0.9, halfWidth: 0.22, sideY: 0.99 },
  { x: 0.28, top: 1.0, bottom: 0.9, halfWidth: 0.15, sideY: 0.95 },
]

const WAVE_FRONT_SECTIONS: LoftSection[] = [
  { x: 0.34, top: 1.0, bottom: 0.72, halfWidth: 0.11, sideY: 0.87 },
  { x: 0.44, top: 1.17, bottom: 0.78, halfWidth: 0.16, sideY: 0.98 },
  { x: 0.54, top: 1.29, bottom: 0.92, halfWidth: 0.18, sideY: 1.1 },
  { x: 0.64, top: 1.22, bottom: 1.02, halfWidth: 0.14, sideY: 1.12 },
]

const WAVE_SIDE_SECTIONS: LoftSection[] = [
  { x: -0.84, top: 0.78, bottom: 0.64, halfWidth: 0.12, sideY: 0.71 },
  { x: -0.64, top: 0.84, bottom: 0.54, halfWidth: 0.18, sideY: 0.7 },
  { x: -0.3, top: 0.86, bottom: 0.5, halfWidth: 0.2, sideY: 0.68 },
  { x: 0.02, top: 0.82, bottom: 0.5, halfWidth: 0.18, sideY: 0.66 },
  { x: 0.2, top: 0.72, bottom: 0.58, halfWidth: 0.12, sideY: 0.64 },
]

const WAVE_SEAT_SECTIONS: LoftSection[] = [
  { x: -0.68, top: 1.0, bottom: 0.94, halfWidth: 0.1, sideY: 0.97 },
  { x: -0.5, top: 1.04, bottom: 0.92, halfWidth: 0.15, sideY: 0.98 },
  { x: -0.2, top: 1.06, bottom: 0.92, halfWidth: 0.18, sideY: 1.0 },
  { x: 0.14, top: 1.05, bottom: 0.93, halfWidth: 0.17, sideY: 0.99 },
  { x: 0.3, top: 1.0, bottom: 0.94, halfWidth: 0.12, sideY: 0.97 },
]

function createLoftGeometry(sections: readonly LoftSection[]) {
  const ringSize = 10
  const vertices = new Float32Array(sections.length * ringSize * 3 + 2 * 3)
  const indices: number[] = []
  const vertex = (section: LoftSection, ringIndex: number, offset: number) => {
    const shoulder = section.halfWidth * 0.72
    const topDrop = section.topDrop ?? Math.max(0.018, (section.top - section.bottom) * 0.12)
    const bottomRise = section.bottomRise ?? Math.max(0.018, (section.top - section.bottom) * 0.1)
    const sideY = section.sideY ?? (section.top + section.bottom) * 0.5
    const ring = [
      [section.x, section.top, 0],
      [section.x, section.top - topDrop * 0.55, shoulder * 0.76],
      [section.x, section.top - topDrop, shoulder],
      [section.x, sideY, section.halfWidth],
      [section.x, section.bottom + bottomRise, shoulder],
      [section.x, section.bottom, 0],
      [section.x, section.bottom + bottomRise, -shoulder],
      [section.x, sideY, -section.halfWidth],
      [section.x, section.top - topDrop, -shoulder],
      [section.x, section.top - topDrop * 0.55, -shoulder * 0.76],
    ][ringIndex]
    vertices[offset] = ring[0]
    vertices[offset + 1] = ring[1]
    vertices[offset + 2] = ring[2]
  }

  sections.forEach((section, sectionIndex) => {
    const offset = sectionIndex * ringSize * 3
    for (let ringIndex = 0; ringIndex < ringSize; ringIndex += 1) vertex(section, ringIndex, offset + ringIndex * 3)
  })

  for (let sectionIndex = 0; sectionIndex < sections.length - 1; sectionIndex += 1) {
    for (let ringIndex = 0; ringIndex < ringSize; ringIndex += 1) {
      const nextRingIndex = (ringIndex + 1) % ringSize
      const a = sectionIndex * ringSize + ringIndex
      const b = sectionIndex * ringSize + nextRingIndex
      const c = (sectionIndex + 1) * ringSize + nextRingIndex
      const d = (sectionIndex + 1) * ringSize + ringIndex
      indices.push(a, b, d, b, c, d)
    }
  }

  const frontCenter = sections.length * ringSize
  const rearCenter = frontCenter + 1
  const frontSection = sections[0]
  const rearSection = sections[sections.length - 1]
  vertices.set([frontSection.x, (frontSection.top + frontSection.bottom) * 0.5, 0], frontCenter * 3)
  vertices.set([rearSection.x, (rearSection.top + rearSection.bottom) * 0.5, 0], rearCenter * 3)
  for (let ringIndex = 0; ringIndex < ringSize; ringIndex += 1) {
    const nextRingIndex = (ringIndex + 1) % ringSize
    indices.push(frontCenter, nextRingIndex, ringIndex)
    const rearOffset = (sections.length - 1) * ringSize
    indices.push(rearCenter, rearOffset + ringIndex, rearOffset + nextRingIndex)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

const LOFT_GEOMETRY_CACHE = new WeakMap<readonly LoftSection[], THREE.BufferGeometry>()

function LoftedShell({ sections, position = [0, 0, 0], rotation, color, roughness = 0.72, metalness = 0 }: {
  sections: readonly LoftSection[]
  position?: [number, number, number]
  rotation?: [number, number, number]
  color: string
  roughness?: number
  metalness?: number
}) {
  const geometry = useMemo(() => {
    const cached = LOFT_GEOMETRY_CACHE.get(sections)
    if (cached) return cached
    const created = createLoftGeometry(sections)
    LOFT_GEOMETRY_CACHE.set(sections, created)
    return created
  }, [sections])
  return (
    <mesh geometry={geometry} position={position} rotation={rotation} castShadow>
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  )
}

function findLeadVehicle(
  config: VehicleConfig,
  currentX: number,
  currentZ: number,
  traffic: Map<number, TrafficSnapshot>,
): LeadVehicle | null {
  let lead: LeadVehicle | null = null

  traffic.forEach((other) => {
    if (!other.active || other.id === config.id || other.direction !== config.direction) return
    if (other.laneIndex !== config.laneIndex) return
    if (Math.abs(other.z - config.laneCenterZ) > config.laneWidth / 2) return
    const sideMargin = config.kind === 'motorcycle' ? TRAFFIC_TUNING.motorcycle.sideMargin : isLargeVehicle(config.kind) ? TRAFFIC_TUNING.large.sideMargin : TRAFFIC_TUNING.car.sideMargin
    if (Math.abs(other.z - currentZ) > (other.width + config.width) / 2 + sideMargin) return

    const gap = (other.x - currentX) * config.direction - (config.length + other.length) / 2
    if (gap <= 0 || gap > TRAFFIC_TUNING.perceptionDistance) return
    if (!lead || gap < lead.gap) lead = { snapshot: other, gap }
  })

  return lead
}

function getPlayerRisk(config: VehicleConfig, currentX: number, currentZ: number, playerState: PlayerTrafficState) {
  if (!playerState.active) return 0

  const predictedX = playerState.x + playerState.vx * TRAFFIC_TUNING.playerPredictionTime
  const predictedZ = playerState.z + playerState.vz * TRAFFIC_TUNING.playerPredictionTime
  const longitudinalDistance = Math.abs(predictedX - currentX)
  const lateralDistance = Math.abs(predictedZ - currentZ)
  const longitudinalRange = TRAFFIC_TUNING.playerLongitudinalRange + Math.abs(playerState.vx) * 0.2
  const lateralRange = TRAFFIC_TUNING.playerLateralRange + config.width / 2

  if (longitudinalDistance > longitudinalRange || lateralDistance > lateralRange) return 0

  const longitudinalRisk = 1 - longitudinalDistance / longitudinalRange
  const lateralRisk = 1 - lateralDistance / lateralRange
  return THREE.MathUtils.clamp((longitudinalRisk + lateralRisk) * 0.5, 0, 1)
}

function isGapClear(
  config: VehicleConfig,
  currentX: number,
  targetZ: number,
  traffic: Map<number, TrafficSnapshot>,
  playerState: PlayerTrafficState,
) {
  const tuning = config.kind === 'motorcycle' ? TRAFFIC_TUNING.motorcycle : isLargeVehicle(config.kind) ? TRAFFIC_TUNING.large : TRAFFIC_TUNING.car
  const sideMargin = tuning.sideMargin + config.aggression * 0.025

  for (const other of traffic.values()) {
    if (!other.active || other.id === config.id || other.direction !== config.direction) continue
    if (other.laneIndex !== config.laneIndex) continue

    const lateralDistance = Math.abs(other.z - targetZ)
    const lateralClearance = (other.width + config.width) / 2 + sideMargin
    if (lateralDistance > lateralClearance) continue

    const longitudinalGap = (other.x - currentX) * config.direction
    const frontClearance = 1.2 + config.speed * 0.24 + (other.length + config.length) / 2
    const backClearance = 0.95 + config.speed * 0.18 + (other.length + config.length) / 2
    if (longitudinalGap >= -0.3 && longitudinalGap < frontClearance) return false
    if (longitudinalGap < -0.3 && -longitudinalGap < backClearance) return false
  }

  if (playerState.active) {
    const predictedX = playerState.x + playerState.vx * TRAFFIC_TUNING.playerPredictionTime
    const predictedZ = playerState.z + playerState.vz * TRAFFIC_TUNING.playerPredictionTime
    const playerNearCandidate =
      Math.abs(predictedX - currentX) < TRAFFIC_TUNING.playerLongitudinalRange &&
      Math.abs(predictedZ - targetZ) < TRAFFIC_TUNING.playerLateralRange + config.width / 2
    if (playerNearCandidate) return false
  }

  return true
}

function chooseMotorcycleOffset(
  config: VehicleConfig,
  runtime: VehicleRuntime,
  currentX: number,
  traffic: Map<number, TrafficSnapshot>,
  playerState: PlayerTrafficState,
  lead: LeadVehicle | null,
) {
  const baseline = clampLateralOffset(config, config.lateralBias)
  const playerRisk = getPlayerRisk(config, currentX, config.laneCenterZ + runtime.lateralOffset, playerState)
  const leadIsSlower = lead !== null && lead.snapshot.speed + 0.35 < runtime.speed
  const needsGap = lead !== null && (leadIsSlower || lead.snapshot.kind === 'car') && lead.gap < config.reactionDistance + runtime.speed * 0.9

  if (!needsGap && playerRisk === 0) return baseline

  let bestOffset = baseline
  let bestScore = Number.POSITIVE_INFINITY
  for (const candidate of TRAFFIC_TUNING.lateralCandidates) {
    const targetOffset = clampLateralOffset(config, candidate)
    const targetZ = config.laneCenterZ + targetOffset
    if (!isGapClear(config, currentX, targetZ, traffic, playerState)) continue

    const preference = Math.abs(targetOffset - baseline)
    const centerPenalty = needsGap && Math.abs(targetOffset) < 0.1 ? 0.16 : 0
    const score = preference + centerPenalty - targetOffset * config.lateralBias * 0.04 - config.aggression * Math.abs(targetOffset) * 0.03
    if (score < bestScore) {
      bestOffset = targetOffset
      bestScore = score
    }
  }

  return bestOffset
}

function Wheel({ radius, width, position, wheelRefs, index, side = 1, spokeCount = 5 }: {
  radius: number
  width: number
  position: [number, number, number]
  wheelRefs?: WheelRefs
  index?: number
  side?: number
  spokeCount?: number
}) {
  const wheelGeometry = useMemo(() => {
    const tireTube = Math.min(width * 0.5, radius * 0.12)
    const tire = new THREE.TorusGeometry(radius - tireTube, tireTube, 6, 20)
    const rim = new THREE.TorusGeometry(radius * 0.72, radius * 0.026, 5, 18)
    const hub = new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, width * 0.7, 8)
    const brake = new THREE.CylinderGeometry(radius * 0.28, radius * 0.28, width * 0.34, 10)
    const axle = new THREE.CylinderGeometry(radius * 0.07, radius * 0.07, width * 1.08, 8)
    hub.rotateX(WHEEL_GEOMETRY_ROTATION_X)
    brake.rotateX(WHEEL_GEOMETRY_ROTATION_X)
    axle.rotateX(WHEEL_GEOMETRY_ROTATION_X)
    return { tire, rim, hub, brake, axle }
  }, [radius, width])

  const rimRadius = radius * 0.72
  const hubRadius = radius * 0.16
  const spokeLength = rimRadius - hubRadius
  const spokeCenter = (rimRadius + hubRadius) / 2
  const spokeThickness = radius * 0.025

  return (
    <group position={position}>
      <group
        ref={(node) => {
          if (wheelRefs && index !== undefined) wheelRefs.current[index] = node
        }}
      >
        <mesh geometry={wheelGeometry.tire} castShadow>
          <meshStandardMaterial color="#202729" roughness={0.94} />
        </mesh>
        <mesh geometry={wheelGeometry.rim}>
          <meshStandardMaterial color="#8d9690" roughness={0.52} metalness={0.38} />
        </mesh>
        <mesh geometry={wheelGeometry.brake} position={[0, 0, side * (width * 0.22)]}>
          <meshStandardMaterial color="#58615e" roughness={0.76} metalness={0.28} />
        </mesh>
        <mesh geometry={wheelGeometry.hub}>
          <meshStandardMaterial color="#a1a8a0" roughness={0.58} metalness={0.3} />
        </mesh>
        <mesh geometry={wheelGeometry.axle}>
          <meshStandardMaterial color="#384240" roughness={0.72} metalness={0.32} />
        </mesh>
        {Array.from({ length: spokeCount }, (_, spokeIndex) => {
          const angle = (spokeIndex / spokeCount) * Math.PI * 2 + Math.PI / 10
          return (
            <Box
              key={spokeIndex}
              args={[spokeLength, spokeThickness, width * 0.16]}
              position={[Math.cos(angle) * spokeCenter, Math.sin(angle) * spokeCenter, side * (width / 2 + 0.014)]}
              rotation={[0, 0, angle]}
            >
              <meshStandardMaterial color="#67716c" roughness={0.66} metalness={0.28} />
            </Box>
          )
        })}
        <Box
          args={[radius * 0.12, radius * 0.08, width * 0.24]}
          position={[radius * 0.22, radius * 0.13, side * (width / 2 + 0.024)]}
          rotation={[0, 0, -0.24]}
        >
          <meshStandardMaterial color="#303a38" roughness={0.8} metalness={0.18} />
        </Box>
      </group>
    </group>
  )
}

function Mirror({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Cylinder args={[0.018, 0.018, 0.18, 6]} rotation={[0, 0, -0.28]}>
        <meshStandardMaterial color="#313a3b" roughness={0.78} metalness={0.16} />
      </Cylinder>
      <Icosahedron args={[0.075, 1]} position={[0.04, 0.1, 0]} scale={[0.72, 1, 0.46]}>
        <meshStandardMaterial color="#1e292b" roughness={0.5} metalness={0.16} />
      </Icosahedron>
      <Icosahedron args={[0.052, 1]} position={[0.065, 0.102, 0.028]} scale={[0.72, 1, 0.42]}>
        <meshStandardMaterial color="#8eaaa8" roughness={0.24} metalness={0.18} />
      </Icosahedron>
    </group>
  )
}

const EXTRUDED_GEOMETRY_CACHE = new Map<string, THREE.ExtrudeGeometry>()

function ExtrudedPanel({
  points,
  depth,
  position,
  rotation,
  color,
  roughness = 0.72,
  metalness = 0,
  bevelSize = 0.008,
  flatShading = false,
}: {
  points: Array<[number, number]>
  depth: number
  position: [number, number, number]
  rotation?: [number, number, number]
  color: string
  roughness?: number
  metalness?: number
  bevelSize?: number
  flatShading?: boolean
}) {
  const pointsKey = points.map(([x, y]) => `${x}:${y}`).join('|')
  const geometry = useMemo(() => {
    const cacheKey = `${depth}:${bevelSize}:${pointsKey}`
    const cached = EXTRUDED_GEOMETRY_CACHE.get(cacheKey)
    if (cached) return cached
    const shape = new THREE.Shape()
    points.forEach(([x, y], index) => {
      if (index === 0) shape.moveTo(x, y)
      else shape.lineTo(x, y)
    })
    shape.closePath()
    const nextGeometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevelSize > 0,
      bevelSegments: bevelSize > 0 ? 1 : 0,
      bevelSize,
      bevelThickness: Math.min(bevelSize, depth * 0.3),
      curveSegments: 2,
      steps: 1,
    })
    nextGeometry.translate(0, 0, -depth / 2)
    EXTRUDED_GEOMETRY_CACHE.set(cacheKey, nextGeometry)
    return nextGeometry
  }, [bevelSize, depth, pointsKey])

  return (
    <mesh geometry={geometry} position={position} rotation={rotation} castShadow>
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} flatShading={flatShading} />
    </mesh>
  )
}

function LimbSegment({ position, length, radius, rotationZ, color }: {
  position: [number, number, number]
  length: number
  radius: number
  rotationZ: number
  color: string
}) {
  return (
    <Cylinder args={[radius, radius * 0.92, length, 7]} position={position} rotation={[0, 0, rotationZ]}>
      <meshStandardMaterial color={color} roughness={0.9} />
    </Cylinder>
  )
}

function FrontMudguard({ position, radius, color = '#252f30' }: { position: [number, number, number]; radius: number; color?: string }) {
  const geometry = useMemo(() => new THREE.TorusGeometry(radius * 1.02, 0.028, 6, 20, Math.PI), [radius])
  return (
    <mesh geometry={geometry} position={position} castShadow>
      <meshStandardMaterial color={color} roughness={0.84} />
    </mesh>
  )
}

function RiderHelmet({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  const rimGeometry = useMemo(() => new THREE.TorusGeometry(0.145 * scale, 0.012 * scale, 5, 14, Math.PI * 1.35), [scale])
  return (
    <group position={position}>
      <Icosahedron args={[0.2 * scale, 2]} scale={[1.02, 0.82, 0.98]}>
        <meshStandardMaterial color="#253236" roughness={0.54} metalness={0.08} />
      </Icosahedron>
      <mesh geometry={rimGeometry} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.04 * scale, 0.02 * scale]}>
        <meshStandardMaterial color="#111a1b" roughness={0.66} metalness={0.12} />
      </mesh>
      <Box args={[0.14 * scale, 0.028 * scale, 0.12 * scale]} position={[0.105 * scale, -0.005 * scale, 0.02 * scale]} rotation={[0, 0, -0.08]}>
        <meshStandardMaterial color="#111a1b" roughness={0.3} metalness={0.08} />
      </Box>
    </group>
  )
}

function HeadlightHousing({ position, rotation, scale = 1 }: { position: [number, number, number]; rotation?: [number, number, number]; scale?: number }) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <ExtrudedPanel
        points={[[-0.11, -0.08], [-0.09, 0.07], [0, 0.13], [0.1, 0.08], [0.12, -0.07], [0.04, -0.13]]}
        depth={0.07}
        position={[0, 0, 0]}
        color="#202a2b"
        roughness={0.5}
        metalness={0.16}
        bevelSize={0.012}
      />
      <ExtrudedPanel
        points={[[-0.07, -0.055], [-0.055, 0.045], [0, 0.09], [0.06, 0.05], [0.075, -0.045], [0.025, -0.085]]}
        depth={0.035}
        position={[0, 0, 0.045]}
        color="#e8ebe1"
        roughness={0.24}
        metalness={0.12}
        bevelSize={0.006}
      />
      <ExtrudedPanel
        points={[[-0.045, -0.025], [-0.02, 0.055], [0.035, 0.035], [0.048, -0.02]]}
        depth={0.012}
        position={[0, 0, 0.067]}
        color="#ffffff"
        roughness={0.18}
        metalness={0.08}
        bevelSize={0.002}
      />
    </group>
  )
}

function CarModel({ config, color, wheelRefs, heading: headingOverride }: { config: VehicleVisualConfig; color: string; wheelRefs: WheelRefs; heading?: number }) {
  const heading = headingOverride ?? (config.direction === 1 ? 0 : Math.PI)
  const isCompactEv = config.style === 'compactEv'
  const length = config.length
  const width = config.width
  const wheelRadius = getVehicleWheelRadius(config)
  const wheelX = isCompactEv ? length * 0.32 : length * 0.35
  const glass = '#263d42'
  const trim = '#263033'
  const visualOffsetY = getVehicleVisualOffsetY(config)

  return (
    <group position={[0, visualOffsetY, 0]} rotation={[0, heading, 0]}>
      <Box args={[length * 0.96, 0.36, width * 0.96]} position={[0, 0.4, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.7} />
      </Box>
      <Box args={[length * 0.94, 0.16, width + 0.035]} position={[0, 0.23, 0]}>
        <meshStandardMaterial color={trim} roughness={0.82} metalness={0.08} />
      </Box>
      {isCompactEv ? (
        <>
          <Box args={[length * 0.58, 0.76, width * 0.84]} position={[-length * 0.08, 0.92, 0]} castShadow>
            <meshStandardMaterial color={color} roughness={0.68} />
          </Box>
          <Box args={[length * 0.58, 0.08, width * 0.82]} position={[-length * 0.08, 1.32, 0]}>
            <meshStandardMaterial color="#202d30" roughness={0.72} />
          </Box>
          <Box args={[length * 0.22, 0.43, 0.035]} position={[length * 0.16, 0.98, width * 0.435]}>
            <meshStandardMaterial color={glass} roughness={0.28} />
          </Box>
          <Box args={[length * 0.22, 0.43, 0.035]} position={[-length * 0.2, 0.98, width * 0.435]}>
            <meshStandardMaterial color={glass} roughness={0.28} />
          </Box>
          <Box args={[length * 0.22, 0.43, 0.035]} position={[length * 0.16, 0.98, -width * 0.435]}>
            <meshStandardMaterial color={glass} roughness={0.28} />
          </Box>
          <Box args={[length * 0.22, 0.43, 0.035]} position={[-length * 0.2, 0.98, -width * 0.435]}>
            <meshStandardMaterial color={glass} roughness={0.28} />
          </Box>
          <Box args={[length * 0.07, 0.38, width * 0.74]} position={[length * 0.22, 0.98, 0]}>
            <meshStandardMaterial color={glass} roughness={0.3} />
          </Box>
          <Box args={[0.12, 0.48, width * 0.92]} position={[length * 0.5, 0.62, 0]}>
            <meshStandardMaterial color={trim} roughness={0.8} />
          </Box>
          <Box args={[0.05, 0.1, width * 0.28]} position={[length * 0.515, 0.76, -width * 0.27]}>
            <meshStandardMaterial color="#f1d378" emissive="#573f13" emissiveIntensity={0.22} />
          </Box>
          <Box args={[0.05, 0.1, width * 0.28]} position={[length * 0.515, 0.76, width * 0.27]}>
            <meshStandardMaterial color="#f1d378" emissive="#573f13" emissiveIntensity={0.22} />
          </Box>
          <Box args={[0.05, 0.11, width * 0.26]} position={[-length * 0.515, 0.58, -width * 0.27]}>
            <meshStandardMaterial color="#b84d49" emissive="#3d1412" emissiveIntensity={0.16} />
          </Box>
          <Box args={[0.05, 0.11, width * 0.26]} position={[-length * 0.515, 0.58, width * 0.27]}>
            <meshStandardMaterial color="#b84d49" emissive="#3d1412" emissiveIntensity={0.16} />
          </Box>
        </>
      ) : (
        <>
          <Box args={[length * 0.28, 0.16, width * 0.91]} position={[length * 0.34, 0.7, 0]}>
            <meshStandardMaterial color={color} roughness={0.68} />
          </Box>
          <Box args={[length * 0.22, 0.14, width * 0.9]} position={[-length * 0.38, 0.69, 0]}>
            <meshStandardMaterial color={color} roughness={0.7} />
          </Box>
          <Box args={[length * 0.52, 0.56, width * 0.83]} position={[-length * 0.03, 0.9, 0]} castShadow>
            <meshStandardMaterial color={color} roughness={0.68} />
          </Box>
          <Box args={[length * 0.18, 0.34, width * 0.03]} position={[length * 0.22, 0.97, width * 0.43]}>
            <meshStandardMaterial color={glass} roughness={0.28} />
          </Box>
          <Box args={[length * 0.18, 0.34, width * 0.03]} position={[-length * 0.2, 0.97, width * 0.43]}>
            <meshStandardMaterial color={glass} roughness={0.28} />
          </Box>
          <Box args={[length * 0.18, 0.34, width * 0.03]} position={[length * 0.22, 0.97, -width * 0.43]}>
            <meshStandardMaterial color={glass} roughness={0.28} />
          </Box>
          <Box args={[length * 0.18, 0.34, width * 0.03]} position={[-length * 0.2, 0.97, -width * 0.43]}>
            <meshStandardMaterial color={glass} roughness={0.28} />
          </Box>
          <Box args={[0.045, 0.38, width * 0.73]} position={[length * 0.2, 0.97, 0]}>
            <meshStandardMaterial color={glass} roughness={0.3} />
          </Box>
          <Box args={[0.1, 0.17, width * 0.94]} position={[length * 0.5, 0.5, 0]}>
            <meshStandardMaterial color={trim} roughness={0.8} />
          </Box>
          <Box args={[0.06, 0.13, width * 0.2]} position={[length * 0.505, 0.64, -width * 0.3]}>
            <meshStandardMaterial color="#f1d378" emissive="#573f13" emissiveIntensity={0.22} />
          </Box>
          <Box args={[0.06, 0.13, width * 0.2]} position={[length * 0.505, 0.64, width * 0.3]}>
            <meshStandardMaterial color="#f1d378" emissive="#573f13" emissiveIntensity={0.22} />
          </Box>
          <Box args={[0.06, 0.13, width * 0.2]} position={[-length * 0.505, 0.61, -width * 0.3]}>
            <meshStandardMaterial color="#b84d49" emissive="#3d1412" emissiveIntensity={0.16} />
          </Box>
          <Box args={[0.06, 0.13, width * 0.2]} position={[-length * 0.505, 0.61, width * 0.3]}>
            <meshStandardMaterial color="#b84d49" emissive="#3d1412" emissiveIntensity={0.16} />
          </Box>
        </>
      )}
      {[-1, 1].map((side) => (
        <group key={side}>
          <Box args={[0.12, 0.1, 0.08]} position={[length * 0.22, 0.78, side * (width * 0.52 + 0.03)]}>
            <meshStandardMaterial color="#1e292b" roughness={0.35} metalness={0.1} />
          </Box>
          <Box args={[0.04, 0.12, 0.34]} position={[length * 0.42, 0.31, side * width * 0.5]}>
            <meshStandardMaterial color="#eee6cf" roughness={0.74} />
          </Box>
        </group>
      ))}
      {[-wheelX, wheelX].map((x, index) => [-1, 1].map((side) => (
        <Wheel
          key={`${x}-${side}`}
          radius={wheelRadius}
          width={0.16}
          position={[x, WHEEL_LOCAL_Y, side * width * 0.56]}
          side={side}
          wheelRefs={wheelRefs}
          index={index * 2 + (side === 1 ? 1 : 0)}
          spokeCount={5}
        />
      )))}
    </group>
  )
}

function Rider({ color, pantsColor, style }: { color: string; pantsColor: string; style?: VehicleVisualConfig['style'] }) {
  const isUnderbone = style === 'underbone'
  const footX = isUnderbone ? -0.03 : 0.28
  if (!isUnderbone) {
    return (
      <group position={[-0.08, 0, 0]}>
        {/* Upright commuter posture: hips on the padded seat, knees forward, feet on the floorboard. */}
        <ExtrudedPanel
          points={[[-0.34, -0.22], [-0.28, 0.18], [-0.16, 0.28], [0.12, 0.22], [0.18, -0.18], [0.04, -0.26]]}
          depth={0.28}
          position={[-0.2, 1.13, 0]}
          rotation={[0, 0, -0.06]}
          color={color}
          roughness={0.86}
        />
        <Box args={[0.24, 0.16, 0.3]} position={[-0.19, 1.39, 0]}>
          <meshStandardMaterial color="#303b43" roughness={0.8} />
        </Box>
        <Icosahedron args={[0.15, 1]} position={[-0.1, 1.55, 0]} scale={[0.92, 1.08, 0.92]}>
          <meshStandardMaterial color="#a8755d" roughness={0.92} />
        </Icosahedron>
        <RiderHelmet position={[-0.1, 1.62, 0]} scale={0.96} />
        <Box args={[0.22, 0.045, 0.2]} position={[0.01, 1.51, 0.02]} rotation={[0, 0, -0.08]}>
          <meshStandardMaterial color="#111a1b" roughness={0.32} metalness={0.08} />
        </Box>
        {[-1, 1].map((side) => (
          <group key={side}>
            <LimbSegment position={[0.09, 1.34, side * 0.13]} length={0.25} radius={0.035} rotationZ={1.22} color={color} />
            <Icosahedron args={[0.045, 0]} position={[0.21, 1.27, side * 0.13]}>
              <meshStandardMaterial color="#a8755d" roughness={0.92} />
            </Icosahedron>
            <LimbSegment position={[0.29, 1.3, side * 0.13]} length={0.17} radius={0.029} rotationZ={1.42} color={color} />
            <Icosahedron args={[0.032, 0]} position={[0.36, 1.32, side * 0.13]}>
              <meshStandardMaterial color="#a8755d" roughness={0.92} />
            </Icosahedron>
          </group>
        ))}
        {[-1, 1].map((side) => (
          <group key={`scooter-leg-${side}`}>
            <LimbSegment position={[-0.02, 0.91, side * 0.13]} length={0.3} radius={0.037} rotationZ={2.3} color={pantsColor} />
            <LimbSegment position={[0.02, 0.78, side * 0.13]} length={0.26} radius={0.034} rotationZ={2.28} color={pantsColor} />
            <Icosahedron args={[0.044, 0]} position={[0.12, 0.68, side * 0.13]}>
              <meshStandardMaterial color={pantsColor} roughness={0.92} />
            </Icosahedron>
            <LimbSegment position={[0.2, 0.61, side * 0.13]} length={0.22} radius={0.031} rotationZ={2.18} color={pantsColor} />
            <Box args={[0.16, 0.055, 0.12]} position={[footX + 0.02, 0.51, side * 0.13]}>
              <meshStandardMaterial color="#242c2d" roughness={0.94} />
            </Box>
          </group>
        ))}
      </group>
    )
  }

  return (
    <group position={[0, -0.17, 0]}>
      <ExtrudedPanel
        points={[[-0.14, -0.2], [-0.13, 0.13], [-0.06, 0.22], [0.13, 0.16], [0.12, -0.17], [0.04, -0.23]]}
        depth={0.28}
        position={[-0.1, 1.1, 0]}
        rotation={[0, 0, -0.1]}
        color={color}
        roughness={0.88}
      />
      <Cylinder args={[0.055, 0.06, 0.09, 7]} position={[-0.07, 1.37, 0]}>
        <meshStandardMaterial color="#a8755d" roughness={0.92} />
      </Cylinder>
      <Icosahedron args={[0.17, 1]} position={[0.02, 1.58, 0]}>
        <meshStandardMaterial color="#a8755d" roughness={0.92} />
      </Icosahedron>
      <RiderHelmet position={[0.02, 1.66, 0]} />
      <Box args={[0.18, 0.035, 0.19]} position={[0.1, 1.55, 0.02]} rotation={[0, 0, -0.08]}>
        <meshStandardMaterial color="#111a1b" roughness={0.32} metalness={0.08} />
      </Box>
      {[-1, 1].map((side) => (
        <group key={side}>
          <Icosahedron args={[0.052, 0]} position={[0.04, 1.34, side * 0.14]}>
            <meshStandardMaterial color={color} roughness={0.88} />
          </Icosahedron>
          <LimbSegment position={[0.11, 1.32, side * 0.14]} length={0.17} radius={0.035} rotationZ={1.98} color={color} />
          <Icosahedron args={[0.046, 0]} position={[0.2, 1.275, side * 0.14]}>
            <meshStandardMaterial color="#a8755d" roughness={0.92} />
          </Icosahedron>
          <LimbSegment position={[0.3, 1.27, side * 0.14]} length={0.2} radius={0.032} rotationZ={1.82} color={color} />
          <Icosahedron args={[0.045, 0]} position={[0.4, 1.26, side * 0.14]}>
            <meshStandardMaterial color="#a8755d" roughness={0.92} />
          </Icosahedron>
          <LimbSegment position={[0.02, 0.94, side * 0.14]} length={0.34} radius={0.038} rotationZ={2.28} color={pantsColor} />
          <Icosahedron args={[0.052, 0]} position={[0.08, 0.82, side * 0.14]}>
            <meshStandardMaterial color={pantsColor} roughness={0.92} />
          </Icosahedron>
          <LimbSegment position={[0.1, 0.7, side * 0.14]} length={0.25} radius={0.035} rotationZ={2.98} color={pantsColor} />
          <Box args={[0.16, 0.055, 0.12]} position={[footX + 0.02, 0.58, side * 0.14]}>
            <meshStandardMaterial color="#242c2d" roughness={0.94} />
          </Box>
        </group>
      ))}
    </group>
  )
}

function UnderboneBody({ bodyColor, metal, dark }: { bodyColor: string; metal: string; dark: string }) {
  const sidePanelColor = bodyColor === '#c7c9c2' || bodyColor === '#e1e1d7' ? '#4b5859' : '#26363b'
  return (
    <>
      {/* Lofted Wave-style front cowl with a shaped bezel and lens. */}
      <LoftedShell sections={WAVE_FRONT_SECTIONS} color={bodyColor} roughness={0.68} />
      <HeadlightHousing position={[0.63, 1.04, 0.16]} rotation={[0, 0, -0.1]} scale={0.75} />
      <ExtrudedPanel points={[[-0.08, -0.1], [-0.07, 0.08], [0.06, 0.06], [0.08, -0.1]]} depth={0.25} position={[0.62, 0.78, 0]} rotation={[0, 0, -0.06]} color={bodyColor} roughness={0.74} />
      {[-1, 1].map((side) => (
        <group key={`front-signal-${side}`} position={[0.59, 0.87, side * 0.17]}>
          <Icosahedron args={[0.052, 0]} scale={[0.6, 0.72, 1]}>
            <meshStandardMaterial color="#b86f43" emissive="#5a321b" emissiveIntensity={0.14} roughness={0.42} />
          </Icosahedron>
        </group>
      ))}

      {/* Two thin fork tubes, lower sliders, axle, and a close-fitting mudguard. */}
      {[-1, 1].map((side) => (
        <group key={`fork-${side}`}>
          <Cylinder args={[0.016, 0.019, 0.48, 7]} rotation={[0, 0, -0.13]} position={[0.55, 0.66, side * 0.12]}>
            <meshStandardMaterial color="#b0b5ac" roughness={0.58} metalness={0.34} />
          </Cylinder>
          <Cylinder args={[0.024, 0.03, 0.2, 7]} rotation={[0, 0, -0.13]} position={[0.59, 0.43, side * 0.12]}>
            <meshStandardMaterial color="#4b5552" roughness={0.76} metalness={0.24} />
          </Cylinder>
        </group>
      ))}
      <Cylinder args={[0.038, 0.038, 0.24, 8]} rotation={[Math.PI / 2, 0, 0]} position={[0.65, WHEEL_LOCAL_Y + 0.17, 0]}>
        <meshStandardMaterial color="#343e3c" roughness={0.72} metalness={0.3} />
      </Cylinder>
      <FrontMudguard position={[0.65, WHEEL_LOCAL_Y + 0.17, 0]} radius={0.34} />
      <FrontMudguard position={[-0.65, WHEEL_LOCAL_Y, 0]} radius={0.34} color={sidePanelColor} />
      <Box args={[0.24, 0.08, 0.16]} position={[0.42, 1.22, 0]} rotation={[0, 0, -0.05]}>
        <meshStandardMaterial color={dark} roughness={0.78} />
      </Box>
      <Box args={[0.1, 0.07, 0.12]} position={[0.33, 1.28, 0]}>
        <meshStandardMaterial color="#343e3e" roughness={0.54} metalness={0.16} />
      </Box>
      <Cylinder args={[0.018, 0.018, 0.5, 7]} rotation={[Math.PI / 2, 0, 0]} position={[0.4, 1.27, 0]}>
        <meshStandardMaterial color="#303939" roughness={0.72} metalness={0.18} />
      </Cylinder>

      {/* Split leg shield: thin, sculpted cheeks and a narrow center spine leave the step-through open. */}
      {[-1, 1].map((side) => (
        <ExtrudedPanel
          key={`leg-shield-${side}`}
          points={[[-0.06, -0.16], [-0.07, 0.08], [-0.02, 0.19], [0.05, 0.1], [0.035, -0.14]]}
          depth={0.035}
          position={[0.29, 0.9, side * 0.12]}
          rotation={[0, 0, -0.12]}
          color={bodyColor}
          roughness={0.72}
        />
      ))}
      <ExtrudedPanel points={[[-0.022, -0.16], [-0.025, 0.13], [0, 0.2], [0.025, 0.13], [0.022, -0.16]]} depth={0.04} position={[0.29, 0.88, 0]} rotation={[0, 0, -0.12]} color={metal} roughness={0.76} metalness={0.18} />
      <ExtrudedPanel points={[[-0.035, -0.06], [-0.038, 0.025], [0, 0.075], [0.038, 0.02], [0.032, -0.06]]} depth={0.1} position={[0.14, 0.68, 0]} rotation={[0, 0, -0.16]} color={bodyColor} roughness={0.78} />

      {/* Multi-section saddle and a continuous sculpted side panel. */}
      <LoftedShell sections={WAVE_SEAT_SECTIONS} color="#171f20" roughness={0.92} />
      <LoftedShell sections={WAVE_SIDE_SECTIONS} color={sidePanelColor} roughness={0.76} />
      <Box args={[0.035, 0.09, 0.17]} position={[-0.925, 0.85, 0]}>
        <meshStandardMaterial color="#292f30" roughness={0.78} />
      </Box>
      <Box args={[0.03, 0.075, 0.15]} position={[-0.95, 0.85, 0]}>
        <meshStandardMaterial color="#b34e48" emissive="#3f1413" emissiveIntensity={0.16} roughness={0.5} />
      </Box>
      {[-1, 1].map((side) => (
        <Icosahedron key={`rear-indicator-${side}`} args={[0.045, 0]} position={[-0.84, 0.78, side * 0.18]}>
          <meshStandardMaterial color="#b86f43" emissive="#5a321b" emissiveIntensity={0.14} roughness={0.42} />
        </Icosahedron>
      ))}
      {/* CylinderGeometry is Y-aligned by default; rotate around Z so the compact rail follows X. */}
      <Cylinder args={[0.018, 0.018, 0.34, 7]} rotation={[0, 0, Math.PI / 2]} position={[-0.56, 1.085, 0]}>
        <meshStandardMaterial color="#303838" roughness={0.76} metalness={0.22} />
      </Cylinder>
      {[-1, 1].map((side) => (
        <Cylinder key={`grab-mount-${side}`} args={[0.016, 0.016, 0.1, 6]} position={[-0.68, 1.045, side * 0.1]}>
          <meshStandardMaterial color="#58615d" roughness={0.72} metalness={0.22} />
        </Cylinder>
      ))}
      <Box args={[0.045, 0.18, 0.03]} position={[-0.86, 0.58, 0]} rotation={[0, 0, 0.18]}>
        <meshStandardMaterial color="#343d3c" roughness={0.86} metalness={0.18} />
      </Box>
      <Box args={[0.035, 0.12, 0.15]} position={[-0.96, 0.64, 0]} rotation={[0, 0, 0.2]}>
        <meshStandardMaterial color="#e0e0d2" roughness={0.76} />
      </Box>
      <ExtrudedPanel points={[[-0.16, -0.035], [0.16, -0.028], [0.2, 0.025], [-0.1, 0.065]]} depth={0.045} position={[-0.84, 0.46, 0]} rotation={[0, 0, -0.16]} color="#252e30" roughness={0.88} />
      <Cylinder args={[0.018, 0.024, 0.43, 6]} position={[-0.48, 0.58, 0.18]} rotation={[0, 0, -0.45]}>
        <meshStandardMaterial color="#9ca49c" roughness={0.64} metalness={0.3} />
      </Cylinder>
      <Cylinder args={[0.032, 0.032, 0.035, 7]} position={[-0.38, 0.77, 0.18]} rotation={[0, 0, -0.45]}>
        <meshStandardMaterial color="#252e2f" roughness={0.78} metalness={0.2} />
      </Cylinder>
      <Cylinder args={[0.032, 0.032, 0.035, 7]} position={[-0.58, 0.39, 0.18]} rotation={[0, 0, -0.45]}>
        <meshStandardMaterial color="#252e2f" roughness={0.78} metalness={0.2} />
      </Cylinder>
      {[
        [-0.42, 0.69],
        [-0.48, 0.58],
        [-0.54, 0.47],
      ].map(([x, y], index) => (
        <Box key={`shock-spring-${index}`} args={[0.035, 0.018, 0.05]} position={[x, y, 0.185]} rotation={[0, 0, -0.45]}>
          <meshStandardMaterial color="#b2b8ae" roughness={0.62} metalness={0.28} />
        </Box>
      ))}

      {/* Frame rail, engine, side covers, and foot-peg area. */}
      <Box args={[0.68, 0.1, 0.15]} position={[-0.08, 0.7, 0]} rotation={[0, 0, -0.08]}>
        <meshStandardMaterial color={metal} roughness={0.84} metalness={0.14} />
      </Box>
      {[-1, 1].map((side) => (
        <Cylinder key={`rear-frame-${side}`} args={[0.016, 0.019, 0.58, 7]} rotation={[0, 0, Math.PI / 2]} position={[-0.38, 0.77, side * 0.16]}>
          <meshStandardMaterial color="#3b4543" roughness={0.82} metalness={0.2} />
        </Cylinder>
      ))}
      <Cylinder args={[0.14, 0.16, 0.16, 12]} rotation={[Math.PI / 2, 0, 0]} position={[-0.18, 0.54, 0]}>
        <meshStandardMaterial color="#242d2e" roughness={0.9} metalness={0.12} />
      </Cylinder>
      <Cylinder args={[0.13, 0.13, 0.09, 10]} rotation={[Math.PI / 2, 0, 0]} position={[-0.2, 0.53, 0.17]}>
        <meshStandardMaterial color="#56605b" roughness={0.78} metalness={0.28} />
      </Cylinder>
      <Box args={[0.24, 0.28, 0.065]} position={[-0.22, 0.57, 0.17]} rotation={[0, 0, -0.08]}>
        <meshStandardMaterial color="#4b5552" roughness={0.8} metalness={0.26} />
      </Box>
      <Box args={[0.18, 0.2, 0.24]} position={[0.04, 0.66, 0]}>
        <meshStandardMaterial color="#3d4845" roughness={0.84} metalness={0.22} />
      </Box>
      {Array.from({ length: 5 }, (_, index) => (
        <Box key={`cooling-fin-${index}`} args={[0.19, 0.018, 0.25]} position={[-0.01, 0.58 + index * 0.032, 0.16]} rotation={[0, 0, -0.08]}>
          <meshStandardMaterial color="#69716b" roughness={0.74} metalness={0.24} />
        </Box>
      ))}
      <Cylinder args={[0.028, 0.035, 0.25, 7]} rotation={[0, 0, Math.PI / 2]} position={[0.16, 0.57, 0.14]}>
        <meshStandardMaterial color="#343e3c" roughness={0.8} metalness={0.2} />
      </Cylinder>
      <ExtrudedPanel points={[[-0.14, -0.05], [0.12, -0.04], [0.16, 0.04], [-0.08, 0.07]]} depth={0.04} position={[-0.4, 0.75, 0.17]} rotation={[0, 0, 0.12]} color={sidePanelColor} roughness={0.82} />
      {[-1, 1].map((side) => (
        <group key={`foot-peg-${side}`}>
          <Cylinder args={[0.014, 0.014, 0.28, 6]} rotation={[Math.PI / 2, 0, 0]} position={[-0.04, 0.5, side * 0.13]}>
            <meshStandardMaterial color="#929b93" roughness={0.68} metalness={0.28} />
          </Cylinder>
          <Box args={[0.16, 0.055, 0.065]} position={[-0.04, 0.5, side * 0.22]}>
            <meshStandardMaterial color="#242c2d" roughness={0.9} />
          </Box>
        </group>
      ))}
      <Box args={[0.09, 0.035, 0.05]} position={[0.04, 0.48, -0.25]} rotation={[0, 0, -0.24]}>
        <meshStandardMaterial color="#9da59e" roughness={0.7} metalness={0.25} />
      </Box>
      <Box args={[0.08, 0.035, 0.05]} position={[-0.02, 0.46, 0.25]} rotation={[0, 0, 0.18]}>
        <meshStandardMaterial color="#9da59e" roughness={0.7} metalness={0.25} />
      </Box>
      <Box args={[0.48, 0.045, 0.05]} position={[-0.43, 0.39, 0.18]} rotation={[0, 0, 0.43]}>
        <meshStandardMaterial color="#303a38" roughness={0.86} metalness={0.18} />
      </Box>
      <Box args={[0.45, 0.04, 0.05]} position={[-0.44, 0.37, 0.18]} rotation={[0, 0, 0.43]}>
        <meshStandardMaterial color="#45504c" roughness={0.82} metalness={0.2} />
      </Box>

      {/* Long, thin commuter exhaust: header, connecting pipe, muffler, tip, and heat shield. */}
      <Cylinder args={[0.026, 0.034, 0.2, 7]} rotation={[0, 0, Math.PI / 2 - 0.05]} position={[-0.02, 0.5, -0.22]}>
        <meshStandardMaterial color="#7a817b" roughness={0.7} metalness={0.28} />
      </Cylinder>
      <Cylinder args={[0.034, 0.046, 0.52, 7]} rotation={[0, 0, Math.PI / 2 + 0.04]} position={[-0.3, 0.43, -0.22]}>
        <meshStandardMaterial color="#4d5652" roughness={0.8} metalness={0.22} />
      </Cylinder>
      <Cylinder args={[0.054, 0.062, 0.42, 8]} rotation={[0, 0, Math.PI / 2 - 0.03]} position={[-0.65, 0.5, -0.22]}>
        <meshStandardMaterial color="#252d2e" roughness={0.84} metalness={0.18} />
      </Cylinder>
      <Cylinder args={[0.062, 0.042, 0.04, 8]} rotation={[0, 0, Math.PI / 2 - 0.03]} position={[-0.88, 0.53, -0.22]}>
        <meshStandardMaterial color="#11191a" roughness={0.82} metalness={0.22} />
      </Cylinder>
      <Box args={[0.31, 0.04, 0.07]} position={[-0.65, 0.575, -0.27]} rotation={[0, 0, 0.03]}>
        <meshStandardMaterial color="#59615d" roughness={0.7} metalness={0.2} />
      </Box>
      {[-0.77, -0.56].map((x) => (
        <Box key={`muffler-band-${x}`} args={[0.022, 0.075, 0.075]} position={[x, 0.5, -0.22]}>
          <meshStandardMaterial color="#8a918a" roughness={0.7} metalness={0.24} />
        </Box>
      ))}
      <Box args={[0.5, 0.04, 0.035]} position={[-0.42, 0.34, 0.18]} rotation={[0, 0, 0.05]}>
        <meshStandardMaterial color="#303a38" roughness={0.86} metalness={0.18} />
      </Box>
    </>
  )
}

function ScooterBody({
  bodyColor,
  wheelBase,
  wheelRadius,
  wheelRefs,
  riderColor,
  riderPants,
  style,
}: {
  bodyColor: string
  wheelBase: number
  wheelRadius: number
  wheelRefs: WheelRefs
  riderColor: string
  riderPants: string
  style: VehicleVisualConfig['style']
}) {
  const inner = '#263133'
  const sideAccent = '#929b98'

  return (
    <>
      {/* One continuous molded rear shell, fuller than an underbone side cover. */}
      <LoftedShell sections={SCOOTER_REAR_SECTIONS} color={bodyColor} roughness={0.7} />
      <ExtrudedPanel
        points={[[-0.78, 0.57], [-0.55, 0.77], [-0.18, 0.82], [0.02, 0.72], [-0.1, 0.56], [-0.54, 0.51]]}
        depth={0.035}
        position={[0, 0, 0.235]}
        color={sideAccent}
        roughness={0.78}
      />
      <ExtrudedPanel
        points={[[-0.54, 0.78], [-0.2, 0.84], [0.02, 0.77], [-0.04, 0.69], [-0.45, 0.71]]}
        depth={0.028}
        position={[0, 0, 0.255]}
        color="#b9beb9"
        roughness={0.64}
      />

      {/* Tall protective apron, split leg shield and dark inner footwell. */}
      <LoftedShell sections={SCOOTER_APRON_SECTIONS} color={bodyColor} roughness={0.66} />
      <ExtrudedPanel
        points={[[0.23, 0.48], [0.25, 0.78], [0.31, 1.02], [0.38, 1.2], [0.46, 1.23], [0.5, 1.06], [0.44, 0.84], [0.35, 0.56]]}
        depth={0.035}
        position={[0, 0, 0.24]}
        color="#d4d6d0"
        roughness={0.62}
      />
      <ExtrudedPanel
        points={[[0.08, 0.5], [0.15, 0.74], [0.28, 0.9], [0.36, 0.84], [0.3, 0.58], [0.22, 0.49]]}
        depth={0.05}
        position={[0, 0, 0.25]}
        color={inner}
        roughness={0.82}
      />
      <LoftedShell sections={SCOOTER_FLOORBOARD_SECTIONS} color={bodyColor} roughness={0.74} />
      <ExtrudedPanel
        points={[[-0.33, -0.035], [0.32, -0.035], [0.37, 0.015], [0.2, 0.045], [-0.26, 0.04], [-0.38, 0.005]]}
        depth={0.34}
        position={[-0.01, 0.53, 0]}
        color="#1b2527"
        roughness={0.94}
        bevelSize={0.006}
      />
      <Box args={[0.62, 0.025, 0.03]} position={[-0.01, 0.575, 0.19]} rotation={[0, 0, -0.02]}>
        <meshStandardMaterial color="#68716c" roughness={0.86} />
      </Box>

      {/* Long padded seat with a low tail that flows into the rear body. */}
      <LoftedShell sections={SCOOTER_SEAT_SECTIONS} color="#171f20" roughness={0.94} />
      <Cylinder args={[0.014, 0.014, 0.46, 6]} rotation={[0, 0, Math.PI / 2]} position={[-0.56, 1.09, 0]}>
        <meshStandardMaterial color="#303939" roughness={0.78} metalness={0.2} />
      </Cylinder>
      <Cylinder args={[0.014, 0.014, 0.1, 6]} position={[-0.76, 1.02, 0.12]}>
        <meshStandardMaterial color="#59635f" roughness={0.72} metalness={0.2} />
      </Cylinder>
      <Cylinder args={[0.014, 0.014, 0.1, 6]} position={[-0.76, 1.02, -0.12]}>
        <meshStandardMaterial color="#59635f" roughness={0.72} metalness={0.2} />
      </Cylinder>

      {/* Integrated front light, compact instrument cowl, bar and mirrors. */}
      <HeadlightHousing position={[0.52, 1.14, 0.255]} rotation={[0, 0, -0.16]} scale={0.84} />
      <Box args={[0.15, 0.07, 0.38]} position={[0.39, 1.42, 0]}>
        <meshStandardMaterial color="#313b3c" roughness={0.8} metalness={0.12} />
      </Box>
      <Box args={[0.12, 0.055, 0.26]} position={[0.38, 1.34, 0]}>
        <meshStandardMaterial color="#151d1f" roughness={0.42} metalness={0.1} />
      </Box>
      <Cylinder args={[0.018, 0.018, 0.18, 6]} rotation={[0, 0, -0.22]} position={[0.4, 1.5, 0.18]}>
        <meshStandardMaterial color="#303939" roughness={0.74} metalness={0.18} />
      </Cylinder>
      <Cylinder args={[0.018, 0.018, 0.18, 6]} rotation={[0, 0, -0.22]} position={[0.4, 1.5, -0.18]}>
        <meshStandardMaterial color="#303939" roughness={0.74} metalness={0.18} />
      </Cylinder>
      <Mirror position={[0.42, 1.57, 0.2]} />
      <Mirror position={[0.42, 1.57, -0.2]} />
      {[-1, 1].map((side) => (
        <Icosahedron key={`scooter-signal-${side}`} args={[0.052, 0]} position={[0.5, 0.96, side * 0.235]} scale={[0.7, 0.8, 1]}>
          <meshStandardMaterial color="#c77748" emissive="#5a321b" emissiveIntensity={0.12} roughness={0.42} />
        </Icosahedron>
      ))}

      {/* Forks, axle, close-fitting body-colored front fender and red front caliper. */}
      {[-1, 1].map((side) => (
        <group key={`scooter-fork-${side}`}>
          <Cylinder args={[0.017, 0.021, 0.48, 7]} rotation={[0, 0, -0.13]} position={[0.57, 0.54, side * 0.12]}>
            <meshStandardMaterial color="#b0b5ac" roughness={0.58} metalness={0.34} />
          </Cylinder>
          <Cylinder args={[0.026, 0.032, 0.17, 7]} rotation={[0, 0, -0.13]} position={[0.61, 0.34, side * 0.12]}>
            <meshStandardMaterial color="#4b5552" roughness={0.76} metalness={0.24} />
          </Cylinder>
        </group>
      ))}
      <Cylinder args={[0.038, 0.038, 0.24, 8]} rotation={[Math.PI / 2, 0, 0]} position={[wheelBase, WHEEL_LOCAL_Y, 0]}>
        <meshStandardMaterial color="#343e3c" roughness={0.72} metalness={0.3} />
      </Cylinder>
      <FrontMudguard position={[wheelBase, WHEEL_LOCAL_Y, 0]} radius={wheelRadius * 1.04} color={bodyColor} />
      <FrontMudguard position={[-wheelBase, WHEEL_LOCAL_Y, 0]} radius={wheelRadius * 1.04} color="#252f30" />
      <Box args={[0.11, 0.09, 0.075]} position={[wheelBase - 0.02, WHEEL_LOCAL_Y + 0.02, 0.16]} rotation={[0, 0, 0.34]}>
        <meshStandardMaterial color="#9d3e3c" roughness={0.7} />
      </Box>

      {/* Rear shock: dark damper with a readable red spring above the rear axle. */}
      <Cylinder args={[0.018, 0.023, 0.36, 7]} rotation={[0, 0, -0.46]} position={[-0.39, 0.66, 0.2]}>
        <meshStandardMaterial color="#313a38" roughness={0.75} metalness={0.2} />
      </Cylinder>
      {Array.from({ length: 6 }, (_, index) => (
        <Box key={`scooter-shock-${index}`} args={[0.045, 0.018, 0.035]} position={[-0.47 + index * 0.032, 0.59 + index * 0.043, 0.215]} rotation={[0, 0, -0.46]}>
          <meshStandardMaterial color="#b83f3c" emissive="#3d1413" emissiveIntensity={0.08} roughness={0.62} />
        </Box>
      ))}

      {/* Compact CVT / drivetrain mass instead of an exposed underbone engine. */}
      <Cylinder args={[0.17, 0.17, 0.11, 12]} rotation={[Math.PI / 2, 0, 0]} position={[-0.27, 0.44, 0.18]}>
        <meshStandardMaterial color="#4f5955" roughness={0.82} metalness={0.24} />
      </Cylinder>
      <Box args={[0.27, 0.25, 0.07]} position={[-0.28, 0.46, 0.2]} rotation={[0, 0, -0.08]}>
        <meshStandardMaterial color="#252f30" roughness={0.88} metalness={0.14} />
      </Box>
      {Array.from({ length: 5 }, (_, index) => (
        <Box key={`scooter-cvt-fin-${index}`} args={[0.18, 0.018, 0.025]} position={[-0.3, 0.39 + index * 0.035, 0.24]} rotation={[0, 0, -0.08]}>
          <meshStandardMaterial color="#727a73" roughness={0.72} metalness={0.22} />
        </Box>
      ))}

      {/* Chunky low-mounted exhaust and distinct heat shield. */}
      <Cylinder args={[0.09, 0.105, 0.5, 8]} rotation={[0, 0, Math.PI / 2 + 0.08]} position={[-0.63, 0.43, 0.23]}>
        <meshStandardMaterial color="#252d2e" roughness={0.86} metalness={0.18} />
      </Cylinder>
      <Cylinder args={[0.105, 0.07, 0.05, 8]} rotation={[0, 0, Math.PI / 2 + 0.08]} position={[-0.89, 0.47, 0.23]}>
        <meshStandardMaterial color="#11191a" roughness={0.84} metalness={0.2} />
      </Cylinder>
      <Box args={[0.38, 0.05, 0.17]} position={[-0.63, 0.54, 0.27]} rotation={[0, 0, 0.08]}>
        <meshStandardMaterial color="#5b645f" roughness={0.72} metalness={0.2} />
      </Box>
      {[-0.78, -0.55].map((x) => (
        <Box key={`scooter-exhaust-band-${x}`} args={[0.022, 0.08, 0.18]} position={[x, 0.45, 0.25]}>
          <meshStandardMaterial color="#90968f" roughness={0.68} metalness={0.24} />
        </Box>
      ))}

      {/* Tail lamp, tapered rear fender and downward plate holder. */}
      <Box args={[0.06, 0.11, 0.18]} position={[-0.94, 0.77, 0.235]} rotation={[0, 0, 0.1]}>
        <meshStandardMaterial color="#b74340" emissive="#3d1413" emissiveIntensity={0.12} roughness={0.5} />
      </Box>
      <ExtrudedPanel
        points={[[-0.86, 0.5], [-1.02, 0.34], [-1.13, 0.06], [-1.03, 0.1], [-0.82, 0.43]]}
        depth={0.16}
        position={[0, 0, 0]}
        color="#232c2d"
        roughness={0.88}
      />
      <Box args={[0.08, 0.16, 0.18]} position={[-1.04, 0.2, 0.05]} rotation={[0, 0, 0.16]}>
        <meshStandardMaterial color="#303a3a" roughness={0.84} />
      </Box>

      {[-wheelBase, wheelBase].map((x, index) => (
        <Wheel
          key={x}
          radius={wheelRadius}
          width={0.13}
          position={[x, WHEEL_LOCAL_Y, 0]}
          wheelRefs={wheelRefs}
          index={index}
          spokeCount={5}
        />
      ))}
      <Rider color={riderColor} pantsColor={riderPants} style={style} />
    </>
  )
}

function MotorcycleModel({ config, color, wheelRefs, heading: headingOverride }: { config: VehicleVisualConfig; color: string; wheelRefs: WheelRefs; heading?: number }) {
  const heading = headingOverride ?? (config.direction === 1 ? 0 : Math.PI)
  const style = getMotorcycleVisualStyle(config.style)
  const isUnderbone = style === 'underbone'
  const riderColor = ['#315e6a', '#6d7470', '#3d674c', '#a58a68', '#343b3d'][config.id % 5]
  const riderPants = config.id % 3 === 0 ? '#202b2d' : '#313b3d'
  const wheelBase = isUnderbone ? 0.65 : 0.64
  const wheelRadius = getVehicleWheelRadius(config)
  const wheelWidth = isUnderbone ? 0.1 : 0.13
  const bodyColor = color
  const dark = '#252e30'
  const metal = '#4b5351'
  const cockpitY = isUnderbone ? 1.09 : 1.26
  const visualOffsetY = getVehicleVisualOffsetY(config)

  return (
    <group position={[0, visualOffsetY, 0]} rotation={[0, heading, 0]}>
      {isUnderbone ? (
        <group position={[0, -0.17, 0]}>
          <UnderboneBody bodyColor={bodyColor} metal={metal} dark={dark} />
        </group>
      ) : (
        <ScooterBody
          bodyColor={bodyColor}
          wheelBase={wheelBase}
          wheelRadius={wheelRadius}
          wheelRefs={wheelRefs}
          riderColor={riderColor}
          riderPants={riderPants}
          style={style}
        />
      )}
      {isUnderbone && <>
      <Box args={[0.34, 0.07, 0.22]} position={[0.42, cockpitY, 0]}>
        <meshStandardMaterial color="#313b3c" roughness={0.82} metalness={0.1} />
      </Box>
      <Mirror position={[0.45, cockpitY - 0.01, 0.18]} />
      <Mirror position={[0.45, cockpitY - 0.01, -0.18]} />
      {[-wheelBase, wheelBase].map((x, index) => (
        <Wheel
          key={x}
          radius={wheelRadius}
          width={wheelWidth}
          position={[x, WHEEL_LOCAL_Y, 0]}
          wheelRefs={wheelRefs}
          index={index}
          spokeCount={isUnderbone ? 14 : 5}
        />
      ))}
      <Box args={[0.2, 0.07, 0.25]} position={[-wheelBase, 0.58, 0]}>
        <meshStandardMaterial color={dark} roughness={0.82} />
      </Box>
      <Rider color={riderColor} pantsColor={riderPants} style={style} />
      </>}
    </group>
  )
}

function LargeVehicleModel({ config, color, wheelRefs, heading: headingOverride }: { config: VehicleVisualConfig; color: string; wheelRefs: WheelRefs; heading?: number }) {
  const heading = headingOverride ?? (config.direction === 1 ? 0 : Math.PI)
  const isBus = config.kind === 'bus'
  const length = config.length
  const width = config.width
  const wheelPositions = isBus ? [-length * 0.31, length * 0.31] : [-length * 0.28, length * 0.31]
  const glass = '#263e43'
  const trim = '#263033'
  const visualOffsetY = getVehicleVisualOffsetY(config)

  return (
    <group position={[0, visualOffsetY, 0]} rotation={[0, heading, 0]}>
      {isBus ? (
        <>
          <Box args={[length * 0.98, 1.1, width]} position={[0, 0.86, 0]} castShadow>
            <meshStandardMaterial color={color} roughness={0.7} />
          </Box>
          <Box args={[length * 0.96, 0.12, width * 0.98]} position={[0, 1.46, 0]}>
            <meshStandardMaterial color="#d8d7ca" roughness={0.78} />
          </Box>
          <Box args={[0.72, 0.56, width * 0.86]} position={[length * 0.45, 1.22, 0]}>
            <meshStandardMaterial color={glass} roughness={0.28} />
          </Box>
          <Box args={[0.12, 0.14, width * 0.68]} position={[length * 0.5, 1.66, 0]}>
            <meshStandardMaterial color="#253237" roughness={0.3} />
          </Box>
          <Box args={[0.04, 0.08, width * 0.35]} position={[length * 0.515, 1.66, -width * 0.19]}>
            <meshStandardMaterial color="#e7cf77" emissive="#573f13" emissiveIntensity={0.16} />
          </Box>
          <Box args={[0.08, 0.16, width + 0.04]} position={[length * 0.5, 0.55, 0]}>
            <meshStandardMaterial color={trim} roughness={0.84} />
          </Box>
          <Box args={[0.07, 0.14, width * 0.18]} position={[length * 0.515, 0.78, -width * 0.3]}>
            <meshStandardMaterial color="#f1d378" emissive="#573f13" emissiveIntensity={0.24} />
          </Box>
          <Box args={[0.07, 0.14, width * 0.18]} position={[length * 0.515, 0.78, width * 0.3]}>
            <meshStandardMaterial color="#f1d378" emissive="#573f13" emissiveIntensity={0.24} />
          </Box>
          {Array.from({ length: 6 }, (_, index) => {
            const x = -length * 0.36 + index * length * 0.14
            return (
              <group key={x}>
                <Box args={[length * 0.105, 0.43, 0.045]} position={[x, 1.22, width * 0.51]}>
                  <meshStandardMaterial color={glass} roughness={0.32} />
                </Box>
                <Box args={[length * 0.105, 0.43, 0.045]} position={[x, 1.22, -width * 0.51]}>
                  <meshStandardMaterial color={glass} roughness={0.32} />
                </Box>
              </group>
            )
          })}
          {[length * 0.08, length * 0.33].map((x) => (
            <group key={x}>
              <Box args={[0.045, 0.52, 0.05]} position={[x, 0.94, width * 0.515]}>
                <meshStandardMaterial color="#425152" roughness={0.76} />
              </Box>
              <Box args={[0.045, 0.52, 0.05]} position={[x, 0.94, -width * 0.515]}>
                <meshStandardMaterial color="#425152" roughness={0.76} />
              </Box>
            </group>
          ))}
          <Box args={[length * 0.98, 0.16, width * 0.95]} position={[0, 0.3, 0]}>
            <meshStandardMaterial color="#e6e2d4" roughness={0.76} />
          </Box>
        </>
      ) : (
        <>
          <Box args={[length * 0.35, 1.0, width]} position={[length * 0.31, 0.78, 0]} castShadow>
            <meshStandardMaterial color={color} roughness={0.7} />
          </Box>
          <Box args={[length * 0.54, 1.42, width * 0.93]} position={[-length * 0.17, 0.98, 0]} castShadow>
            <meshStandardMaterial color="#c5c3b8" roughness={0.82} />
          </Box>
          <Box args={[length * 0.32, 0.48, width * 0.84]} position={[length * 0.41, 1.16, 0]}>
            <meshStandardMaterial color={glass} roughness={0.3} />
          </Box>
          <Box args={[0.1, 0.15, width + 0.04]} position={[length * 0.5, 0.74, 0]}>
            <meshStandardMaterial color={trim} roughness={0.8} />
          </Box>
          <Box args={[0.08, 0.13, width * 0.2]} position={[length * 0.51, 0.9, -width * 0.3]}>
            <meshStandardMaterial color="#f1d378" emissive="#573f13" emissiveIntensity={0.22} />
          </Box>
          <Box args={[0.08, 0.13, width * 0.2]} position={[length * 0.51, 0.9, width * 0.3]}>
            <meshStandardMaterial color="#f1d378" emissive="#573f13" emissiveIntensity={0.22} />
          </Box>
          {Array.from({ length: 5 }, (_, index) => {
            const x = -length * 0.42 + index * length * 0.13
            return (
              <group key={x}>
                <Box args={[0.035, 1.12, 0.035]} position={[x, 0.98, width * 0.475]}>
                  <meshStandardMaterial color="#9b9d98" roughness={0.58} metalness={0.12} />
                </Box>
                <Box args={[0.035, 1.12, 0.035]} position={[x, 0.98, -width * 0.475]}>
                  <meshStandardMaterial color="#9b9d98" roughness={0.58} metalness={0.12} />
                </Box>
              </group>
            )
          })}
          <Box args={[length * 0.5, 0.05, width * 0.9]} position={[-length * 0.17, 1.71, 0]}>
            <meshStandardMaterial color="#aeb0a9" roughness={0.72} />
          </Box>
          <Box args={[0.04, 1.18, 0.04]} position={[-length * 0.48, 0.99, width * 0.47]}>
            <meshStandardMaterial color="#68716e" roughness={0.7} metalness={0.12} />
          </Box>
          <Box args={[0.04, 1.18, 0.04]} position={[-length * 0.48, 0.99, -width * 0.47]}>
            <meshStandardMaterial color="#68716e" roughness={0.7} metalness={0.12} />
          </Box>
        </>
      )}
      {wheelPositions.map((x, axleIndex) => [-1, 1].map((side) => (
        <Wheel
          key={`${x}-${side}`}
          radius={0.36}
          width={0.2}
          position={[x, WHEEL_LOCAL_Y, side * width * 0.56]}
          side={side}
          wheelRefs={wheelRefs}
          index={axleIndex * 2 + (side === 1 ? 1 : 0)}
          spokeCount={6}
        />
      )))}
    </group>
  )
}

export function VehicleModel({ config, color, wheelRefs, heading }: { config: VehicleVisualConfig; color: string; wheelRefs: WheelRefs; heading?: number }) {
  if (config.kind === 'motorcycle') return <MotorcycleModel config={config} color={color} wheelRefs={wheelRefs} heading={heading} />
  if (config.kind === 'bus' || config.kind === 'truck') return <LargeVehicleModel config={config} color={color} wheelRefs={wheelRefs} heading={heading} />
  return <CarModel config={config} color={color} wheelRefs={wheelRefs} heading={heading} />
}

export function Vehicle({ config, trafficBoundaryX, getTraffic, onReset, onUpdate, playerState, intersectionRuntime }: VehicleProps) {
  const body = useRef<RapierRigidBody>(null)
  const visuals = useRef<THREE.Group>(null)
  const wheelRefs = useRef<Array<THREE.Object3D | null>>([])
  const nextTranslation = useRef({ x: 0, y: 0, z: 0 })
  const initialLateralOffset = clampLateralOffset(config, config.lateralBias)
  const runtime = useRef<VehicleRuntime>({
    active: config.spawnDelay === 0,
    wait: config.spawnDelay,
    spawnX: config.startX,
    lateralOffset: initialLateralOffset,
    targetLateralOffset: initialLateralOffset,
    speed: config.spawnDelay === 0 ? config.speed : 0,
    targetSpeed: config.speed,
  })
  const status = useGameStore((state) => state.status)
  const lose = useGameStore((state) => state.lose)
  const collisionTriggered = useRef(false)

  const isMotorcycle = config.kind === 'motorcycle'
  const isLarge = isLargeVehicle(config.kind)
  const color = getVehicleColor(config)
  const initialX = config.spawnDelay === 0 ? config.startX : config.direction === 1 ? -trafficBoundaryX : trafficBoundaryX
  const y = isMotorcycle ? 0.42 : isLarge ? 0.9 : 0.65

  const setNextTranslation = (x: number, z: number) => {
    nextTranslation.current.x = x
    nextTranslation.current.y = y
    nextTranslation.current.z = z
    body.current?.setNextKinematicTranslation(nextTranslation.current)
  }

  useEffect(() => {
    if (status !== 'playing') collisionTriggered.current = false
  }, [status])

  useFrame((_, delta) => {
    const rigidBody = body.current
    if (!rigidBody) return

    const frameDelta = Math.min(delta, 0.05)
    const state = runtime.current
    if (status !== 'playing') {
      state.active = false
      state.wait = config.spawnDelay
      state.spawnX = config.startX
      state.speed = 0
      state.targetSpeed = config.speed
      state.lateralOffset = initialLateralOffset
      state.targetLateralOffset = initialLateralOffset
      if (visuals.current) visuals.current.visible = false
      setNextTranslation(initialX, config.laneCenterZ)
      onUpdate(config.id, initialX, config.laneCenterZ, 0, false)
      return
    }
    if (state.wait > 0) {
      state.wait = Math.max(0, state.wait - frameDelta)
      if (state.wait === 0) {
        state.active = true
        state.speed = config.speed
        state.targetSpeed = config.speed
        state.lateralOffset = initialLateralOffset
        state.targetLateralOffset = initialLateralOffset
        setNextTranslation(state.spawnX, config.laneCenterZ)
      }
      if (visuals.current) visuals.current.visible = false
      onUpdate(config.id, state.spawnX, config.laneCenterZ + state.lateralOffset, 0, false)
      return
    }

    state.active = true
    if (visuals.current) visuals.current.visible = true

    const current = rigidBody.translation()
    const traffic = getTraffic()
    const lead = findLeadVehicle(config, current.x, config.laneCenterZ + state.lateralOffset, traffic)
    const playerRisk = getPlayerRisk(config, current.x, config.laneCenterZ + state.lateralOffset, playerState)
    const tuning = isMotorcycle ? TRAFFIC_TUNING.motorcycle : isLarge ? TRAFFIC_TUNING.large : TRAFFIC_TUNING.car

    let targetSpeed = config.speed
    if (lead) {
      const safeDistance = config.reactionDistance + state.speed * tuning.reactionTime
      const spacingError = lead.gap - safeDistance
      targetSpeed = Math.min(targetSpeed, Math.max(0, lead.snapshot.speed + spacingError * (isMotorcycle ? 0.95 : 0.82)))
    }

    if (playerRisk > 0) {
      const responseStrength = isMotorcycle ? 0.32 : isLarge ? 0.5 : 0.62
      targetSpeed = Math.min(targetSpeed, config.speed * (1 - playerRisk * responseStrength))
    }

    let stoppingForSignal = false
    let signalStopBoundary = 0
    if (intersectionRuntime && config.signalGroup && config.signalStopX !== undefined) {
      const light = intersectionRuntime.getLight(config.signalGroup)
      const stopLine = config.direction === 1 ? -config.signalStopX - config.length / 2 : config.signalStopX + config.length / 2
      const distanceToStop = (stopLine - current.x) * config.direction
      const shouldStop = light === 'red' || (light === 'yellow' && distanceToStop > 3.1)
      if (shouldStop && distanceToStop > 0 && distanceToStop < 10) {
        stoppingForSignal = true
        signalStopBoundary = stopLine
        targetSpeed = 0
      }
    }

    state.targetSpeed = THREE.MathUtils.clamp(targetSpeed, 0, config.speed)
    const speedChange = state.targetSpeed < state.speed ? tuning.braking : tuning.acceleration
    state.speed = moveTowards(state.speed, state.targetSpeed, speedChange * frameDelta)

    if (!isMotorcycle) {
      state.targetLateralOffset = clampLateralOffset(config, config.lateralBias)
    } else {
      state.targetLateralOffset = chooseMotorcycleOffset(config, state, current.x, traffic, playerState, lead)
    }
    state.lateralOffset = moveTowards(state.lateralOffset, state.targetLateralOffset, tuning.steerSpeed * frameDelta)
    const nextZ = config.laneCenterZ + state.lateralOffset

    let nextX = current.x + state.speed * config.direction * frameDelta
    if (lead) {
      const noOverlapBoundary = lead.snapshot.x - config.direction * ((config.length + lead.snapshot.length) / 2 + 0.12)
      nextX = config.direction === 1 ? Math.min(nextX, noOverlapBoundary) : Math.max(nextX, noOverlapBoundary)
    }
    if (stoppingForSignal && (nextX - signalStopBoundary) * config.direction > 0) nextX = signalStopBoundary

    if (!collisionTriggered.current && didVehicleHitPlayer({
      previous: { x: current.x, z: current.z, heading: config.direction === 1 ? 0 : Math.PI },
      next: { x: nextX, z: nextZ, heading: config.direction === 1 ? 0 : Math.PI },
      length: config.length,
      width: config.width,
      playerState,
      frameDelta,
    })) {
      collisionTriggered.current = true
      lose()
      return
    }

    const passedEnd = config.direction === 1 ? nextX > trafficBoundaryX : nextX < -trafficBoundaryX

    if (passedEnd) {
      const spawn = onReset(config.id)
      state.active = false
      state.wait = spawn.delay
      state.spawnX = spawn.x
      state.speed = 0
      state.targetSpeed = config.speed
      state.lateralOffset = initialLateralOffset
      state.targetLateralOffset = initialLateralOffset
      if (visuals.current) visuals.current.visible = false
      setNextTranslation(spawn.x, config.laneCenterZ + state.lateralOffset)
      onUpdate(config.id, spawn.x, config.laneCenterZ + state.lateralOffset, 0, false)
      return
    }

    setNextTranslation(nextX, nextZ)
    if (visuals.current) {
      visuals.current.rotation.y = !isMotorcycle
        ? 0
        : THREE.MathUtils.clamp((state.targetLateralOffset - state.lateralOffset) * config.direction * 0.16, -0.14, 0.14)
    }
    onUpdate(config.id, nextX, nextZ, state.speed, true)
    const angularVelocity = -(state.speed * config.direction) / getVehicleWheelRadius(config)
    wheelRefs.current.forEach((wheel) => {
      if (wheel) wheel.rotation.z += angularVelocity * frameDelta
    })
  })

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      position={[initialX, y, config.laneCenterZ]}
      colliders={false}
      collisionGroups={TRAFFIC_COLLISION_GROUPS}
      activeCollisionTypes={ACTIVE_COLLISION_TYPES_ALL}
      userData={{ isVehicle: true, vehicleId: config.id }}
      enabledRotations={[false, false, false]}
    >
      <CuboidCollider args={[config.length / 2, isMotorcycle ? 0.24 : isLarge ? 0.72 : 0.5, config.width / 2]} />
      <group ref={visuals} visible={runtime.current.active}>
        <VehicleModel config={config} color={color} wheelRefs={wheelRefs} />
      </group>
    </RigidBody>
  )
}
