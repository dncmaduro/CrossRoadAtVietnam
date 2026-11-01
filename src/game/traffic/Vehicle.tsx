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
    return style === 'underbone' ? 0.34 : style === 'sportScooter' ? 0.27 : 0.24
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
    const palette = style === 'scooter'
      ? ['#c6c9c2', '#e7e4dc', '#2f6e73', '#a85d57', '#1c2730']
      : style === 'sportScooter'
        ? ['#1c2730', '#3e4f58', '#a85d57', '#d6d2c9', '#29383c']
      : ['#c7c9c2', '#e1e1d7', '#c7c9c2', '#29383d', '#315d69', '#74383b', '#68746e']
    return palette[config.id % palette.length]
  }
  if (config.kind === 'car' && config.style === 'compactEv') {
    const palette = ['#d6bb3f', '#e7e4dc', '#9fc8cc', '#a85d57', '#2b3438']
    return palette[config.id % palette.length]
  }
  if (config.kind === 'bus' || config.kind === 'truck') return LARGE_VEHICLE_COLORS[config.id % LARGE_VEHICLE_COLORS.length]
  return CAR_COLORS[config.id % CAR_COLORS.length]
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

function TaperedPanel({
  size,
  topScale = 0.72,
  position,
  rotation,
  color,
  roughness = 0.72,
}: {
  size: [number, number, number]
  topScale?: number
  position: [number, number, number]
  rotation?: [number, number, number]
  color: string
  roughness?: number
}) {
  const geometry = useMemo(() => {
    const [length, height, width] = size
    const halfLength = length / 2
    const halfHeight = height / 2
    const halfWidth = width / 2
    const topLength = halfLength * topScale
    const topWidth = halfWidth * (0.78 + topScale * 0.22)
    const vertices = new Float32Array([
      -halfLength, -halfHeight, -halfWidth,
      halfLength, -halfHeight, -halfWidth,
      halfLength, -halfHeight, halfWidth,
      -halfLength, -halfHeight, halfWidth,
      -topLength, halfHeight, -topWidth,
      topLength, halfHeight, -topWidth,
      topLength, halfHeight, topWidth,
      -topLength, halfHeight, topWidth,
    ])
    const nextGeometry = new THREE.BufferGeometry()
    nextGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    nextGeometry.setIndex([
      0, 2, 1, 0, 3, 2,
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      1, 2, 6, 1, 6, 5,
      2, 3, 7, 2, 7, 6,
      3, 0, 4, 3, 4, 7,
    ])
    nextGeometry.computeVertexNormals()
    return nextGeometry
  }, [size, topScale])

  return (
    <mesh geometry={geometry} position={position} rotation={rotation} castShadow>
      <meshStandardMaterial color={color} roughness={roughness} flatShading />
    </mesh>
  )
}

function ExtrudedPanel({
  points,
  depth,
  position,
  rotation,
  color,
  roughness = 0.72,
  metalness = 0,
}: {
  points: Array<[number, number]>
  depth: number
  position: [number, number, number]
  rotation?: [number, number, number]
  color: string
  roughness?: number
  metalness?: number
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape()
    points.forEach(([x, y], index) => {
      if (index === 0) shape.moveTo(x, y)
      else shape.lineTo(x, y)
    })
    shape.closePath()
    const nextGeometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
      curveSegments: 1,
      steps: 1,
    })
    nextGeometry.translate(0, 0, -depth / 2)
    return nextGeometry
  }, [depth, points])

  return (
    <mesh geometry={geometry} position={position} rotation={rotation} castShadow>
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} flatShading />
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

