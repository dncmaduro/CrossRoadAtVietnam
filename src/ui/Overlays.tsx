import { useState } from 'react'
import type { GameStatus } from '../store/gameStore'

type StartView = 'main' | 'help'

type StartOverlayProps = {
  levelName: string
  pointerLockAvailable: boolean
  onStart: () => void
}

export function StartOverlay({ levelName, pointerLockAvailable, onStart }: StartOverlayProps) {
  const [view, setView] = useState<StartView>('main')

  return (
    <section className={`overlay overlay-start${view === 'help' ? ' overlay-help' : ''}`} aria-label={view === 'help' ? 'Hướng dẫn chơi' : 'Bắt đầu trò chơi'}>
      {view === 'main' ? (
        <div className="overlay-copy">
          <p className="eyebrow">{levelName}</p>
          <h1>Qua đường</h1>
          <div className="start-actions">
            <button onClick={onStart}>Chơi</button>
            <button className="button-secondary" onClick={() => setView('help')}>Hướng dẫn</button>
          </div>
          {!pointerLockAvailable && <p className="pointer-lock-hint">Bấm vào game để điều khiển chuột</p>}
        </div>
      ) : (
        <div className="overlay-copy help-copy">
          <h1>Hướng dẫn</h1>
          <div className="help-content">
            <div className="instruction-group instruction-movement">
              <span className="instruction-label">Di chuyển</span>
              <div className="movement-options">
                <div className="key-option" aria-label="W A S D">
                  <div className="key-layout" aria-hidden="true">
                    <kbd>W</kbd>
                    <kbd>A</kbd>
                    <kbd>S</kbd>
                    <kbd>D</kbd>
                  </div>
                </div>
                <span className="instruction-or">hoặc</span>
                <div className="key-option" aria-label="Phím mũi tên">
                  <div className="key-layout" aria-hidden="true">
                    <kbd>↑</kbd>
                    <kbd>←</kbd>
                    <kbd>↓</kbd>
                    <kbd>→</kbd>
                  </div>
                </div>
              </div>
            </div>

            <div className="instruction-group instruction-look">
              <span className="instruction-label">Nhìn xung quanh</span>
              <MouseLookVisual />
            </div>

            <div className="instruction-shortcuts">
              <div className="instruction-group">
                <span className="instruction-label">Chạy</span>
                <kbd className="key-wide">Shift</kbd>
              </div>
              <div className="instruction-group">
                <span className="instruction-label">Thả chuột</span>
                <kbd>Esc</kbd>
              </div>
            </div>

            <div className="instruction-group instruction-objective">
              <span className="instruction-label">Mục tiêu</span>
              <p>Qua đường an toàn, tránh các phương tiện.</p>
            </div>
          </div>
          <button className="button-secondary" onClick={() => setView('main')}>Quay lại</button>
        </div>
      )}
    </section>
  )
}

function MouseLookVisual() {
  return (
    <div className="mouse-look" role="img" aria-label="Di chuyển chuột để nhìn xung quanh">
      <svg className="mouse-visual" viewBox="0 0 150 88" aria-hidden="true">
        <path className="mouse-arrow" d="M24 44H7m0 0 7-6M7 44l7 6M126 44h17m0 0-7-6M143 44l-7 6" />
        <path className="mouse-body" d="M57 8h36c13 0 23 10 23 23v26c0 13-10 23-23 23H57c-13 0-23-10-23-23V31C34 18 44 8 57 8Z" />
        <path className="mouse-divider" d="M75 9v24" />
        <rect className="mouse-wheel" x="71.5" y="18" width="7" height="13" rx="3.5" />
      </svg>
    </div>
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
