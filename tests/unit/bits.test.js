import { describe, it, expect } from 'vitest';
import { BitReader, BitWriter, escapeRbsp, unescapeNal } from '../../electron/recording/bits.cjs';

describe('ビットの読み書き（ADR-0006 の基盤）', () => {
  it('ue / se を往復できる', () => {
    const w = new BitWriter();
    const values = [0, 1, 2, 7, 8, 255, 1000];
    for (const v of values) w.ue(v);
    for (const v of [-3, 0, 4]) w.se(v);
    w.trailing();
    const r = new BitReader(w.toBytes());
    for (const v of values) expect(r.ue()).toBe(v);
    for (const v of [-3, 0, 4]) expect(r.se()).toBe(v);
  });

  it('エミュレーション防止の挿入と除去を往復できる', () => {
    const rbsp = Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 9, 0, 0]);
    const nal = escapeRbsp(rbsp);
    // 00 00 0x（x <= 3）の並びには 03 が入る
    expect(Array.from(nal)).not.toEqual(Array.from(rbsp));
    expect(Array.from(unescapeNal(nal))).toEqual(Array.from(rbsp));
  });
});
