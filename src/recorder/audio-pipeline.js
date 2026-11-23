// 音声の混合と符号化（F-020、F-013、ADR-0002）。
// マイクとスピーカー（システム音）を Web Audio でモノラルに混ぜ、Opus（48kHz、128kbps）で符号化する。

import { audioCodecConfig, AUDIO } from './codec-config.js';
import { LevelMeter } from './level-meter.js';

export class AudioPipeline {
  constructor({ micTrack, systemTrack, clock, sink, muted, shouldCapture, onLevel }) {
    this.micTrack = micTrack;
    this.systemTrack = systemTrack;
    this.clock = clock;
    this.sink = sink;
    this.shouldCapture = shouldCapture;
    this.onLevel = onLevel || (() => {});
    this.muted = muted;
    this.ctx = null;
    this.micGain = null;
    this.encoder = null;
    this.reader = null;
    this.running = false;
    this.recordedSamples = 0;
    this.meter = null;
    this.sampleRate = AUDIO.SAMPLE_RATE;
  }

  async start() {
    this.ctx = new AudioContext({ sampleRate: AUDIO.SAMPLE_RATE });
    this.sampleRate = this.ctx.sampleRate;
    this.meter = new LevelMeter(this.sampleRate, 50);

    const mix = this.ctx.createGain();
    mix.channelCount = AUDIO.CHANNELS;
    mix.channelCountMode = 'explicit';
    mix.channelInterpretation = 'speakers';

    const micSource = this.ctx.createMediaStreamSource(new MediaStream([this.micTrack]));
    this.micGain = this.ctx.createGain();
    this.micGain.gain.value = this.muted ? 0 : 1;
    micSource.connect(this.micGain).connect(mix);

    if (this.systemTrack) {
      const sysSource = this.ctx.createMediaStreamSource(new MediaStream([this.systemTrack]));
      sysSource.connect(mix);
    }

    const dest = this.ctx.createMediaStreamDestination();
    dest.channelCount = AUDIO.CHANNELS;
    dest.channelCountMode = 'explicit';
    mix.connect(dest);
    this.mixTrack = dest.stream.getAudioTracks()[0];

    const config = await audioCodecConfig(this.sampleRate);
    this.encoder = new AudioEncoder({
      output: (chunk) => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        this.sink.chunk('audio', bytes, { tUs: chunk.timestamp, durationUs: chunk.duration || 0 });
      },
      error: (err) => this.sink.error(err),
    });
    this.encoder.configure(config);
    this.sink.audioConfig({
      codec: 'opus',
      numberOfChannels: AUDIO.CHANNELS,
      sampleRate: this.sampleRate,
    });

    this.reader = new MediaStreamTrackProcessor({ track: this.mixTrack }).readable.getReader();
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
      const data = result.value;
      try {
        this.onData(data);
      } finally {
        data.close();
      }
    }
  }

  onData(data) {
    if (!this.shouldCapture() || !this.clock.running) return;
    const n = data.numberOfFrames;
    const samples = new Float32Array(n);
    data.copyTo(samples, { planeIndex: 0 });
    this.meter.push(samples);
    // 音声の時刻は、録画した（一時停止を除いた）サンプル数から決める（ADR-0007）
    const tUs = Math.round((this.recordedSamples * 1e6) / this.sampleRate);
    this.recordedSamples += n;
    const out = new AudioData({
      format: 'f32-planar',
      sampleRate: this.sampleRate,
      numberOfFrames: n,
      numberOfChannels: AUDIO.CHANNELS,
      timestamp: tUs,
      data: samples,
    });
    try {
      this.encoder.encode(out);
    } finally {
      out.close();
    }
  }

  // 音量の表示用（約 100ms ごとに呼ぶ）
  level() {
    return this.meter ? this.meter.rms() : 0;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.micGain) this.micGain.gain.value = muted ? 0 : 1;
  }

  async stop() {
    this.running = false;
    try {
      await this.reader?.cancel();
    } catch {
      // 読み取りの取り消しは無視する
    }
    if (this.encoder) {
      await this.encoder.flush();
      this.encoder.close();
      this.encoder = null;
    }
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
    this.micTrack.stop();
    this.systemTrack?.stop();
  }
}
