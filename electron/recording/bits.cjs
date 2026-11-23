'use strict';

// H.264 の RBSP 用のビット読み書きと、エミュレーション防止バイトの処理。

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0; // ビット位置
  }

  u(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.bytes[this.pos >> 3];
      if (byte === undefined) throw new Error('bit reader: 範囲外の読み取り');
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }

  ue() {
    let zeros = 0;
    while (this.u(1) === 0) {
      zeros++;
      if (zeros > 31) throw new Error('bit reader: 不正な Exp-Golomb 符号');
    }
    return 2 ** zeros - 1 + this.u(zeros);
  }

  se() {
    const k = this.ue();
    return k % 2 === 1 ? (k + 1) / 2 : 0 - k / 2; // -0 を避ける
  }
}

class BitWriter {
  constructor() {
    this.bits = [];
  }

  u(n, value) {
    for (let i = n - 1; i >= 0; i--) {
      this.bits.push(Math.floor(value / 2 ** i) % 2);
    }
  }

  ue(value) {
    const x = value + 1;
    const len = Math.floor(Math.log2(x));
    this.u(len, 0);
    this.u(len + 1, x);
  }

  se(value) {
    this.ue(value > 0 ? 2 * value - 1 : -2 * value);
  }

  // rbsp_trailing_bits: 1 を書いてバイト境界まで 0 で埋める
  trailing() {
    this.bits.push(1);
    while (this.bits.length % 8 !== 0) this.bits.push(0);
  }

  toBytes() {
    const out = new Uint8Array(this.bits.length >> 3);
    for (let i = 0; i < out.length; i++) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = b * 2 + this.bits[i * 8 + j];
      out[i] = b;
    }
    return out;
  }
}

// RBSP → NAL 用のバイト列（00 00 0x を 00 00 03 0x に変換）
function escapeRbsp(rbsp) {
  const out = [];
  let zeros = 0;
  for (const b of rbsp) {
    if (zeros >= 2 && b <= 3) {
      out.push(3);
      zeros = 0;
    }
    out.push(b);
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

// NAL のバイト列 → RBSP（00 00 03 の 03 を取り除く）
function unescapeNal(nal) {
  const out = [];
  let zeros = 0;
  for (let i = 0; i < nal.length; i++) {
    const b = nal[i];
    if (zeros >= 2 && b === 3) {
      zeros = 0;
      continue;
    }
    out.push(b);
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

module.exports = { BitReader, BitWriter, escapeRbsp, unescapeNal };
