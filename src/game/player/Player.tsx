import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { gameAudio } from '../audio/AudioManager'
import { useGameStore } from '../../store/gameStore'
import type { LevelConfig } from '../levels/level.config'
import { ACTIVE_COLLISION_TYPES_ALL, PLAYER_COLLISION_GROUPS } from '../traffic/trafficPhysics'
import type { PlayerTrafficState } from '../traffic/traffic.types'

const WALK_SPEED = 3.1
const RUN_SPEED = 5.6
const ACCELERATION = 14
const DECELERATION = 20
const PLAYER_RADIUS = 0.35
const BASE_FOV = 72
const IMPACT_DURATION = 0.34
const MOUSE_SENSITIVITY = 0.002
const INITIAL_YAW = Math.PI
const PITCH_LIMIT = THREE.MathUtils.degToRad(85)

const movementKeyCodes = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowLeft',
  'ArrowDown',
  'ArrowRight',
])

type PlayerProps = {
  trafficState: PlayerTrafficState
  level: LevelConfig
}

export function Player({ trafficState, level }: PlayerProps) {
  const body = useRef<RapierRigidBody>(null)
  const keys = useRef(new Set<string>())
  const { camera, gl } = useThree()
  const status = useGameStore((state) => state.status)
  const statusRef = useRef(status)
  const roundId = useGameStore((state) => state.roundId)
  const win = useGameStore((state) => state.win)
  const yaw = useRef(INITIAL_YAW)
  const pitch = useRef(0)
  const forward = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const movement = useRef(new THREE.Vector3())
  const velocity = useRef(new THREE.Vector3())
  const nextPosition = useRef(new THREE.Vector3())
  const impactTime = useRef(0)
  const impactOffset = useRef(new THREE.Vector3())
  const bobTime = useRef(0)

  statusRef.current = status

  useEffect(() => {
    camera.rotation.order = 'YXZ'
    yaw.current = INITIAL_YAW
    pitch.current = 0
    camera.rotation.set(pitch.current, yaw.current, 0)
  }, [camera, roundId])

  useEffect(() => {
    camera.rotation.order = 'YXZ'

    const requestLock = () => {
      if (statusRef.current !== 'playing' || document.pointerLockElement === gl.domElement || typeof gl.domElement.requestPointerLock !== 'function') return
      const request = gl.domElement.requestPointerLock()
      if (request) request.catch(() => undefined)
    }
    const onPointerLockChange = () => {
      if (document.pointerLockElement !== gl.domElement) keys.current.clear()
    }
    const onMouseMove = (event: MouseEvent) => {
      if (statusRef.current !== 'playing' || document.pointerLockElement !== gl.domElement) return
      yaw.current -= event.movementX * MOUSE_SENSITIVITY
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - event.movementY * MOUSE_SENSITIVITY,
        -PITCH_LIMIT,
        PITCH_LIMIT,
      )
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (statusRef.current !== 'playing') return
      if (event.code.startsWith('Arrow')) event.preventDefault()
      if (movementKeyCodes.has(event.code) || event.code.startsWith('Shift')) keys.current.add(event.code)
    }
    const onKeyUp = (event: KeyboardEvent) => keys.current.delete(event.code)
    const clearInput = () => {
      keys.current.clear()
      velocity.current.set(0, 0, 0)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearInput)
    document.addEventListener('visibilitychange', clearInput)
    gl.domElement.addEventListener('click', requestLock)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('mousemove', onMouseMove)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearInput)
      document.removeEventListener('visibilitychange', clearInput)
      gl.domElement.removeEventListener('click', requestLock)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('mousemove', onMouseMove)
    }
  }, [camera, gl])

  useEffect(() => {
    keys.current.clear()
    velocity.current.set(0, 0, 0)

    if (status === 'lost') {
      impactTime.current = IMPACT_DURATION
      if (document.pointerLockElement === gl.domElement) document.exitPointerLock?.()
    } else if (status === 'won') {
      if (document.pointerLockElement === gl.domElement) document.exitPointerLock?.()
    }
  }, [gl, status])

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

    let impactRoll = camera.rotation.z
    if (impactTime.current > 0) {
      const progress = impactTime.current / IMPACT_DURATION
      const elapsed = IMPACT_DURATION - impactTime.current
      impactTime.current = Math.max(0, impactTime.current - frameDelta)
      impactOffset.current.set(
        Math.sin(elapsed * 58) * 0.12 * progress,
        -0.1 * progress + Math.abs(Math.sin(elapsed * 42)) * 0.04 * progress,
        -0.08 * progress,
      )
      camera.position.add(impactOffset.current)
      impactRoll = Math.sin(elapsed * 27) * 0.18 * progress
    } else if (Math.abs(impactRoll) > 0.001) {
      impactRoll = THREE.MathUtils.damp(impactRoll, 0, 12, frameDelta)
    }

    camera.rotation.set(pitch.current, yaw.current, impactRoll)

    const audioImpulse = gameAudio.consumeCameraImpulse(frameDelta)
    if (audioImpulse > 0) {
      camera.position.x += Math.sin((IMPACT_DURATION - impactTime.current) * 54) * audioImpulse
      camera.position.y += Math.abs(Math.cos((IMPACT_DURATION - impactTime.current) * 44)) * audioImpulse * 0.45
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
    if (keys.current.has('KeyW') || keys.current.has('ArrowUp')) input.z += 1
    if (keys.current.has('KeyS') || keys.current.has('ArrowDown')) input.z -= 1
    if (keys.current.has('KeyA') || keys.current.has('ArrowLeft')) input.x -= 1
    if (keys.current.has('KeyD') || keys.current.has('ArrowRight')) input.x += 1
    const hasInput = input.lengthSq() > 0
    if (hasInput) {
      input.normalize()
      forward.current.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current))
      right.current.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current))

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
      collisionGroups={PLAYER_COLLISION_GROUPS}
      activeCollisionTypes={ACTIVE_COLLISION_TYPES_ALL}
      enabledRotations={[false, false, false]}
      userData={{ isPlayer: true }}
    >
      <CapsuleCollider args={[0.65, PLAYER_RADIUS]} />
    </RigidBody>
  )
}
