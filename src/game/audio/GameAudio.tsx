import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../../store/gameStore'
import type { PlayerTrafficState, TrafficSnapshot } from '../traffic/traffic.types'
import { gameAudio } from './AudioManager'

type GameAudioProps = {
  getTraffic: () => Map<number, TrafficSnapshot>
  playerState: PlayerTrafficState
}

export function GameAudio({ getTraffic, playerState }: GameAudioProps) {
  const camera = useThree((state) => state.camera)
  const forward = useRef(new THREE.Vector3(0, 0, -1))
  const status = useGameStore((state) => state.status)

  useEffect(() => {
    gameAudio.setStatus(status)
  }, [status])

  useFrame((_, delta) => {
    camera.getWorldDirection(forward.current)
    gameAudio.update(
      camera.position,
      forward.current,
      getTraffic(),
      playerState,
      Math.min(delta, 0.05),
    )
  })

  return null
}
