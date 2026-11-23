'use strict';

// 空き容量の判定（ADR-0010、要件 F-033）。判定関数は純粋関数にして単体テストできるようにする。

const fs = require('node:fs');
const C = require('./config.cjs');

async function freeBytes(dir) {
  const s = await fs.promises.statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
}

// 録画の開始: 空き容量が下限以上なら開始できる
function canStart(free) {
  return free >= C.START_MIN_FREE_BYTES;
}

// 録画中: 空き容量が「中間データ + 0.5GB」以上なら続けられる
function canContinue(free, intermediateBytes) {
  return free >= intermediateBytes + C.RUN_EXTRA_FREE_BYTES;
}

// 通常停止後: 空き容量が「中間データ + 0.2GB」以上なら mp4 を作る
function canMux(free, intermediateBytes) {
  return free >= intermediateBytes + C.MUX_EXTRA_FREE_BYTES;
}

module.exports = { freeBytes, canStart, canContinue, canMux };
