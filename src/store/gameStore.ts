import { create } from 'zustand'
import { LEVELS } from '../game/levels/level.config'

export type GameStatus = 'ready' | 'playing' | 'lost' | 'won'

type GameState = {
  status: GameStatus
  roundId: number
  levelIndex: number
  start: () => void
  restart: () => void
  advanceLevel: () => void
  setLevelForDebug: (levelIndex: number) => void
  setResultForDebug: (status: 'lost' | 'won') => void
  lose: () => void
  win: () => void
}

export const useGameStore = create<GameState>((set) => ({
  status: 'ready',
  roundId: 0,
  levelIndex: 0,
  start: () => set({ status: 'playing' }),
  restart: () => set((state) => ({
    status: 'playing',
    levelIndex: state.status === 'won' && state.levelIndex === LEVELS.length - 1 ? 0 : state.levelIndex,
    roundId: state.roundId + 1,
  })),
  advanceLevel: () => set((state) => (
    state.status === 'won' && state.levelIndex < LEVELS.length - 1
      ? { status: 'playing', levelIndex: state.levelIndex + 1, roundId: state.roundId + 1 }
      : state
  )),
  setLevelForDebug: (levelIndex) => set((state) => ({
    status: 'ready',
    levelIndex: Math.max(0, Math.min(LEVELS.length - 1, levelIndex)),
    roundId: state.roundId + 1,
  })),
  setResultForDebug: (status) => set((state) => (state.status === 'playing' ? { status } : state)),
  lose: () => set((state) => (state.status === 'playing' ? { status: 'lost' } : state)),
  win: () => set((state) => (state.status === 'playing' ? { status: 'won' } : state)),
}))
