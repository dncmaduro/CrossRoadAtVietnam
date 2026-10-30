import type { PlayerTrafficState, TrafficSnapshot } from '../traffic/traffic.types'
import type { VehicleKind } from '../traffic/traffic.config'
import { AUDIO_TUNING } from './audio.config'

type EngineVoice = {
  vehicleId: number | null
  kind: VehicleKind
  tone: OscillatorNode
  harmonic: OscillatorNode
  harmonicGain: GainNode
  gain: GainNode
  panner: PannerNode
}

type EventState = {
  initialized: boolean
  previousX: number
  previousZ: number
  previousDistance: number
  danger: boolean
  nearMissArmed: boolean
  nextHornAt: number
  nextNearMissAt: number
}

type AudioStatus = 'ready' | 'playing' | 'lost' | 'won'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function smoothParam(param: AudioParam, value: number, now: number, timeConstant = 0.08) {
  param.setTargetAtTime(value, now, timeConstant)
}

export class AudioManager {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private ambientGain: GainNode | null = null
  private engineGain: GainNode | null = null
  private effectsGain: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private voices: EngineVoice[] = []
  private eventStates = new Map<number, EventState>()
  private candidateIds: number[] = []
  private selectedIds: number[] = []
  private voiceSelectionTimer = 0
  private globalHornAt = 0
  private hornSequence = 0
  private footstepTimer = 0
  private cameraImpulse = 0
  private failed = false
  private status: AudioStatus = 'ready'

  activate() {
    if (this.failed) return

    try {
      if (!this.context) {
        const browserWindow = window as Window & { webkitAudioContext?: typeof AudioContext }
        const AudioContextConstructor = window.AudioContext ?? browserWindow.webkitAudioContext
        if (!AudioContextConstructor) {
          this.failed = true
          return
        }

        this.context = new AudioContextConstructor()
        this.createGraph()
      }

      if (this.context.state === 'suspended') {
        void this.context.resume().catch(() => {
          this.failed = true
        })
      }
    } catch {
      this.failed = true
    }
  }

  setStatus(status: AudioStatus) {
    if (this.status === status) return

    if (status === 'playing') {
      this.beginRound()
    } else if (status === 'ready') {
      this.status = status
      this.setEngineLevel(0)
      this.setAmbientLevel(0)
      this.resetRound()
    } else if (status === 'lost') {
      this.status = status
      this.playImpact()
      this.cameraImpulse = Math.max(this.cameraImpulse, 0.1)
      this.setEngineLevel(0)
    } else if (status === 'won') {
      this.status = status
      this.setEngineLevel(0)
      this.setAmbientLevel(AUDIO_TUNING.ambientVolume * 0.55)
    }
  }

  beginRound() {
    this.status = 'playing'
    this.resetRound()
    this.setEngineLevel(AUDIO_TUNING.engineVolume)
    this.setAmbientLevel(AUDIO_TUNING.ambientVolume)
  }

  update(
    listenerPosition: { x: number; y: number; z: number },
    listenerForward: { x: number; y: number; z: number },
    traffic: Map<number, TrafficSnapshot>,
    playerState: PlayerTrafficState,
    delta: number,
  ) {
    const context = this.context
    if (!context || this.failed) return

    const now = context.currentTime
    this.updateListener(listenerPosition, listenerForward, now)
    this.updateEvents(traffic, playerState, now)

    this.voiceSelectionTimer -= delta
    if (this.voiceSelectionTimer <= 0) {
      this.voiceSelectionTimer = AUDIO_TUNING.voiceSelectionInterval
      this.selectEngineVoices(traffic, playerState)
    }
    this.updateEngineVoices(traffic, playerState, now)
  }

  updateFootsteps(moving: boolean, running: boolean, speed: number, delta: number) {
    if (!this.context || this.failed || this.status !== 'playing') return

    if (!moving || speed < 0.35) {
      this.footstepTimer = 0
      return
    }

    this.footstepTimer -= delta
    if (this.footstepTimer <= 0) {
      this.footstepTimer = running ? AUDIO_TUNING.footstepRunCadence : AUDIO_TUNING.footstepWalkCadence
      this.playFootstep(running)
    }
  }

  consumeCameraImpulse(delta: number) {
    const impulse = this.cameraImpulse
    this.cameraImpulse = Math.max(0, this.cameraImpulse - AUDIO_TUNING.cameraImpulseDecay * delta)
    return impulse
  }

