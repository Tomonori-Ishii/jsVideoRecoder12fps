'use strict';

// 中間ファイル（ADR-0004）。3 分（録画時間）ごとの seg-NNN.bin にレコードを追記する。
//
// レコード（16 バイトのヘッダーと本体。リトルエンディアン）:
//   u8  type      1=映像の符号化データ, 2=音声の符号化データ, 3=スキップ開始,
//                 4=映像のデコーダー設定（avcC）, 5=音声のデコーダー設定（JSON）
//   u8  flags     映像: bit0 = キーフレーム
//   u16 reserved
//   u64 tUs       メディアクロック（マイクロ秒）。映像は枠の時刻
//   u32 length    本体の長さ
//   本体          映像: 符号化データ / 音声: u32 の長さ（マイクロ秒）+ 符号化データ

const fs = require('node:fs');
const path = require('node:path');
const { SEGMENT_US } = require('./config.cjs');

const HEADER_BYTES = 16;
const TYPE = { VIDEO: 1, AUDIO: 2, SKIP: 3, VIDEO_CONFIG: 4, AUDIO_CONFIG: 5 };

function segmentName(index) {
  return `seg-${String(index).padStart(3, '0')}.bin`;
}

class SegmentWriter {
  constructor(dir) {
    this.dir = dir;
    this.index = -1;
    this.fd = null;
    this.bytes = 0; // 中間データの合計バイト数（書き込み済み）
  }

  rotateTo(index) {
    if (this.fd !== null) fs.closeSync(this.fd);
    this.index = index;
    this.fd = fs.openSync(path.join(this.dir, segmentName(index)), 'w');
  }

  append(type, flags, tUs, body) {
    const segIndex = Math.max(0, Math.floor(tUs / SEGMENT_US));
    if (this.fd === null) this.rotateTo(0);
    if (type !== TYPE.VIDEO_CONFIG && type !== TYPE.AUDIO_CONFIG && segIndex > this.index) {
      this.rotateTo(segIndex);
    }
    const header = Buffer.alloc(HEADER_BYTES);
    header[0] = type;
    header[1] = flags;
    header.writeBigUInt64LE(BigInt(Math.max(0, Math.round(tUs))), 4);
    header.writeUInt32LE(body.length, 12);
    fs.writeSync(this.fd, header);
    if (body.length > 0) fs.writeSync(this.fd, body);
    this.bytes += HEADER_BYTES + body.length;
  }

  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

// 中間ファイルを読み、レコードの位置だけを索引にする（本体は必要なときに読む）
function scanSegments(dir, fps) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^seg-\d{3}\.bin$/.test(f))
    .sort();
  const videoBySlot = new Map();
  const audio = [];
  const skipStarts = [];
  let videoConfig = null;
  let audioConfig = null;
  for (const name of files) {
    const fd = fs.openSync(path.join(dir, name), 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const header = Buffer.alloc(HEADER_BYTES);
      let pos = 0;
      while (pos + HEADER_BYTES <= size) {
        fs.readSync(fd, header, 0, HEADER_BYTES, pos);
        const type = header[0];
        const flags = header[1];
        const tUs = Number(header.readBigUInt64LE(4));
        const length = header.readUInt32LE(12);
        const bodyPos = pos + HEADER_BYTES;
        if (bodyPos + length > size) break; // 途中で切れたレコードは使わない
        const entry = { type, flags, tUs, file: name, bodyPos, length };
        if (type === TYPE.VIDEO) {
          const slot = Math.round((tUs * fps) / 1e6);
          videoBySlot.set(slot, entry);
        } else if (type === TYPE.AUDIO) {
          audio.push(entry);
        } else if (type === TYPE.SKIP) {
          skipStarts.push(entry);
        } else if (type === TYPE.VIDEO_CONFIG || type === TYPE.AUDIO_CONFIG) {
          const body = Buffer.alloc(length);
          fs.readSync(fd, body, 0, length, bodyPos);
          if (type === TYPE.VIDEO_CONFIG) videoConfig = new Uint8Array(body);
          else audioConfig = JSON.parse(body.toString('utf8'));
        }
        pos = bodyPos + length;
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  audio.sort((a, b) => a.tUs - b.tUs);
  return { videoBySlot, audio, skipStarts, videoConfig, audioConfig, files };
}

function readBody(dir, entry) {
  const fd = fs.openSync(path.join(dir, entry.file), 'r');
  try {
    const buf = Buffer.alloc(entry.length);
    fs.readSync(fd, buf, 0, entry.length, entry.bodyPos);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
  } finally {
    fs.closeSync(fd);
  }
}

// 音声の本体は「u32 の長さ（マイクロ秒）+ 符号化データ」
function readAudioBody(dir, entry) {
  const body = readBody(dir, entry);
  const durationUs = new DataView(body.buffer, body.byteOffset, 4).getUint32(0, true);
  return { durationUs, data: body.subarray(4) };
}

function totalBytes(dir) {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    if (/^seg-\d{3}\.bin$/.test(name)) total += fs.statSync(path.join(dir, name)).size;
  }
  return total;
}

module.exports = {
  TYPE,
  HEADER_BYTES,
  SegmentWriter,
  scanSegments,
  readBody,
  readAudioBody,
  totalBytes,
  segmentName,
};
