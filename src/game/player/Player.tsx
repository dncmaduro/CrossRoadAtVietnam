import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { gameAudio } from '../audio/AudioManager'
import { useGameStore } from '../../store/gameStore'
import type { LevelConfig } from '../levels/level.config'
import type { PlayerTrafficState } from '../traffic/traffic.types'

const WALK_SPEED = 3.1
const RUN_SPEED = 5.6
const ACCELERATION = 14
const DECELERATION = 20
const PLAYER_RADIUS = 0.35
const BASE_FOV = 72

type PlayerProps = {
  trafficState: PlayerTrafficState
  level: LevelConfig
}

export function Player({ trafficState, level }: PlayerProps) {
  const body = useRef<RapierRigidBody>(null)
  const keys = useRef(new Set<string>())
  const { camera } = useThree()
  const status = useGameStore((state) => state.status)
  const lose = useGameStore((state) => state.lose)
  const win = useGameStore((state) => state.win)
  const forward = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const movement = useRef(new THREE.Vector3())
  const velocity = useRef(new THREE.Vector3())
  const nextPosition = useRef(new THREE.Vector3())
  const impactTime = useRef(0)
  const impactOffset = useRef(new THREE.Vector3())
  const bobTime = useRef(0)

  useEffect(() => {
    camera.rotation.set(0, Math.PI, 0)

    const onKeyDown = (event: KeyboardEvent) => keys.current.add(event.code)
    const onKeyUp = (event: KeyboardEvent) => keys.current.delete(event.code)
    const clearInput = () => {
      keys.current.clear()
      velocity.current.set(0, 0, 0)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearInput)
    document.addEventListener('visibilitychange', clearInput)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearInput)
      document.removeEventListener('visibilitychange', clearInput)
    }
  }, [camera])

  useEffect(() => {
    keys.current.clear()
    velocity.current.set(0, 0, 0)

    if (status === 'lost') {
      impactTime.current = 0.28
      document.exitPointerLock?.()
    } else if (status === 'won') {
      document.exitPointerLock?.()
    }
  }, [status])

  useFrame((_, delta) => {
    if (!body.current) return

    const frameDelta = Math.min(delta, 0.05)
    const current = body.current.translation()
    camera.position.set(current.x, current.y + 0.66, current.z)
    const perspectiveCamera = camera as THREE.PerspectiveCamera
    const running = keys.current.has('ShiftLeft') || keys.current.has('ShiftRight')
    const targetFov = status === 'playing' && running ? BASE_FOV + 1.6 : BASE_FOV
    const nextFov = THREE.MathUtils.lerp(perspectiveCamera.fov, targetFov, 1 - Math.exp(-8 * frameDelta))
    if (Math.abs(perspectiveCamera.fov - nextFov) > 0.005) {
      perspectiveCamera.fov = nextFov
      perspectiveCamera.updateProjectionMatrix()
    }

    if (impactTime.current > 0) {
      const progress = impactTime.current / 0.28
      impactTime.current = Math.max(0, impactTime.current - frameDelta)
      impactOffset.current.set(
        Math.sin((0.28 - impactTime.current) * 58) * 0.06 * progress,
        Math.abs(Math.sin((0.28 - impactTime.current) * 42)) * 0.035 * progress,
        0,
      )
      camera.position.add(impactOffset.current)
    }

    const audioImpulse = gameAudio.consumeCameraImpulse(frameDelta)
    if (audioImpulse > 0) {
      camera.position.x += Math.sin((0.28 - impactTime.current) * 54) * audioImpulse
      camera.position.y += Math.abs(Math.cos((0.28 - impactTime.current) * 44)) * audioImpulse * 0.45
    }

    if (status !== 'playing') {
      velocity.current.set(0, 0, 0)
      trafficState.active = false
      trafficState.x = current.x
      trafficState.z = current.z
      trafficState.vx = 0
      trafficState.vz = 0
      return
    }

    const input = movement.current.set(0, 0, 0)
    if (keys.current.has('KeyW')) input.z += 1
    if (keys.current.has('KeyS')) input.z -= 1
    if (keys.current.has('KeyA')) input.x -= 1
    if (keys.current.has('KeyD')) input.x += 1
    const hasInput = input.lengthSq() > 0
    if (hasInput) {
      input.normalize()
      forward.current.set(0, 0, -1).applyQuaternion(camera.quaternion)
      forward.current.y = 0
      forward.current.normalize()
      right.current.set(1, 0, 0).applyQuaternion(camera.quaternion)
      right.current.y = 0
      right.current.normalize()

      const direction = forward.current.multiplyScalar(input.z).add(right.current.multiplyScalar(input.x))
      const speed = running ? RUN_SPEED : WALK_SPEED
      movement.current.set(direction.x * speed, 0, direction.z * speed)
    } else {
      movement.current.set(0, 0, 0)
    }

    const blend = 1 - Math.exp(-(hasInput ? ACCELERATION : DECELERATION) * frameDelta)
    velocity.current.lerp(movement.current, blend)
    const actualSpeed = velocity.current.length()
    gameAudio.updateFootsteps(hasInput, running, actualSpeed, frameDelta)
    if (hasInput && actualSpeed > 0.35) {
      bobTime.current += frameDelta * (running ? 13 : 10)
      const bobAmount = (running ? 0.017 : 0.009) * THREE.MathUtils.clamp(actualSpeed / RUN_SPEED, 0, 1)
      camera.position.x += Math.sin(bobTime.current * 0.5) * bobAmount * 0.36
      camera.position.y += Math.abs(Math.cos(bobTime.current)) * bobAmount
    } else {
      bobTime.current = THREE.MathUtils.damp(bobTime.current, 0, 7, frameDelta)
    }
    trafficState.active = true
    trafficState.x = current.x
    trafficState.z = current.z
    trafficState.vx = velocity.current.x
    trafficState.vz = velocity.current.z
    nextPosition.current.set(
      THREE.MathUtils.clamp(current.x + velocity.current.x * frameDelta, level.playerBounds.xMin, level.playerBounds.xMax),
      current.y,
      THREE.MathUtils.clamp(current.z + velocity.current.z * frameDelta, level.playerBounds.zMin, level.playerBounds.zMax),
    )
    nextPosition.current.x = THREE.MathUtils.clamp(nextPosition.current.x, level.playerBounds.xMin, level.playerBounds.xMax)
    body.current.setNextKinematicTranslation(nextPosition.current)

    if (nextPosition.current.z >= level.finishZone.minZ && nextPosition.current.z <= level.finishZone.maxZ) win()
  })

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      position={level.playerSpawn}
      colliders={false}
      enabledRotations={[false, false, false]}
      onCollisionEnter={({ other }) => {
        if (other.rigidBodyObject?.userData?.isVehicle) lose()
      }}
      userData={{ isPlayer: true }}
    >
      <CapsuleCollider args={[0.65, PLAYER_RADIUS]} />
    </RigidBody>
  )
}
