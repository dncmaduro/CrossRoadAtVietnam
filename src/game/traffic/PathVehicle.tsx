import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useGameStore } from '../../store/gameStore'
import * as THREE from 'three'
import type { IntersectionRuntime } from '../intersection/intersection.runtime'
import type { PathVehicleConfig } from '../intersection/intersection.types'
import { ACTIVE_COLLISION_TYPES_ALL, didVehicleHitPlayer, TRAFFIC_COLLISION_GROUPS } from './trafficPhysics'
import type { PlayerTrafficState, TrafficSnapshot } from './traffic.types'
import { getVehicleColor, VehicleModel } from './Vehicle'

type PathVehicleProps = {
  config: PathVehicleConfig
  getTraffic: () => Map<number, TrafficSnapshot>
  onUpdate: (id: number, x: number, z: number, speed: number, active: boolean, routeId?: string) => void
  playerState: PlayerTrafficState
  intersectionRuntime: IntersectionRuntime | null
}

type PathRuntime = {
  active: boolean
  wait: number
  progress: number
  speed: number
}

function samplePath(config: PathVehicleConfig, progress: number, position: THREE.Vector2, tangent: THREE.Vector2) {
  const path = config.path
  const t = THREE.MathUtils.clamp(progress, 0, 1)
  const inverse = 1 - t
  position.set(
    inverse ** 3 * path.start[0] + 3 * inverse ** 2 * t * path.controlA[0] + 3 * inverse * t ** 2 * path.controlB[0] + t ** 3 * path.end[0],
    inverse ** 3 * path.start[1] + 3 * inverse ** 2 * t * path.controlA[1] + 3 * inverse * t ** 2 * path.controlB[1] + t ** 3 * path.end[1],
  )
  tangent.set(
    3 * inverse ** 2 * (path.controlA[0] - path.start[0]) + 6 * inverse * t * (path.controlB[0] - path.controlA[0]) + 3 * t ** 2 * (path.end[0] - path.controlB[0]),
    3 * inverse ** 2 * (path.controlA[1] - path.start[1]) + 6 * inverse * t * (path.controlB[1] - path.controlA[1]) + 3 * t ** 2 * (path.end[1] - path.controlB[1]),
  ).normalize()
}

