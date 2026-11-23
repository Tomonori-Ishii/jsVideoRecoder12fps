'use strict';

// 録画の設定値。ADR-0002、0004、0010 と要件書 F-021〜F-033 に対応する。
const GB = 1024 * 1024 * 1024;

const FPS_DEFAULT = 12;
const FPS_MIN = 1;
const FPS_MAX = 30;

module.exports = {
  FPS_DEFAULT,
  FPS_MIN,
  FPS_MAX,
  WIDTH: 1920,
  HEIGHT: 1080,
  // ADR-0003: Electron の WebCodecs で対応する High プロファイル（レベル 4.0）
  VIDEO_CODEC: 'avc1.640028',
  VIDEO_BITRATE: 1_000_000,
  AUDIO_SAMPLE_RATE: 48000,
  AUDIO_CHANNELS: 1,
  AUDIO_BITRATE: 128_000,
  // ADR-0004: 3 分（マイクロ秒）ごとに中間ファイルを切り替える
  SEGMENT_US: 180 * 1000 * 1000,
  // F-027: 録画時間の上限（ミリ秒）
  RECORDING_LIMIT_MS: 2 * 60 * 60 * 1000,
  // ADR-0010: 空き容量の判定（要件 9.1 の仮の値）
  DISK_CHECK_MS: 30 * 1000,
  START_MIN_FREE_BYTES: 3 * GB,
  RUN_EXTRA_FREE_BYTES: Math.round(0.5 * GB),
  MUX_EXTRA_FREE_BYTES: Math.round(0.2 * GB),
  // F-036: 進み具合の通知間隔
  PROGRESS_MS: 500,
  WINDOW: { width: 292, height: 80 },
  KEYFRAME_INTERVAL_SLOTS_SECONDS: 10,

  // F-032: 1〜30 の整数のみ有効。それ以外は既定値に戻す。
  normalizeFps(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= FPS_MIN && n <= FPS_MAX ? n : FPS_DEFAULT;
  },
};
