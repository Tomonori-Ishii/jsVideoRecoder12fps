'use strict';

// 保存ファイル名（F-030）: screen_YYYYMMDD_HHMMSS.mp4（録画開始時のローカル時刻）

function pad(n) {
  return String(n).padStart(2, '0');
}

function fileStamp(date) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function outputName(date) {
  return `screen_${fileStamp(date)}.mp4`;
}

// 録画 ID は開始時刻から作る（同じ秒の 2 回目は連番を付けて衝突を避ける）
function recordingId(date) {
  return `rec_${fileStamp(date)}`;
}

module.exports = { fileStamp, outputName, recordingId };