  private createGraph() {
    const context = this.context
    if (!context) return

    this.masterGain = context.createGain()
    this.masterGain.gain.value = AUDIO_TUNING.masterVolume
    this.masterGain.connect(context.destination)

    this.ambientGain = context.createGain()
    this.ambientGain.gain.value = 0
    this.ambientGain.connect(this.masterGain)

    this.engineGain = context.createGain()
    this.engineGain.gain.value = 0
    this.engineGain.connect(this.masterGain)

    this.effectsGain = context.createGain()
    this.effectsGain.gain.value = AUDIO_TUNING.effectsVolume
    this.effectsGain.connect(this.masterGain)

    this.noiseBuffer = this.createNoiseBuffer(2)
    this.createAmbientLayers()
    for (let index = 0; index < AUDIO_TUNING.maxEngineVoices; index += 1) {
      this.voices.push(this.createEngineVoice())
    }
  }

  private createNoiseBuffer(duration: number) {
    const context = this.context
    if (!context) return null

    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * 0.45
    }
    return buffer
  }

  private createAmbientLayers() {
    const context = this.context
    if (!context || !this.noiseBuffer || !this.ambientGain) return

    const roadSource = context.createBufferSource()
    roadSource.buffer = this.noiseBuffer
    roadSource.loop = true
    const roadFilter = context.createBiquadFilter()
    roadFilter.type = 'lowpass'
    roadFilter.frequency.value = 720
    const roadGain = context.createGain()
    roadGain.gain.value = 0.7
    roadSource.connect(roadFilter).connect(roadGain).connect(this.ambientGain)
    roadSource.start()

    const airSource = context.createBufferSource()
    airSource.buffer = this.noiseBuffer
    airSource.loop = true
    const airFilter = context.createBiquadFilter()
    airFilter.type = 'bandpass'
    airFilter.frequency.value = 2100
    airFilter.Q.value = 0.45
    const airGain = context.createGain()
    airGain.gain.value = 0.08
    airSource.connect(airFilter).connect(airGain).connect(this.ambientGain)
    airSource.start()
  }

  private createEngineVoice(): EngineVoice {
    const context = this.context
    const engineGain = this.engineGain
    if (!context || !engineGain) throw new Error('Audio graph is not ready')

    const tone = context.createOscillator()
    tone.type = 'sawtooth'
    tone.frequency.value = 60

    const harmonic = context.createOscillator()
    harmonic.type = 'triangle'
    harmonic.frequency.value = 120

    const harmonicGain = context.createGain()
    harmonicGain.gain.value = 0.18
    const gain = context.createGain()
    gain.gain.value = 0
    const panner = context.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 2
    panner.maxDistance = AUDIO_TUNING.audibleDistance
    panner.rolloffFactor = 0.85

    tone.connect(gain)
    harmonic.connect(harmonicGain).connect(gain)
    gain.connect(panner).connect(engineGain)
    tone.start()
    harmonic.start()

    return { vehicleId: null, kind: 'car', tone, harmonic, harmonicGain, gain, panner }
  }

  private updateListener(
    position: { x: number; y: number; z: number },
    forward: { x: number; y: number; z: number },
    now: number,
  ) {
    const listener = this.context?.listener
    if (!listener) return

    smoothParam(listener.positionX, position.x, now, 0.04)
    smoothParam(listener.positionY, position.y, now, 0.04)
    smoothParam(listener.positionZ, position.z, now, 0.04)
    smoothParam(listener.forwardX, forward.x, now, 0.04)
    smoothParam(listener.forwardY, forward.y, now, 0.04)
    smoothParam(listener.forwardZ, forward.z, now, 0.04)
    smoothParam(listener.upX, 0, now, 0.04)
    smoothParam(listener.upY, 1, now, 0.04)
    smoothParam(listener.upZ, 0, now, 0.04)
  }

  private selectEngineVoices(traffic: Map<number, TrafficSnapshot>, playerState: PlayerTrafficState) {
    this.candidateIds.length = 0
    traffic.forEach((snapshot) => {
      if (!snapshot.active) return
      const distance = Math.hypot(snapshot.x - playerState.x, snapshot.z - playerState.z)
      if (distance <= AUDIO_TUNING.audibleDistance * 1.15) this.candidateIds.push(snapshot.id)
    })
    this.candidateIds.sort((left, right) => {
      const a = traffic.get(left)
      const b = traffic.get(right)
      if (!a || !b) return 0
      return Math.hypot(a.x - playerState.x, a.z - playerState.z) - Math.hypot(b.x - playerState.x, b.z - playerState.z)
    })

    this.selectedIds.length = 0
    for (let index = 0; index < this.candidateIds.length && index < AUDIO_TUNING.maxEngineVoices; index += 1) {
      this.selectedIds.push(this.candidateIds[index])
    }

    for (const voice of this.voices) {
      if (voice.vehicleId !== null && !this.selectedIds.includes(voice.vehicleId)) {
        voice.vehicleId = null
        smoothParam(voice.gain.gain, 0, this.context?.currentTime ?? 0, 0.12)
      }
    }

    for (const id of this.selectedIds) {
      if (this.voices.some((voice) => voice.vehicleId === id)) continue
      const freeVoice = this.voices.find((voice) => voice.vehicleId === null)
      if (freeVoice) freeVoice.vehicleId = id
    }
  }

  private updateEngineVoices(traffic: Map<number, TrafficSnapshot>, playerState: PlayerTrafficState, now: number) {
    for (const voice of this.voices) {
      if (voice.vehicleId === null) continue
      const snapshot = traffic.get(voice.vehicleId)
      if (!snapshot || !snapshot.active) {
        voice.vehicleId = null
        smoothParam(voice.gain.gain, 0, now, 0.12)
        continue
      }

      const distance = Math.hypot(snapshot.x - playerState.x, snapshot.z - playerState.z)
      if (distance > AUDIO_TUNING.audibleDistance * 1.25) {
        smoothParam(voice.gain.gain, 0, now, 0.16)
        continue
      }

      const normalizedSpeed = clamp(snapshot.speed / 6, 0, 1)
      const isMotorcycle = snapshot.kind === 'motorcycle'
      const isBus = snapshot.kind === 'bus'
      const isTruck = snapshot.kind === 'truck'
      const baseFrequency = isMotorcycle ? 96 : isBus ? 42 : isTruck ? 48 : 58
      const pitchRange = isMotorcycle ? 72 : isBus ? 24 : isTruck ? 30 : 42
      const baseVolume = isMotorcycle ? 0.13 : isBus ? 0.16 : isTruck ? 0.15 : 0.105
      const volume = baseVolume * (0.12 + Math.pow(clamp(1 - distance / AUDIO_TUNING.audibleDistance, 0, 1), 1.35) * 0.88)

      if (voice.kind !== snapshot.kind) {
        voice.kind = snapshot.kind
        voice.tone.type = isMotorcycle ? 'square' : isBus || isTruck ? 'sine' : 'sawtooth'
        voice.harmonic.type = isMotorcycle ? 'triangle' : isBus || isTruck ? 'triangle' : 'sine'
        voice.harmonicGain.gain.value = isMotorcycle ? 0.12 : isBus || isTruck ? 0.24 : 0.18
      }

      smoothParam(voice.tone.frequency, baseFrequency + normalizedSpeed * pitchRange, now, 0.12)
      smoothParam(voice.harmonic.frequency, (baseFrequency + normalizedSpeed * pitchRange) * (isMotorcycle ? 2.02 : 1.96), now, 0.12)
      smoothParam(voice.gain.gain, volume, now, 0.1)
      this.setPannerPosition(voice.panner, snapshot.x, snapshot.z, now)
    }
  }

  private setPannerPosition(panner: PannerNode, x: number, z: number, now: number) {
    smoothParam(panner.positionX, x, now, 0.06)
    smoothParam(panner.positionY, 0.8, now, 0.06)
    smoothParam(panner.positionZ, z, now, 0.06)
  }

  private updateEvents(traffic: Map<number, TrafficSnapshot>, playerState: PlayerTrafficState, now: number) {
    traffic.forEach((snapshot) => {
      let state = this.eventStates.get(snapshot.id)
      if (!state) {
        state = {
          initialized: false,
          previousX: snapshot.x,
          previousZ: snapshot.z,
          previousDistance: Number.POSITIVE_INFINITY,
          danger: false,
          nearMissArmed: true,
          nextHornAt: 0,
          nextNearMissAt: 0,
        }
        this.eventStates.set(snapshot.id, state)
      }

      if (!snapshot.active || !playerState.active) {
        state.initialized = false
        state.danger = false
        state.nearMissArmed = true
        state.previousDistance = Number.POSITIVE_INFINITY
        return
      }

      const distance = Math.hypot(snapshot.x - playerState.x, snapshot.z - playerState.z)
      const dangerous =
        snapshot.speed > 1.1 &&
        Math.abs(snapshot.x - playerState.x) < AUDIO_TUNING.hornDangerRange &&
        Math.abs(snapshot.z - playerState.z) < AUDIO_TUNING.hornLateralRange

      if (dangerous && !state.danger) this.maybeHorn(snapshot, distance, state, now)
      state.danger = dangerous

      if (distance > AUDIO_TUNING.nearMissResetDistance) state.nearMissArmed = true
      const moving = Math.abs(snapshot.x - state.previousX) + Math.abs(snapshot.z - state.previousZ) > 0.02
      const passedClose = state.previousDistance > AUDIO_TUNING.nearMissDistance && distance <= AUDIO_TUNING.nearMissDistance
      if (state.initialized && state.nearMissArmed && passedClose && moving && snapshot.speed > 1.5 && now >= state.nextNearMissAt) {
        state.nearMissArmed = false
        state.nextNearMissAt = now + AUDIO_TUNING.nearMissCooldown
        this.cameraImpulse = Math.max(this.cameraImpulse, 0.035)
        this.playWhoosh(snapshot, distance, now)
      }

      state.initialized = true
      state.previousX = snapshot.x
      state.previousZ = snapshot.z
      state.previousDistance = distance
    })
  }

  private maybeHorn(snapshot: TrafficSnapshot, distance: number, state: EventState, now: number) {
    if (now < state.nextHornAt || now < this.globalHornAt) return

    const baseChance = snapshot.kind === 'motorcycle' ? 0.32 : snapshot.kind === 'bus' || snapshot.kind === 'truck' ? 0.07 : 0.12
    const chance = baseChance + snapshot.aggression * (snapshot.kind === 'motorcycle' ? 0.3 : 0.2)
    const roll = ((snapshot.id * 29 + this.hornSequence * 17) % 100) / 100
    this.hornSequence += 1
    if (roll > chance) return

    state.nextHornAt = now + AUDIO_TUNING.hornCooldown
    this.globalHornAt = now + AUDIO_TUNING.globalHornCooldown
    this.playHorn(snapshot, distance, now)
  }

  private playHorn(snapshot: TrafficSnapshot, distance: number, now: number) {
    const context = this.context
    if (!context || !this.effectsGain) return

    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const panner = context.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 2
    panner.maxDistance = 16
    panner.rolloffFactor = 0.9
    const heavy = snapshot.kind === 'bus' || snapshot.kind === 'truck'
    const frequency = snapshot.kind === 'motorcycle' ? 410 : heavy ? 190 : 260
    oscillator.type = snapshot.kind === 'motorcycle' ? 'square' : heavy ? 'sine' : 'triangle'
    oscillator.frequency.setValueAtTime(frequency + (snapshot.id % 3) * 18, now)
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.82, now + 0.16)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(0.045 * (1 - clamp(distance / 8, 0, 0.7)), now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19)
    oscillator.connect(gain).connect(panner).connect(this.effectsGain)
    this.setPannerPosition(panner, snapshot.x, snapshot.z, now)
    oscillator.start(now)
    oscillator.stop(now + 0.21)
  }

  private playWhoosh(snapshot: TrafficSnapshot, distance: number, now: number) {
    const context = this.context
    if (!context || !this.noiseBuffer || !this.effectsGain) return

    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    const panner = context.createPanner()
    source.buffer = this.noiseBuffer
    filter.type = 'bandpass'
    filter.frequency.value = snapshot.kind === 'motorcycle' ? 1500 : 900
    filter.Q.value = 0.7
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 1
    panner.maxDistance = 8
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(0.06 * (1 - clamp(distance / 2, 0, 0.7)), now + 0.025)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24)
    source.connect(filter).connect(gain).connect(panner).connect(this.effectsGain)
    this.setPannerPosition(panner, snapshot.x, snapshot.z, now)
    source.start(now)
    source.stop(now + 0.26)
  }

  private playFootstep(running: boolean) {
    const context = this.context
    if (!context || !this.noiseBuffer || !this.effectsGain) return

    const now = context.currentTime
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = this.noiseBuffer
    filter.type = 'bandpass'
    filter.frequency.value = running ? 1050 : 840
    filter.Q.value = 0.75
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(running ? 0.022 : 0.015, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.095)
    source.connect(filter).connect(gain).connect(this.effectsGain)
    source.start(now)
    source.stop(now + 0.11)
  }

  private playImpact() {
    const context = this.context
    if (!context || !this.effectsGain) return

    const now = context.currentTime
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(115, now)
    oscillator.frequency.exponentialRampToValueAtTime(48, now + 0.22)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(0.11, now + 0.014)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)
    oscillator.connect(gain).connect(this.effectsGain)
    oscillator.start(now)
    oscillator.stop(now + 0.28)
  }

  private resetRound() {
    this.globalHornAt = 0
    this.hornSequence = 0
    this.footstepTimer = 0
    this.cameraImpulse = 0
    this.eventStates.forEach((state) => {
      state.initialized = false
      state.danger = false
      state.nearMissArmed = true
      state.previousDistance = Number.POSITIVE_INFINITY
    })
    for (const voice of this.voices) {
      voice.vehicleId = null
      if (this.context) smoothParam(voice.gain.gain, 0, this.context.currentTime, 0.05)
    }
  }

  private setEngineLevel(value: number) {
    if (this.engineGain && this.context) smoothParam(this.engineGain.gain, value, this.context.currentTime, 0.12)
  }

  private setAmbientLevel(value: number) {
    if (this.ambientGain && this.context) smoothParam(this.ambientGain.gain, value, this.context.currentTime, 0.25)
  }
}

export const gameAudio = new AudioManager()
