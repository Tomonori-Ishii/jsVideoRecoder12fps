// 音量（F-005）。直近 50ms の RMS を求める。

export class LevelMeter {
  constructor(sampleRate, windowMs = 50) {
    this.size = Math.round((sampleRate * windowMs) / 1000);
    this.buf = new Float32Array(this.size);
    this.pos = 0;
    this.filled = 0;
  }

  push(samples) {
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.pos] = samples[i];
      this.pos = (this.pos + 1) % this.size;
    }
    this.filled = Math.min(this.size, this.filled + samples.length);
  }

  reset() {
    this.buf.fill(0);
    this.pos = 0;
    this.filled = 0;
  }

  rms() {
    if (this.filled === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.size; i++) sum += this.buf[i] * this.buf[i];
    return Math.sqrt(sum / this.size);
  }
}
