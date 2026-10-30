import { useEffect, useRef, type MutableRefObject } from 'react'
import { Box, Cylinder, Icosahedron } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { useGameStore } from '../../store/gameStore'
import type { IntersectionRuntime } from '../intersection/intersection.runtime'
import type { SpawnInstruction } from './TrafficManager'
import type { VehicleConfig, VehicleKind } from './traffic.config'
import { CAR_COLORS, LARGE_VEHICLE_COLORS, TRAFFIC_TUNING } from './traffic.config'
import { ACTIVE_COLLISION_TYPES_ALL, didVehicleHitPlayer, TRAFFIC_COLLISION_GROUPS } from './trafficPhysics'
import type { PlayerTrafficState, TrafficSnapshot } from './traffic.types'

type VehicleProps = {
  config: VehicleConfig
  onReset: (id: number) => SpawnInstruction
  onUpdate: (id: number, x: number, z: number, speed: number, active: boolean) => void
  getTraffic: () => Map<number, TrafficSnapshot>
  playerState: PlayerTrafficState
  intersectionRuntime: IntersectionRuntime | null
}

type WheelRefs = MutableRefObject<Array<THREE.Mesh | null>>
export type VehicleVisualConfig = Pick<VehicleConfig, 'id' | 'kind' | 'direction' | 'width' | 'length' | 'style'>

// Traffic advances along X, so each wheel axle runs laterally along Z.
// CylinderGeometry is Y-axis aligned by default; this rotation turns its axle into Z.
const WHEEL_AXLE_ROTATION: [number, number, number] = [Math.PI / 2, 0, 0]
const ROAD_SURFACE_Y = -0.02
const WHEEL_LOCAL_Y = 0.29

