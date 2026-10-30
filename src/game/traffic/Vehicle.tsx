import { useRef, type MutableRefObject } from 'react'
import { Box, Cylinder, Icosahedron } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { useGameStore } from '../../store/gameStore'
import type { IntersectionRuntime } from '../intersection/intersection.runtime'
import type { SpawnInstruction } from './TrafficManager'
import type { VehicleConfig, VehicleKind } from './traffic.config'
import { CAR_COLORS, LARGE_VEHICLE_COLORS, MOTORCYCLE_COLORS, TRAFFIC_TUNING } from './traffic.config'
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

function CarModel({ config, color, wheelRefs, heading: headingOverride }: { config: VehicleVisualConfig; color: string; wheelRefs: WheelRefs; heading?: number }) {
  const heading = headingOverride ?? (config.direction === 1 ? 0 : Math.PI)
  const isCompactEv = config.style === 'compactEv'

  return (
    <group rotation={[0, heading, 0]}>
      <Box args={[config.length, 0.62, config.width]} position={[0, 0.44, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.66} />
      </Box>
      <Box args={[config.length * (isCompactEv ? 0.68 : 0.52), isCompactEv ? 0.52 : 0.42, config.width * 0.84]} position={[-0.12, isCompactEv ? 0.94 : 0.92, 0]} castShadow>
        <meshStandardMaterial color="#79979b" metalness={0.04} roughness={0.3} />
      </Box>
      {isCompactEv && (
        <Box args={[config.length * 0.42, 0.11, config.width * 0.76]} position={[-0.12, 1.22, 0]}>
          <meshStandardMaterial color={color} roughness={0.68} />
        </Box>
      )}
      <Box args={[config.length * 0.28, 0.22, 0.035]} position={[-0.12, 0.96, -config.width * 0.435]}>
        <meshStandardMaterial color="#30464a" roughness={0.3} />
      </Box>
      <Box args={[config.length * 0.28, 0.22, 0.035]} position={[-0.12, 0.96, config.width * 0.435]}>
        <meshStandardMaterial color="#30464a" roughness={0.3} />
      </Box>
      <Box args={[0.18, 0.16, config.width + 0.03]} position={[config.length * 0.42, 0.46, 0]}>
        <meshStandardMaterial color="#f4d375" emissive="#4d3512" emissiveIntensity={0.32} />
      </Box>
      <Box args={[0.14, 0.14, config.width + 0.08]} position={[-config.length * 0.44, 0.43, 0]}>
        <meshStandardMaterial color="#a64842" emissive="#3d1412" emissiveIntensity={0.18} />
      </Box>
      <Box args={[0.12, 0.14, config.width + 0.12]} position={[config.length * 0.48, 0.24, 0]}>
        <meshStandardMaterial color="#4f5755" roughness={0.78} metalness={0.16} />
      </Box>
      <Box args={[0.12, 0.14, config.width + 0.12]} position={[-config.length * 0.48, 0.24, 0]}>
        <meshStandardMaterial color="#4f5755" roughness={0.78} metalness={0.16} />
      </Box>
      {[-1, 1].map((side) => (
        <Box key={side} args={[0.04, 0.12, 0.34]} position={[side * config.length * 0.505, 0.5, 0]}>
          <meshStandardMaterial color="#eee6cf" roughness={0.72} />
        </Box>
      ))}
      {[-0.82, 0.82].map((x, index) => (
        <group key={x}>
          {[-1, 1].map((side) => (
            <group key={side}>
              <Cylinder
                ref={(node) => {
                  wheelRefs.current[index + (side === 1 ? 2 : 0)] = node
                }}
                args={[0.25, 0.25, 0.14, 10]}
                rotation={[Math.PI / 2, 0, 0]}
                position={[x, 0.22, side * config.width * 0.54]}
              >
                <meshStandardMaterial color="#22292b" roughness={0.92} />
              </Cylinder>
              <Cylinder
                args={[0.1, 0.1, 0.15, 10]}
                rotation={[Math.PI / 2, 0, 0]}
                position={[x, 0.22, side * (config.width * 0.54 + 0.01)]}
              >
                <meshStandardMaterial color="#b6b8ad" roughness={0.62} metalness={0.24} />
              </Cylinder>
            </group>
          ))}
        </group>
      ))}
      <Box args={[0.12, 0.14, 0.1]} position={[0.28, 0.78, -config.width * 0.58]}>
        <meshStandardMaterial color="#303938" roughness={0.8} metalness={0.1} />
      </Box>
      <Box args={[0.12, 0.14, 0.1]} position={[0.28, 0.78, config.width * 0.58]}>
        <meshStandardMaterial color="#303938" roughness={0.8} metalness={0.1} />
      </Box>
    </group>
  )
}

function Rider({ color }: { color: string }) {
  return (
    <group position={[-0.04, 0, 0]}>
      <Box args={[0.3, 0.5, 0.28]} position={[-0.08, 1.12, 0]}>
        <meshStandardMaterial color={color} roughness={0.86} />
      </Box>
      <Icosahedron args={[0.19, 1]} position={[0.02, 1.55, 0]}>
        <meshStandardMaterial color="#273438" roughness={0.58} />
      </Icosahedron>
      <Box args={[0.42, 0.07, 0.07]} position={[0.2, 1.34, 0.13]} rotation={[0, 0, -0.24]}>
        <meshStandardMaterial color={color} roughness={0.88} />
      </Box>
      <Box args={[0.42, 0.07, 0.07]} position={[0.2, 1.34, -0.13]} rotation={[0, 0, -0.24]}>
        <meshStandardMaterial color={color} roughness={0.88} />
      </Box>
      <Box args={[0.48, 0.08, 0.09]} position={[-0.3, 0.78, 0.14]} rotation={[0, 0, 0.25]}>
        <meshStandardMaterial color="#303b3d" roughness={0.86} />
      </Box>
      <Box args={[0.48, 0.08, 0.09]} position={[-0.3, 0.78, -0.14]} rotation={[0, 0, 0.25]}>
        <meshStandardMaterial color="#303b3d" roughness={0.86} />
      </Box>
    </group>
  )
}

function MotorcycleModel({ config, color, wheelRefs, heading: headingOverride }: { config: VehicleVisualConfig; color: string; wheelRefs: WheelRefs; heading?: number }) {
  const heading = headingOverride ?? (config.direction === 1 ? 0 : Math.PI)
  const isScooter = config.style !== 'underbone'
  const isSportScooter = config.style === 'sportScooter'
  const riderColor = config.id % 2 === 0 ? '#53635e' : '#6d4e42'

  return (
    <group rotation={[0, heading, 0]} scale={0.86}>
      {isScooter ? (
        <>
          <Box args={[isSportScooter ? 1.12 : 0.98, isSportScooter ? 0.32 : 0.28, isSportScooter ? 0.4 : 0.35]} position={[0, 0.56, 0]}>
            <meshStandardMaterial color={color} roughness={0.68} />
          </Box>
          <Box args={[isSportScooter ? 0.44 : 0.36, isSportScooter ? 0.72 : 0.66, isSportScooter ? 0.33 : 0.29]} position={[isSportScooter ? 0.46 : 0.44, 0.8, 0]}>
            <meshStandardMaterial color={color} roughness={0.7} />
          </Box>
          {isSportScooter && (
            <Box args={[0.18, 0.42, 0.42]} position={[0.68, 0.92, 0]} rotation={[0, 0, -0.1]}>
              <meshStandardMaterial color="#263436" roughness={0.62} />
            </Box>
          )}
          <Box args={[0.58, 0.12, 0.35]} position={[-0.2, 0.78, 0]}>
            <meshStandardMaterial color="#242d2e" roughness={0.86} />
          </Box>
          <Box args={[0.46, 0.06, 0.08]} position={[0.49, 1.15, 0]}>
            <meshStandardMaterial color="#313a3b" roughness={0.82} metalness={0.1} />
          </Box>
          <Cylinder args={[0.1, 0.13, 0.15, 8]} rotation={[Math.PI / 2, 0, 0]} position={[0.63, 0.96, 0]}>
            <meshStandardMaterial color="#e6c873" emissive="#6e4b17" emissiveIntensity={0.18} />
          </Cylinder>
          <Cylinder args={[0.055, 0.07, 0.75, 7]} rotation={[0, 0, -0.12]} position={[-0.18, 0.34, -0.27]}>
            <meshStandardMaterial color="#484e4e" roughness={0.82} metalness={0.16} />
          </Cylinder>
        </>
      ) : (
        <>
          <Box args={[1.12, 0.16, 0.28]} position={[-0.05, 0.55, 0]} rotation={[0, 0, -0.16]}>
            <meshStandardMaterial color="#454b48" roughness={0.82} metalness={0.08} />
          </Box>
          <Box args={[0.44, 0.32, 0.32]} position={[0.16, 0.7, 0]}>
            <meshStandardMaterial color={color} roughness={0.7} />
          </Box>
          <Box args={[0.62, 0.12, 0.34]} position={[-0.36, 0.83, 0]}>
            <meshStandardMaterial color="#272f30" roughness={0.8} />
          </Box>
          <Box args={[0.5, 0.06, 0.08]} position={[0.51, 1.12, 0]}>
            <meshStandardMaterial color="#303738" roughness={0.8} metalness={0.12} />
          </Box>
          <Cylinder args={[0.09, 0.12, 0.7, 7]} rotation={[0, 0, -0.14]} position={[0.36, 0.46, -0.26]}>
            <meshStandardMaterial color="#555c59" roughness={0.82} metalness={0.15} />
          </Cylinder>
          <Cylinder args={[0.08, 0.1, 0.7, 7]} rotation={[0, 0, -0.14]} position={[0.36, 0.46, 0.26]}>
            <meshStandardMaterial color="#555c59" roughness={0.82} metalness={0.15} />
          </Cylinder>
        </>
      )}

      {[-0.62, 0.62].map((x, index) => (
        <group key={x}>
          <Cylinder
            ref={(node) => {
              wheelRefs.current[index] = node
            }}
            args={[0.22, 0.22, 0.12, 10]}
            rotation={[Math.PI / 2, 0, 0]}
            position={[x, 0.22, 0]}
            castShadow
          >
            <meshStandardMaterial color="#22292b" roughness={0.92} />
          </Cylinder>
          <Cylinder args={[0.095, 0.095, 0.13, 10]} rotation={[Math.PI / 2, 0, 0]} position={[x, 0.22, 0]}>
            <meshStandardMaterial color="#b6b8ad" roughness={0.62} metalness={0.24} />
          </Cylinder>
        </group>
      ))}
      <Box args={[0.16, 0.08, 0.04]} position={[-0.74, 0.51, 0]}>
        <meshStandardMaterial color="#eee6cf" roughness={0.72} />
      </Box>
      <Rider color={riderColor} />
    </group>
  )
}

function LargeVehicleModel({ config, color, wheelRefs, heading: headingOverride }: { config: VehicleVisualConfig; color: string; wheelRefs: WheelRefs; heading?: number }) {
  const heading = headingOverride ?? (config.direction === 1 ? 0 : Math.PI)
  const isBus = config.kind === 'bus'
  const wheelPositions = isBus ? [-1.65, 1.65] : [-1.35, 1.35]

  return (
    <group rotation={[0, heading, 0]}>
      {isBus ? (
        <>
          <Box args={[config.length, 1.18, config.width]} position={[0, 0.82, 0]} castShadow>
            <meshStandardMaterial color={color} roughness={0.7} />
          </Box>
          <Box args={[0.76, 0.7, config.width * 0.84]} position={[config.length * 0.36, 1.2, 0]} castShadow>
            <meshStandardMaterial color="#7f9da0" roughness={0.3} metalness={0.05} />
          </Box>
          {[-1.75, -0.6, 0.6, 1.75].map((x) => (
            <group key={x}>
              <Box args={[0.7, 0.48, 0.045]} position={[x, 1.25, config.width * 0.51]}>
                <meshStandardMaterial color="#30494e" roughness={0.34} />
              </Box>
              <Box args={[0.7, 0.48, 0.045]} position={[x, 1.25, -config.width * 0.51]}>
                <meshStandardMaterial color="#30494e" roughness={0.34} />
              </Box>
            </group>
          ))}
          <Box args={[0.16, 0.18, config.width + 0.04]} position={[config.length * 0.47, 0.74, 0]}>
            <meshStandardMaterial color="#f1d26e" emissive="#573f13" emissiveIntensity={0.28} />
          </Box>
          <Box args={[0.14, 0.16, config.width + 0.04]} position={[-config.length * 0.47, 0.72, 0]}>
            <meshStandardMaterial color="#a84e47" emissive="#3c1212" emissiveIntensity={0.16} />
          </Box>
        </>
      ) : (
        <>
          <Box args={[config.length * 0.42, 1.05, config.width]} position={[config.length * 0.24, 0.72, 0]} castShadow>
            <meshStandardMaterial color={color} roughness={0.7} />
          </Box>
          <Box args={[config.length * 0.58, 1.3, config.width * 0.92]} position={[-config.length * 0.16, 0.86, 0]} castShadow>
            <meshStandardMaterial color="#8a6847" roughness={0.86} />
          </Box>
          <Box args={[config.length * 0.34, 0.52, config.width * 0.88]} position={[config.length * 0.25, 1.18, 0]}>
            <meshStandardMaterial color="#5f8387" roughness={0.38} metalness={0.04} />
          </Box>
          <Box args={[0.16, 0.18, config.width + 0.04]} position={[config.length * 0.47, 0.7, 0]}>
            <meshStandardMaterial color="#f1d26e" emissive="#573f13" emissiveIntensity={0.26} />
          </Box>
        </>
      )}
      {wheelPositions.map((x, index) => (
        <group key={x}>
          {[-1, 1].map((side) => (
            <Cylinder
              key={side}
              ref={(node) => { wheelRefs.current[index * 2 + (side === 1 ? 1 : 0)] = node }}
              args={[0.34, 0.34, 0.18, 10]}
              rotation={[Math.PI / 2, 0, 0]}
              position={[x, 0.3, side * config.width * 0.54]}
            >
              <meshStandardMaterial color="#22292b" roughness={0.92} />
            </Cylinder>
          ))}
        </group>
      ))}
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

  const isMotorcycle = config.kind === 'motorcycle'
  const isLarge = isLargeVehicle(config.kind)
  const colorPalette = isMotorcycle ? MOTORCYCLE_COLORS : isLarge ? LARGE_VEHICLE_COLORS : CAR_COLORS
  const color = colorPalette[config.id % colorPalette.length]
  const initialX = config.spawnDelay === 0 ? config.startX : config.direction === 1 ? -20.5 : 20.5
  const y = isMotorcycle ? 0.42 : isLarge ? 0.9 : 0.65

  const setNextTranslation = (x: number, z: number) => {
    nextTranslation.current.x = x
    nextTranslation.current.y = y
    nextTranslation.current.z = z
    body.current?.setNextKinematicTranslation(nextTranslation.current)
  }

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
