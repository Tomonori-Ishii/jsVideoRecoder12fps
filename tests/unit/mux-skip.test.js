// 停止時の多重化と、スキップフレームの検証（F-021、F-035）。ffmpeg で実際にデコードして確かめる。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SegmentWriter, TYPE } from '../../electron/recording/segment-log.cjs';
import { muxRecording } from '../../electron/recording/mux.cjs';
import { buildAvcC } from '../../electron/recording/avcc.cjs';
import { parseSps, parsePps } from '../../electron/recording/h264.cjs';
import { splitAnnexB, encodeWithX264, makeFrame, decodeToY } from './helpers.js';

const W = 1920;
const H = 1080;
const FPS = 12;
const N = 12;
// 枠 4〜8 は枠 3 と同じ画面（スキップ対象）。それ以外は別の画面。
const SAME_AS_3 = new Set([4, 5, 6, 7, 8]);

describe('スキップフレームを含む多重化（ADR-0005、0006）', () => {
  let dir;
  let out;
  let progress = [];
  let h264Nals;
  const srcFrames = [];

  beforeAll(() => {
    for (let k = 0; k < N; k++) {
      srcFrames.push(makeFrame(W, H, SAME_AS_3.has(k) ? 3 : k));
    }
    const stream = encodeWithX264(srcFrames, W, H, FPS);
    h264Nals = splitAnnexB(stream);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-mux-'));
    out = path.join(dir, 'out.mp4');
  }, 120000);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('SPS の POC の種類は 2、PPS は CAVLC（スキップ合成の前提、ADR-0003、0006）', () => {
    const sps = parseSps(h264Nals.find((n) => (n[0] & 31) === 7));
    const pps = parsePps(h264Nals.find((n) => (n[0] & 31) === 8));
    expect(sps.pocType).toBe(2);
    expect(pps.cabac).toBe(false);
  });

  it('符号化されなかった枠をスキップとして補い、デコードできる。スキップの枠は直前の枠と同じ画面になる', () => {
    const w = new SegmentWriter(dir);
    const sps = h264Nals.find((n) => (n[0] & 31) === 7);
    const pps = h264Nals.find((n) => (n[0] & 31) === 8);
    w.append(TYPE.VIDEO_CONFIG, 0, 0, buildAvcC(sps, pps));
    w.append(TYPE.AUDIO_CONFIG, 0, 0, Buffer.from(JSON.stringify({ codec: 'opus', numberOfChannels: 1, sampleRate: 48000 })));
    const pictures = h264Nals.filter((n) => (n[0] & 31) === 1 || (n[0] & 31) === 5);
    expect(pictures).toHaveLength(N);
    const encodedSlots = [0, 1, 2, 3, 9, 10, 11];
    for (const k of encodedSlots) {
      const nal = pictures[k];
      const tUs = Math.round((k * 1e6) / FPS);
      const body = Buffer.concat([Buffer.from([nal.length >>> 24, (nal.length >> 16) & 255, (nal.length >> 8) & 255, nal.length & 255]), Buffer.from(nal)]);
      w.append(TYPE.VIDEO, (nal[0] & 31) === 5 ? 1 : 0, tUs, body);
    }
    w.append(TYPE.SKIP, 0, Math.round((4 * 1e6) / FPS), Buffer.alloc(0));
    w.close();

    progress = [];
    const result = muxRecording({ dir, fps: FPS, durationMs: (N / FPS) * 1000, outPath: out, onProgress: (p) => progress.push(p) });
    expect(result.frames).toBe(N);
    expect(result.skippedFrames).toBe(SAME_AS_3.size);

    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,r_frame_rate,codec_name,width,height', '-of', 'json', out], { encoding: 'utf8' }));
    const s = info.streams[0];
    expect(s.codec_name).toBe('h264');
    expect(s.r_frame_rate).toBe('12/1');
    expect(s.nb_read_frames).toBe(String(N));
  }, 120000);

  it('進み具合は単調に増え、最後に 100 になる（F-036）', () => {
    expect(progress.length).toBeGreaterThan(1);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    expect(progress[progress.length - 1]).toBe(100);
  });

  it('デコード結果: 枠 4〜8 は枠 3 と完全に一致する（スキップの正しさ）', () => {
    const frames = decodeToY(out, W, H);
    expect(frames).toHaveLength(N);
    for (const k of SAME_AS_3) {
      expect(Buffer.compare(Buffer.from(frames[k]), Buffer.from(frames[3]))).toBe(0);
    }
  }, 120000);

  it('デコード結果: 符号化した枠は元の画面に近い（平均絶対誤差が小さい）', () => {
    const frames = decodeToY(out, W, H);
    for (const k of [0, 1, 2, 9, 10, 11]) {
      const src = srcFrames[k].subarray(0, W * H);
      let sum = 0;
      for (let i = 0; i < W * H; i += 17) sum += Math.abs(src[i] - frames[k][i]);
      const mae = sum / Math.ceil((W * H) / 17);
      expect(mae).toBeLessThan(6);
    }
  }, 120000);
});
