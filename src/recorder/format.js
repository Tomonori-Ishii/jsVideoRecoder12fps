// 表示の整形（F-004 経過時間、F-005 音量）

const DB_MIN = -60;
const DB_MAX = 0;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 経過時間を h:mm:ss.t（t は 100ms 単位・切り捨て）で返す（F-004）
export function formatElapsed(ms) {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const t = tenths % 10;
  const totalSec = Math.floor(tenths / 10);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${h}:${pad2(m)}:${pad2(s)}.${t}`;
}

// RMS（0〜1）を dB（−60.0〜0.0）に変換する（F-005）
export function dbFromRms(rms) {
  if (!(rms > 0)) return DB_MIN;
  const db = 20 * Math.log10(rms);
  return Math.min(DB_MAX, Math.max(DB_MIN, db));
}

// 音量バーの割合（0〜100）。(dB + 60) / 60 × 100 を範囲に収める（F-005）
export function meterPercent(db) {
  const p = ((db - DB_MIN) / (DB_MAX - DB_MIN)) * 100;
  return Math.min(100, Math.max(0, p));
}

export function formatDb(db) {
  return `${db.toFixed(1)} dB`;
}

export { DB_MIN, DB_MAX };
