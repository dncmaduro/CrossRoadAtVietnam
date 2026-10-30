import type { IntersectionConfig, SignalGroup } from '../levels/level.config'

export type SignalLight = 'red' | 'yellow' | 'green'

export type IntersectionRuntime = {
  time: number
  occupancyId: number | null
  occupancyUntil: number
  tick: (delta: number, active: boolean) => void
  reset: () => void
  getLight: (group: SignalGroup) => SignalLight
  canEnter: (id: number, duration: number) => boolean
  release: (id: number) => void
}

export function createIntersectionRuntime(config?: IntersectionConfig): IntersectionRuntime | null {
  if (!config) return null

  const runtime: IntersectionRuntime = {
    time: 0,
    occupancyId: null,
    occupancyUntil: 0,
    tick(delta, active) {
      if (!active) return
      runtime.time += Math.min(delta, 0.05)
      if (runtime.occupancyId !== null && runtime.time >= runtime.occupancyUntil) {
        runtime.occupancyId = null
      }
    },
    reset() {
      runtime.time = 0
      runtime.occupancyId = null
      runtime.occupancyUntil = 0
    },
    getLight(group) {
      const signal = config.signal
      if (!signal) return 'green'

      const green = signal.greenDuration
      const yellow = signal.yellowDuration
      const allRed = signal.allRedDuration
      const cycle = (green + yellow + allRed) * 2
      const startingGroup = signal.initialGroup ?? 'eastWest'
      const offset = group === startingGroup ? 0 : green + yellow + allRed
      const elapsed = (runtime.time + offset) % cycle

      if (elapsed < green) return 'green'
      if (elapsed < green + yellow) return 'yellow'
      if (elapsed < green + yellow + allRed) return 'red'
      if (elapsed < green * 2 + yellow + allRed) return 'green'
      if (elapsed < green * 2 + yellow * 2 + allRed) return 'yellow'
      return 'red'
    },
    canEnter(id, duration) {
      if (runtime.occupancyId !== null && runtime.occupancyId !== id && runtime.time < runtime.occupancyUntil) return false
      runtime.occupancyId = id
      runtime.occupancyUntil = runtime.time + duration
      return true
    },
    release(id) {
      if (runtime.occupancyId === id) runtime.occupancyId = null
    },
  }

  return runtime
}