export function PathVehicle({ config, getTraffic, onUpdate, playerState, intersectionRuntime }: PathVehicleProps) {
  const body = useRef<RapierRigidBody>(null)
  const visuals = useRef<THREE.Group>(null)
  const wheelRefs = useRef<Array<THREE.Mesh | null>>([])
  const nextTranslation = useRef({ x: 0, y: 0, z: 0 })
  const nextRotation = useRef({ x: 0, y: 0, z: 0, w: 1 })
  const position = useRef(new THREE.Vector2())
  const tangent = useRef(new THREE.Vector2(1, 0))
  const runtime = useRef<PathRuntime>({ active: false, wait: config.spawnDelay, progress: 0, speed: 0 })
  const status = useGameStore((state) => state.status)
  const lose = useGameStore((state) => state.lose)
  const collisionTriggered = useRef(false)
  const y = config.kind === 'motorcycle' ? 0.42 : config.kind === 'bus' || config.kind === 'truck' ? 0.9 : 0.65
  const color = getVehicleColor(config.visualConfig)

  const setNextTransform = (x: number, z: number, heading = 0) => {
    nextTranslation.current.x = x
    nextTranslation.current.y = y
    nextTranslation.current.z = z
    body.current?.setNextKinematicTranslation(nextTranslation.current)
    nextRotation.current.y = Math.sin(heading / 2)
    nextRotation.current.w = Math.cos(heading / 2)
    body.current?.setNextKinematicRotation(nextRotation.current)
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
      state.speed = 0
      state.active = false
      if (visuals.current) visuals.current.visible = false
      onUpdate(config.id, config.path.start[0], config.path.start[1], 0, false, config.path.id)
      return
    }

    if (state.wait > 0) {
      state.wait = Math.max(0, state.wait - frameDelta)
      if (state.wait === 0) {
        state.active = true
        state.progress = 0
        state.speed = config.speed
        setNextTransform(config.path.start[0], config.path.start[1])
      }
      if (visuals.current) visuals.current.visible = false
      onUpdate(config.id, config.path.start[0], config.path.start[1], 0, false, config.path.id)
      return
    }

    state.active = true
    if (visuals.current) visuals.current.visible = true
    samplePath(config, state.progress, position.current, tangent.current)

    const predictedX = playerState.x + playerState.vx * 0.3
    const predictedZ = playerState.z + playerState.vz * 0.3
    const playerDistance = Math.hypot(predictedX - position.current.x, predictedZ - position.current.y)
    const playerRisk = playerState.active && playerDistance < 4.8 + config.width / 2 ? 1 - playerDistance / (4.8 + config.width / 2) : 0
    const light = intersectionRuntime?.getLight(config.path.signalGroup) ?? 'green'
    const stopProgress = config.path.turnType === 'straight' ? 0.34 : 0.3
    const shouldStopForSignal = state.progress < stopProgress && (light === 'red' || (light === 'yellow' && state.progress < 0.22))
    const approachingConflict = state.progress > 0.28 && state.progress < 0.72
    const hasReservation = !approachingConflict || !intersectionRuntime || intersectionRuntime.canEnter(config.id, 1.7)
    const targetSpeed = shouldStopForSignal || !hasReservation
      ? 0
      : config.speed * (1 - THREE.MathUtils.clamp(playerRisk, 0, 0.82) * 0.5)
    const acceleration = config.kind === 'motorcycle' ? 4.8 : config.kind === 'bus' || config.kind === 'truck' ? 1.65 : 3
    const braking = config.kind === 'motorcycle' ? 8 : config.kind === 'bus' || config.kind === 'truck' ? 5.2 : 7.2
    state.speed = THREE.MathUtils.damp(state.speed, targetSpeed, targetSpeed < state.speed ? braking : acceleration, frameDelta)
    state.progress = Math.min(1, state.progress + (state.speed * frameDelta) / config.path.length)
    samplePath(config, state.progress, position.current, tangent.current)

    if (state.progress >= 1) {
      intersectionRuntime?.release(config.id)
      state.active = false
      state.wait = 1.6 + (config.id % 3) * 0.4
      state.progress = 0
      state.speed = 0
      if (visuals.current) visuals.current.visible = false
      setNextTransform(config.path.start[0], config.path.start[1])
      onUpdate(config.id, config.path.start[0], config.path.start[1], 0, false, config.path.id)
      return
    }

    const heading = Math.atan2(-tangent.current.y, tangent.current.x)
    if (!collisionTriggered.current && didVehicleHitPlayer({
      previous: { x: rigidBody.translation().x, z: rigidBody.translation().z, heading },
      next: { x: position.current.x, z: position.current.y, heading },
      length: config.length,
      width: config.width,
      playerState,
      frameDelta,
    })) {
      collisionTriggered.current = true
      lose()
      return
    }

    setNextTransform(position.current.x, position.current.y, heading)
    if (visuals.current) visuals.current.rotation.y = heading
    onUpdate(config.id, position.current.x, position.current.y, state.speed, true, config.path.id)
    wheelRefs.current.forEach((wheel) => {
      if (wheel) wheel.rotation.z += state.speed * frameDelta * 1.2
    })
  })

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      position={[config.path.start[0], y, config.path.start[1]]}
      colliders={false}
      collisionGroups={TRAFFIC_COLLISION_GROUPS}
      activeCollisionTypes={ACTIVE_COLLISION_TYPES_ALL}
      userData={{ isVehicle: true, vehicleId: config.id }}
      enabledRotations={[false, false, false]}
    >
      <CuboidCollider args={[config.length / 2, config.kind === 'motorcycle' ? 0.24 : config.kind === 'bus' || config.kind === 'truck' ? 0.72 : 0.5, config.width / 2]} />
      <group ref={visuals} visible={runtime.current.active}>
        <VehicleModel config={config.visualConfig} color={color} wheelRefs={wheelRefs} />
      </group>
    </RigidBody>
  )
}
