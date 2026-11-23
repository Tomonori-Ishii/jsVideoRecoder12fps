// 操作ボタン（F-011、F-013）。アイコンは SVG で描く。

function MicIcon({ muted }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" fill="none" stroke="currentColor" strokeWidth="2" />
      {muted && <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2.5" />}
    </svg>
  );
}

export default function Controls({ state, muted, onStart, onPauseResume, onStop, onMute }) {
  const idle = state === 'idle';
  const active = state === 'recording' || state === 'paused';
  const paused = state === 'paused';
  return (
    <div className="controls">
      <button
        type="button"
        className="btn"
        aria-label="開始"
        title="開始"
        disabled={!idle}
        onClick={onStart}
      >
        <span aria-hidden="true" className="rec-dot">●</span>
      </button>
      <button
        type="button"
        className="btn"
        aria-label={paused ? '再開' : '一時停止'}
        title={paused ? '再開' : '一時停止'}
        disabled={!active}
        onClick={onPauseResume}
      >
        <span aria-hidden="true">{paused ? '▶' : '❚❚'}</span>
      </button>
      <button
        type="button"
        className="btn"
        aria-label="停止"
        title="停止"
        disabled={!active}
        onClick={onStop}
      >
        <span aria-hidden="true">■</span>
      </button>
      <button
        type="button"
        className="btn"
        aria-label={muted ? 'ミュートを解除' : 'ミュート'}
        title={muted ? 'ミュートを解除' : 'ミュート'}
        aria-pressed={muted}
        disabled={!active}
        onClick={onMute}
      >
        <MicIcon muted={muted} />
      </button>
    </div>
  );
}
