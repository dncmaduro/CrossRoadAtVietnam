import type { GameStatus } from '../store/gameStore'

type StartOverlayProps = {
  levelName: string
  onStart: () => void
}

export function StartOverlay({ levelName, onStart }: StartOverlayProps) {
  return (
    <section className="overlay overlay-start" aria-label="Bắt đầu trò chơi">
      <div className="overlay-copy">
        <p className="eyebrow">{levelName}</p>
        <h1>Qua đường</h1>
        <button onClick={onStart}>Bấm để chơi</button>
        <p className="controls">WASD di chuyển&nbsp;&nbsp; · &nbsp;&nbsp;Shift chạy&nbsp;&nbsp; · &nbsp;&nbsp;Chuột nhìn</p>
      </div>
    </section>
  )
}

type ResultOverlayProps = {
  status: Exclude<GameStatus, 'ready' | 'playing'>
  onRestart: () => void
  onContinue?: () => void
  isFinalLevel: boolean
}

export function ResultOverlay({ status, onRestart, onContinue, isFinalLevel }: ResultOverlayProps) {
  const won = status === 'won'
  const canContinue = won && !isFinalLevel && onContinue

  return (
    <section className="overlay overlay-result" aria-label={won ? 'Bạn đã thắng' : 'Bạn đã thua'}>
      <div className="overlay-copy">
        <h1>{won ? 'Qua được rồi.' : 'Bị tông.'}</h1>
        <button onClick={canContinue ? onContinue : onRestart}>{canContinue ? 'Tiếp tục' : 'Chơi lại'}</button>
      </div>
    </section>
  )
}
