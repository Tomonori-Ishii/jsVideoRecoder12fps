// マイクの選択（F-007）。録画中と一時停止中は変更できない。

export default function MicSelect({ mics, value, disabled, onChange }) {
  return (
    <select
      className="mic-select"
      aria-label="マイク"
      value={value}
      disabled={disabled || mics.length === 0}
      onChange={(e) => onChange(e.target.value)}
    >
      {mics.length === 0 && <option value="">マイクを選択</option>}
      {mics.map((m) => (
        <option key={m.deviceId} value={m.deviceId}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