function FrontMudguard({ position, radius }: { position: [number, number, number]; radius: number }) {
  const geometry = useMemo(() => new THREE.TorusGeometry(radius * 1.02, 0.022, 5, 16, Math.PI), [radius])
  return (
    <mesh geometry={geometry} position={position} castShadow>
      <meshStandardMaterial color="#252f30" roughness={0.84} />
    </mesh>
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
  const isSport = style === 'sportScooter'
  const footX = isUnderbone ? -0.03 : isSport ? 0.18 : 0.28
  const legRotation = isUnderbone ? 0.25 : isSport ? 0.06 : -0.1
  if (!isUnderbone) {
    return (
      <group position={[-0.08, 0, 0]}>
        <Box args={[0.3, 0.48, 0.28]} position={[-0.1, 1.12, 0]} rotation={[0, 0, isSport ? -0.08 : 0]}>
          <meshStandardMaterial color={color} roughness={0.86} />
        </Box>
        <Box args={[0.24, 0.16, 0.3]} position={[-0.1, 1.38, 0]}>
          <meshStandardMaterial color={isSport ? '#303b43' : color} roughness={0.8} />
        </Box>
        <Icosahedron args={[0.19, 1]} position={[0.02, 1.58, 0]}>
          <meshStandardMaterial color="#273438" roughness={0.58} />
        </Icosahedron>
        <Box args={[0.22, 0.045, 0.2]} position={[0.09, 1.5, 0.02]} rotation={[0, 0, -0.08]}>
          <meshStandardMaterial color="#111a1b" roughness={0.32} metalness={0.08} />
        </Box>
        <Box args={[0.43, 0.07, 0.07]} position={[0.2, 1.34, 0.13]} rotation={[0, 0, isSport ? -0.34 : -0.22]}>
          <meshStandardMaterial color={color} roughness={0.88} />
        </Box>
        <Box args={[0.43, 0.07, 0.07]} position={[0.2, 1.34, -0.13]} rotation={[0, 0, isSport ? -0.34 : -0.22]}>
          <meshStandardMaterial color={color} roughness={0.88} />
        </Box>
        <Box args={[0.45, 0.08, 0.09]} position={[footX - 0.24, 0.79, 0.14]} rotation={[0, 0, legRotation]}>
          <meshStandardMaterial color="#303b3d" roughness={0.86} />
        </Box>
        <Box args={[0.45, 0.08, 0.09]} position={[footX - 0.24, 0.79, -0.14]} rotation={[0, 0, legRotation]}>
          <meshStandardMaterial color="#303b3d" roughness={0.86} />
        </Box>
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
      <Icosahedron args={[0.2, 1]} position={[0.02, 1.66, 0]} scale={[1.04, 0.58, 1.04]}>
        <meshStandardMaterial color="#253236" roughness={0.58} />
      </Icosahedron>
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
          <Box args={[0.34, 0.1, 0.1]} position={[0.02, 0.94, side * 0.14]} rotation={[0, 0, 2.28]}>
            <meshStandardMaterial color={pantsColor} roughness={0.9} />
          </Box>
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
      {/* Layered upright front cowl, separate bezel, lens, and lower neck. */}
      <ExtrudedPanel points={[[-0.12, -0.18], [-0.11, 0.14], [-0.03, 0.23], [0.11, 0.13], [0.1, -0.17]]} depth={0.28} position={[0.5, 0.98, 0]} rotation={[0, 0, -0.1]} color={bodyColor} roughness={0.68} />
      <ExtrudedPanel points={[[-0.08, -0.1], [-0.07, 0.13], [0.01, 0.2], [0.08, 0.08], [0.07, -0.1]]} depth={0.22} position={[0.62, 1.03, 0]} color="#252f30" roughness={0.72} metalness={0.18} />
      <ExtrudedPanel points={[[-0.045, -0.06], [-0.04, 0.07], [0.01, 0.12], [0.045, 0.04], [0.04, -0.06]]} depth={0.18} position={[0.644, 1.03, 0]} color="#d5d4b8" roughness={0.28} />
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

      {/* Longer, thinner seat and a rear body that tapers away from the engine. */}
      <ExtrudedPanel points={[[-0.48, -0.04], [-0.4, 0.03], [0.29, 0.035], [0.48, -0.008], [0.38, -0.04]]} depth={0.22} position={[-0.22, 0.98, 0]} rotation={[0, 0, -0.035]} color="#171f20" roughness={0.92} />
      <Box args={[0.84, 0.05, 0.19]} position={[-0.22, 0.91, 0]} rotation={[0, 0, -0.035]}>
        <meshStandardMaterial color="#2b3333" roughness={0.94} />
      </Box>
      <TaperedPanel size={[0.28, 0.18, 0.2]} topScale={0.58} position={[-0.62, 0.77, 0]} rotation={[0, 0, 0.1]} color={sidePanelColor} roughness={0.78} />
      <ExtrudedPanel points={[[-0.1, -0.06], [-0.08, 0.05], [0.02, 0.09], [0.1, 0.02], [0.06, -0.06]]} depth={0.16} position={[-0.81, 0.83, 0]} rotation={[0, 0, 0.16]} color={sidePanelColor} roughness={0.8} />
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
      <Box args={[0.36, 0.25, 0.28]} position={[-0.18, 0.54, 0]}>
        <meshStandardMaterial color="#242d2e" roughness={0.9} metalness={0.12} />
      </Box>
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

function MotorcycleModel({ config, color, wheelRefs, heading: headingOverride }: { config: VehicleVisualConfig; color: string; wheelRefs: WheelRefs; heading?: number }) {
  const heading = headingOverride ?? (config.direction === 1 ? 0 : Math.PI)
  const style = getMotorcycleVisualStyle(config.style)
  const isUnderbone = style === 'underbone'
  const isSportScooter = style === 'sportScooter'
  const riderColor = ['#315e6a', '#6d7470', '#3d674c', '#a58a68', '#343b3d'][config.id % 5]
  const riderPants = config.id % 3 === 0 ? '#202b2d' : '#313b3d'
  const wheelBase = isUnderbone ? 0.65 : isSportScooter ? 0.64 : 0.62
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
      ) : isSportScooter ? (
        <>
          <Box args={[0.94, 0.24, 0.43]} position={[-0.02, 0.59, 0]} rotation={[0, 0, -0.04]}>
            <meshStandardMaterial color={bodyColor} roughness={0.68} />
          </Box>
          <Box args={[0.86, 0.2, 0.46]} position={[-0.1, 0.48, 0]}>
            <meshStandardMaterial color="#20282a" roughness={0.78} />
          </Box>
          <Box args={[0.3, 0.66, 0.42]} position={[0.47, 0.86, 0]} rotation={[0, 0, -0.08]}>
            <meshStandardMaterial color={bodyColor} roughness={0.68} />
          </Box>
          <Box args={[0.24, 0.25, 0.45]} position={[0.63, 0.66, 0]} rotation={[0, 0, 0.12]}>
            <meshStandardMaterial color={bodyColor} roughness={0.72} />
          </Box>
          <Box args={[0.42, 0.34, 0.04]} position={[0.51, 0.92, 0]}>
            <meshStandardMaterial color="#1f2b2d" roughness={0.46} />
          </Box>
          <Box args={[0.86, 0.16, 0.46]} position={[-0.28, 0.78, 0]}>
            <meshStandardMaterial color={bodyColor} roughness={0.7} />
          </Box>
          <Box args={[0.76, 0.13, 0.38]} position={[-0.27, 0.95, 0]}>
            <meshStandardMaterial color="#20282a" roughness={0.88} />
          </Box>
          <Box args={[0.46, 0.14, 0.035]} position={[-0.16, 0.7, 0.24]}>
            <meshStandardMaterial color="#343e40" roughness={0.62} />
          </Box>
          <Box args={[0.32, 0.08, 0.03]} position={[0.1, 0.76, -0.24]}>
            <meshStandardMaterial color="#8d4744" roughness={0.62} />
          </Box>
          <Box args={[0.48, 0.08, 0.08]} position={[0.51, 1.19, 0]}>
            <meshStandardMaterial color="#303738" roughness={0.8} metalness={0.12} />
          </Box>
          <Cylinder args={[0.08, 0.1, 0.12, 8]} rotation={[Math.PI / 2, 0, 0]} position={[0.66, 1.04, 0]}>
            <meshStandardMaterial color="#f1d378" emissive="#6e4b17" emissiveIntensity={0.2} />
          </Cylinder>
          <Box args={[0.18, 0.05, 0.12]} position={[0.72, 0.81, 0]}>
            <meshStandardMaterial color="#1b2527" roughness={0.72} />
          </Box>
          <Cylinder args={[0.045, 0.06, 0.62, 7]} rotation={[0, 0, -0.13]} position={[0.42, 0.4, -0.27]}>
            <meshStandardMaterial color="#555c59" roughness={0.82} metalness={0.16} />
          </Cylinder>
          <Cylinder args={[0.055, 0.07, 0.62, 7]} rotation={[0, 0, -0.13]} position={[0.42, 0.4, 0.27]}>
            <meshStandardMaterial color="#555c59" roughness={0.82} metalness={0.16} />
          </Cylinder>
          <Cylinder args={[0.14, 0.14, 0.018, 8]} rotation={[Math.PI / 2, 0, 0]} position={[wheelBase, WHEEL_LOCAL_Y, 0.08]}>
            <meshStandardMaterial color="#a8aaa0" roughness={0.6} metalness={0.28} />
          </Cylinder>
        </>
      ) : (
        <>
          <Box args={[0.92, 0.2, 0.4]} position={[-0.02, 0.58, 0]}>
            <meshStandardMaterial color={bodyColor} roughness={0.7} />
          </Box>
          <Box args={[0.58, 0.08, 0.4]} position={[-0.02, 0.65, 0]}>
            <meshStandardMaterial color="#252e30" roughness={0.84} />
          </Box>
          <Box args={[0.31, 0.55, 0.37]} position={[0.43, 0.84, 0]} rotation={[0, 0, -0.04]}>
            <meshStandardMaterial color={bodyColor} roughness={0.72} />
          </Box>
          <Box args={[0.23, 0.25, 0.36]} position={[0.56, 0.65, 0]}>
            <meshStandardMaterial color="#303b3d" roughness={0.62} />
          </Box>
          <Box args={[0.26, 0.3, 0.32]} position={[-0.4, 0.76, 0]}>
            <meshStandardMaterial color={bodyColor} roughness={0.72} />
          </Box>
          <Box args={[0.7, 0.12, 0.34]} position={[-0.3, 0.93, 0]}>
            <meshStandardMaterial color="#20282a" roughness={0.88} />
          </Box>
          <Box args={[0.56, 0.1, 0.34]} position={[0.12, 0.69, 0]}>
            <meshStandardMaterial color="#293536" roughness={0.78} />
          </Box>
          <Box args={[0.48, 0.06, 0.08]} position={[0.48, 1.18, 0]}>
            <meshStandardMaterial color="#303738" roughness={0.8} metalness={0.12} />
          </Box>
          <Cylinder args={[0.09, 0.12, 0.12, 8]} rotation={[Math.PI / 2, 0, 0]} position={[0.6, 1.02, 0]}>
            <meshStandardMaterial color="#e7d27b" emissive="#6e4b17" emissiveIntensity={0.18} />
          </Cylinder>
          <Cylinder args={[0.04, 0.055, 0.6, 7]} rotation={[0, 0, -0.12]} position={[0.42, 0.4, -0.24]}>
            <meshStandardMaterial color="#555c59" roughness={0.82} metalness={0.16} />
          </Cylinder>
          <Box args={[0.58, 0.08, 0.04]} position={[-0.34, 0.36, 0.2]}>
            <meshStandardMaterial color="#303938" roughness={0.84} metalness={0.18} />
          </Box>
          <Box args={[0.08, 0.08, 0.07]} position={[-0.58, 0.62, 0]}>
            <meshStandardMaterial color="#b84d49" emissive="#3d1412" emissiveIntensity={0.16} />
          </Box>
        </>
      )}
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
