import type { GameStatus } from '../store/gameStore'

type StartOverlayProps = {
  levelName: string
  pointerLockAvailable: boolean
  onStart: () => void
}

export function StartOverlay({ levelName, pointerLockAvailable, onStart }: StartOverlayProps) {
  return (
    <section className="overlay overlay-start" aria-label="Bắt đầu trò chơi">
      <div className="overlay-copy">
        <p className="eyebrow">{levelName}</p>
        <h1>Qua đường</h1>
        <button onClick={onStart}>Bấm để chơi</button>
        <div className="controls" aria-label="Điều khiển">
          <span>WASD / Mũi tên — Di chuyển</span>
          <span>Chuột — Nhìn xung quanh</span>
          <span>Shift — Chạy&nbsp;&nbsp; · &nbsp;&nbsp;ESC — Thả chuột</span>
        </div>
        <p className="objective">Mục tiêu: qua đường mà không bị tông.</p>
        {!pointerLockAvailable && <p className="pointer-lock-hint">Bấm vào game để điều khiển chuột</p>}
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
    <section
      className={`overlay overlay-result${won ? '' : ' overlay-accident'}`}
      aria-label={won ? 'Bạn đã thắng' : 'Bạn đã thua'}
    >
      <div className="overlay-copy">
        <h1>{won ? 'Qua được rồi.' : 'Bị tông.'}</h1>
        <button onClick={canContinue ? onContinue : onRestart}>{canContinue ? 'Tiếp tục' : 'Chơi lại'}</button>
      </div>
    </section>
  )
}
