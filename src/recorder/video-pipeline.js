// 映像の取り込みと符号化（F-019、F-021、F-022、F-034、F-035）。
// 12fps（設定値）の枠ごとに 1 枚を選ぶ。直前と同じ画面の枠は符号化せず、スキップとして記録する（ADR-0006）。

import { videoCodecConfig } from './codec-config.js';

const CAPTURE_W = 1920;
const CAPTURE_H = 1080;
const DIFF_W = 64;
const DIFF_H = 36;

export class VideoPipeline {
  // track: 画面の映像トラック。clock: MediaClock。sink: 送信先（chunk / skip / config）。
  constructor({ track, fps, clock, sink, keyframeIntervalSlots, shouldCapture, onFirstFrame }) {
    this.track = track;
    this.fps = fps;
    this.clock = clock;
    this.sink = sink;
    this.keyframeIntervalSlots = keyframeIntervalSlots;
    this.shouldCapture = shouldCapture;
    this.onFirstFrame = onFirstFrame || (() => {});
    this.canvas = new OffscreenCanvas(CAPTURE_W, CAPTURE_H);
    this.ctx = this.canvas.getContext('2d');
    this.diffCanvas = new OffscreenCanvas(DIFF_W, DIFF_H);
    this.diffCtx = this.diffCanvas.getContext('2d', { willReadFrequently: true });
    this.prevDiff = null;
    this.lastSlot = -1;
    this.lastKeySlot = -Infinity;
    this.hasEncoded = false;
    this.inSkip = false;
    this.encoder = null;
    this.reader = null;
    this.running = false;
    this.encoderInfo = null;
    this.frameCount = 0;
    this.skipCount = 0;
    this.encodedCount = 0;
  }

  slotUs(slot) {
    return Math.round((slot * 1e6) / this.fps);
  }

  async start() {
    const config = await videoCodecConfig(this.fps);
    this.encoderInfo = config.info;
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const desc = meta && meta.decoderConfig && meta.decoderConfig.description;
        if (desc) this.sink.config(new Uint8Array(desc));
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        this.encodedCount++;
        this.sink.chunk('video', bytes, { tUs: chunk.timestamp, key: chunk.type === 'key' });
      },
      error: (err) => this.sink.error(err),
    });
    this.encoder.configure(config.encoderConfig);
    this.sink.encoder(config.info);
    this.reader = new MediaStreamTrackProcessor({ track: this.track }).readable.getReader();
    this.running = true;
    this.readLoop();
  }

  async readLoop() {
    while (this.running) {
      let result;
      try {
        result = await this.reader.read();
      } catch {
        break;
      }
      if (result.done) break;
      const frame = result.value;
      try {
        this.onFrame(frame);
      } finally {
        frame.close();
      }
    }
  }

  // 1 枚の画面フレームを処理する
  onFrame(frame) {
    if (!this.shouldCapture()) return;
    if (!this.clock.running) {
      this.clock.run();
      this.onFirstFrame();
    }
    const slot = Math.floor((this.clock.elapsedMs() * this.fps) / 1000);
    if (slot <= this.lastSlot) return; // 同じ枠は 1 枚だけ（撮影が間に合わないフレームは落とす）
    this.lastSlot = slot;

    this.drawLetterbox(frame);
    const diff = this.downscale();
    if (this.hasEncoded && this.sameAs(diff, this.prevDiff)) {
      this.frameCount++;
      this.skipCount++;
      if (!this.inSkip) {
        this.inSkip = true;
        this.sink.skip(this.slotUs(slot));
      }
      return;
    }
    this.inSkip = false;
    const keyFrame = !this.hasEncoded || slot - this.lastKeySlot >= this.keyframeIntervalSlots;
    if (keyFrame) this.lastKeySlot = slot;
    const vf = new VideoFrame(this.canvas, {
      timestamp: this.slotUs(slot),
      duration: this.slotUs(1),
    });
    try {
      this.encoder.encode(vf, { keyFrame });
    } finally {
      vf.close();
    }
    this.hasEncoded = true;
    this.prevDiff = diff;
    this.frameCount++;
  }

  // 16:9 に合わせて 1920×1080 へ描く。余白は黒（F-022）
  drawLetterbox(frame) {
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    const scale = Math.min(CAPTURE_W / w, CAPTURE_H / h);
    const dw = Math.round(w * scale);
    const dh = Math.round(h * scale);
    const dx = Math.round((CAPTURE_W - dw) / 2);
    const dy = Math.round((CAPTURE_H - dh) / 2);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, CAPTURE_W, CAPTURE_H);
    this.ctx.drawImage(frame, dx, dy, dw, dh);
  }

  downscale() {
    this.diffCtx.drawImage(this.canvas, 0, 0, DIFF_W, DIFF_H);
    return this.diffCtx.getImageData(0, 0, DIFF_W, DIFF_H).data;
  }

  sameAs(a, b) {
    if (!b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  async stop() {
    this.running = false;
    try {
      await this.reader?.cancel();
    } catch {
      // 読み取り中の取り消しは無視する
    }
    if (this.encoder) {
      await this.encoder.flush();
      this.encoder.close();
      this.encoder = null;
    }
    this.track.stop();
  }
}
