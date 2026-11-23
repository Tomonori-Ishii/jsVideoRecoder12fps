// 音量バー（F-005、7.5）。灰色 1 色、role="meter"。

export default function Meter({ percent }) {
  const value = Math.round(percent);
  return (
    <div
      className="meter"
      role="meter"
      aria-label="音量"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <div className="meter-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}
