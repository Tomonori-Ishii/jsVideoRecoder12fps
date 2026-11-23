import { describe, it, expect } from 'vitest';
import { formatElapsed, dbFromRms, meterPercent, formatDb } from '../../src/recorder/format.js';
import { micErrorMessage, truncate, NO_MIC_MESSAGE, SCREEN_DENIED_MESSAGE } from '../../src/recorder/errors.js';
import { MediaClock } from '../../src/recorder/clock.js';
import { LevelMeter } from '../../src/recorder/level-meter.js';
import { outputName, recordingId } from '../../electron/recording/paths.cjs';
import C from '../../electron/recording/config.cjs';

describe('経過時間（F-004）', () => {
  it('h:mm:ss.t の形式で、t は 100ms 単位・切り捨て', () => {
    expect(formatElapsed(0)).toBe('0:00:00.0');
    expect(formatElapsed(62700)).toBe('0:01:02.7');
    expect(formatElapsed(99)).toBe('0:00:00.0');
    expect(formatElapsed(3600 * 1000 + 5000)).toBe('1:00:05.0');
  });
});

describe('音量（F-005）', () => {
  it('dB の範囲は −60.0〜0.0 に収まり、無音は −60.0', () => {
    expect(dbFromRms(0)).toBe(-60);
    expect(dbFromRms(1)).toBe(0);
    expect(dbFromRms(10)).toBe(0);
    expect(formatDb(dbFromRms(0.1))).toBe('-20.0 dB');
  });

  it('バーの割合は (dB + 60) / 60 × 100 を 0〜100 に収める', () => {
    expect(meterPercent(-60)).toBe(0);
    expect(meterPercent(0)).toBe(100);
    expect(meterPercent(-30)).toBe(50);
    expect(meterPercent(-90)).toBe(0);
  });

  it('直近 50ms の RMS を求める', () => {
    const m = new LevelMeter(48000, 50);
    m.push(new Float32Array(2400).fill(0.5));
    expect(m.rms()).toBeCloseTo(0.5, 5);
    m.reset();
    expect(m.rms()).toBe(0);
  });
});

describe('一時停止を除くメディアクロック（ADR-0007、F-002、F-003）', () => {
  it('一時停止中は進まず、再開すると続きから進む', () => {
    let now = 0;
    const clock = new MediaClock(() => now);
    clock.run();
    now = 1000;
    clock.pause();
    now = 5000;
    expect(clock.elapsedMs()).toBe(1000);
    clock.run();
    now = 5500;
    expect(clock.elapsedMs()).toBe(1500);
  });

  it('開始前の一時停止は無視する', () => {
    let now = 0;
    const clock = new MediaClock(() => now);
    clock.pause();
    expect(clock.running).toBe(false);
    expect(clock.elapsedMs()).toBe(0);
  });
});

describe('エラーの文言（F-009、F-031）', () => {
  it('マイクのエラー名ごとの文言に対応する', () => {
    expect(micErrorMessage({ name: 'NotAllowedError' })).toBe('マイクの使用が許可されていません。OSやアプリのマイク設定を確認してください。');
    expect(micErrorMessage({ name: 'OverconstrainedError' })).toBe('マイクが見つかりません。マイクを接続してから再度お試しください。');
    expect(micErrorMessage({ name: 'NotReadableError' })).toBe('マイクを使用できません。他のアプリがマイクを使用していないか確認してください。');
    expect(micErrorMessage({ name: 'TypeError', message: 'x' })).toBe('エラーが発生しました: x');
  });

  it('長い文言は末尾を … で省略する', () => {
    expect(truncate('あいうえお', 3)).toBe('あい…');
    expect(truncate('あい', 3)).toBe('あい');
    expect(NO_MIC_MESSAGE).toContain('マイクが見つかりません');
    expect(SCREEN_DENIED_MESSAGE).toContain('画面の録画が許可されていません');
  });
});

describe('保存名（F-030）と設定（F-032）', () => {
  it('screen_YYYYMMDD_HHMMSS.mp4 の形式（ローカル時刻）', () => {
    const d = new Date(2026, 10, 19, 14, 30, 25);
    expect(outputName(d)).toBe('screen_20261119_143025.mp4');
    expect(recordingId(d)).toBe('rec_20261119_143025');
  });

  it('フレームレートは 1〜30 の整数、範囲外と不正値は既定の 12 に戻す', () => {
    expect(C.normalizeFps(12)).toBe(12);
    expect(C.normalizeFps(30)).toBe(30);
    expect(C.normalizeFps(0)).toBe(12);
    expect(C.normalizeFps(31)).toBe(12);
    expect(C.normalizeFps('abc')).toBe(12);
    expect(C.normalizeFps(12.5)).toBe(12);
    expect(C.FPS_DEFAULT).toBe(12);
  });
});