function getVehicleWheelRadius(config: VehicleVisualConfig) {
  if (config.kind === 'motorcycle') {
    return config.style === 'underbone' ? 0.3 : config.style === 'sportScooter' ? 0.27 : 0.24
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
    const palette = config.style === 'scooter'
      ? ['#c6c9c2', '#e7e4dc', '#2f6e73', '#a85d57', '#1c2730']
      : config.style === 'sportScooter'
        ? ['#1c2730', '#3e4f58', '#a85d57', '#d6d2c9', '#29383c']
        : ['#53635e', '#1c2730', '#2f6e73', '#7b3035', '#7c827c']
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
  return (
    <group position={position}>
      <Cylinder
        ref={(node) => {
          if (wheelRefs && index !== undefined) wheelRefs.current[index] = node
        }}
        args={[radius, radius, width, 10]}
        rotation={WHEEL_AXLE_ROTATION}
        castShadow
      >
        <meshStandardMaterial color="#202729" roughness={0.94} />
      </Cylinder>
      <Cylinder args={[radius * 0.42, radius * 0.42, width + 0.018, 8]} rotation={WHEEL_AXLE_ROTATION}>
        <meshStandardMaterial color="#69716e" roughness={0.62} metalness={0.24} />
      </Cylinder>
      {Array.from({ length: spokeCount }, (_, spokeIndex) => {
        const angle = (spokeIndex / spokeCount) * Math.PI * 2 + Math.PI / 10
        const spokeRadius = radius * 0.34
        return (
          <Box
            key={spokeIndex}
            args={[radius * 0.62, radius * 0.055, width * 0.18]}
            position={[Math.cos(angle) * spokeRadius, Math.sin(angle) * spokeRadius, side * (width / 2 + 0.014)]}
            rotation={[0, 0, angle]}
          >
            <meshStandardMaterial color="#394342" roughness={0.72} metalness={0.18} />
          </Box>
        )
      })}
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
        <meshStandardMaterial color="#1e292b" roughness={0.34} metalness={0.08} />
      </Icosahedron>
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

function Rider({ color, style }: { color: string; style?: VehicleVisualConfig['style'] }) {
  const isUnderbone = style === 'underbone'
  const isSport = style === 'sportScooter'
  const footX = isUnderbone ? -0.03 : isSport ? 0.18 : 0.28
  const legRotation = isUnderbone ? 0.25 : isSport ? 0.06 : -0.1
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

function MotorcycleModel({ config, color, wheelRefs, heading: headingOverride }: { config: VehicleVisualConfig; color: string; wheelRefs: WheelRefs; heading?: number }) {
  const heading = headingOverride ?? (config.direction === 1 ? 0 : Math.PI)
  const style = config.style ?? 'scooter'
  const isUnderbone = style === 'underbone'
  const isSportScooter = style === 'sportScooter'
  const riderColor = config.id % 2 === 0 ? '#53635e' : '#6d4e42'
  const wheelBase = isUnderbone ? 0.62 : isSportScooter ? 0.64 : 0.62
  const wheelRadius = getVehicleWheelRadius(config)
  const bodyColor = color
  const dark = '#252e30'
  const metal = '#4b5351'
  const visualOffsetY = getVehicleVisualOffsetY(config)

  return (
    <group position={[0, visualOffsetY, 0]} rotation={[0, heading, 0]}>
      {isUnderbone ? (
        <>
          <Box args={[0.22, 0.56, 0.27]} position={[0.47, 0.86, 0]} rotation={[0, 0, -0.05]}>
            <meshStandardMaterial color={bodyColor} roughness={0.68} />
          </Box>
          <Box args={[0.2, 0.2, 0.3]} position={[0.57, 0.65, 0]}>
            <meshStandardMaterial color="#334144" roughness={0.58} />
          </Box>
          <Box args={[0.72, 0.13, 0.17]} position={[-0.08, 0.63, 0]} rotation={[0, 0, -0.12]}>
            <meshStandardMaterial color={metal} roughness={0.82} metalness={0.12} />
          </Box>
          <Box args={[0.34, 0.17, 0.28]} position={[-0.2, 0.77, 0]}>
            <meshStandardMaterial color={bodyColor} roughness={0.72} />
          </Box>
          <Box args={[0.68, 0.13, 0.3]} position={[-0.28, 0.91, 0]}>
            <meshStandardMaterial color="#20282a" roughness={0.88} />
          </Box>
          <Box args={[0.26, 0.25, 0.28]} position={[-0.52, 0.77, 0]} rotation={[0, 0, -0.1]}>
            <meshStandardMaterial color={bodyColor} roughness={0.72} />
          </Box>
          <Box args={[0.19, 0.14, 0.23]} position={[-0.04, 0.43, 0.16]}>
            <meshStandardMaterial color="#343f40" roughness={0.84} metalness={0.22} />
          </Box>
          <Box args={[0.25, 0.2, 0.2]} position={[-0.22, 0.43, 0.16]}>
            <meshStandardMaterial color="#3b4544" roughness={0.86} metalness={0.18} />
          </Box>
          <Box args={[0.22, 0.13, 0.22]} position={[-0.4, 0.48, 0.16]}>
            <meshStandardMaterial color="#283132" roughness={0.84} />
          </Box>
          <Box args={[0.3, 0.08, 0.04]} position={[-0.02, 0.31, 0.2]}>
            <meshStandardMaterial color="#181f20" roughness={0.8} metalness={0.2} />
          </Box>
          <Cylinder args={[0.045, 0.06, 0.72, 7]} rotation={[0, Math.PI / 2, 0]} position={[-0.32, 0.36, -0.19]}>
            <meshStandardMaterial color="#555b57" roughness={0.78} metalness={0.2} />
          </Cylinder>
          <Cylinder args={[0.04, 0.05, 0.38, 7]} rotation={[0, 0, -0.14]} position={[-0.5, 0.52, -0.19]}>
            <meshStandardMaterial color="#505a56" roughness={0.82} metalness={0.18} />
          </Cylinder>
        </>
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
          <Cylinder args={[0.14, 0.14, 0.018, 8]} rotation={WHEEL_AXLE_ROTATION} position={[wheelBase, WHEEL_LOCAL_Y, 0.08]}>
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
      <Box args={[0.34, 0.07, 0.22]} position={[0.42, 1.26, 0]}>
        <meshStandardMaterial color="#313b3c" roughness={0.82} metalness={0.1} />
      </Box>
      <Mirror position={[0.45, 1.25, 0.18]} />
      <Mirror position={[0.45, 1.25, -0.18]} />
      {[-wheelBase, wheelBase].map((x, index) => (
        <Wheel
          key={x}
          radius={wheelRadius}
          width={0.13}
          position={[x, WHEEL_LOCAL_Y, 0]}
          wheelRefs={wheelRefs}
          index={index}
          spokeCount={isUnderbone ? 6 : 5}
        />
      ))}
      <Box args={[0.2, 0.07, 0.25]} position={[-wheelBase, 0.58, 0]}>
        <meshStandardMaterial color={dark} roughness={0.82} />
      </Box>
      <Rider color={riderColor} style={style} />
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

export function Vehicle({ config, getTraffic, onReset, onUpdate, playerState, intersectionRuntime }: VehicleProps) {
  const body = useRef<RapierRigidBody>(null)
  const visuals = useRef<THREE.Group>(null)
  const wheelRefs = useRef<Array<THREE.Mesh | null>>([])
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
  const initialX = config.spawnDelay === 0 ? config.startX : config.direction === 1 ? -20.5 : 20.5
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

    const passedEnd = config.direction === 1 ? nextX > TRAFFIC_TUNING.vehicleEndX : nextX < -TRAFFIC_TUNING.vehicleEndX

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
    wheelRefs.current.forEach((wheel) => {
      if (wheel) wheel.rotation.z += state.speed * config.direction * frameDelta * 1.45
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
