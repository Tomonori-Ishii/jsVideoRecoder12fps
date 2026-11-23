// 録画の制御（要件 3 章の状態遷移、ADR-0002、0007、0008）。
// 状態: idle → recording ⇄ paused → stopping → idle。
// 停止後の保存は main 側で行い、結果を画面に出す。

import { MediaClock } from './clock.js';
import { VideoPipeline } from './video-pipeline.js';
import { AudioPipeline } from './audio-pipeline.js';
import { listMicrophones } from './devices.js';
import {
  LIMIT_MESSAGE,
  NO_MIC_MESSAGE,
  SCREEN_DENIED_MESSAGE,
  micErrorMessage,
} from './errors.js';
import { dbFromRms } from './format.js';

const LIMIT_MS = 2 * 60 * 60 * 1000; // F-027
const TICK_MS = 100;

export class Recorder {
  // api: preload が公開する window.recorder と同じ形
  constructor(api) {
    this.api = api;
    this.state = 'idle';
    this.clock = null;
    this.video = null;
    this.audio = null;
    this.displayStream = null;
    this.micStream = null;
    this.fps = 12;
    this.muted = false;
    this.message = null; // { kind: 'error' | 'info', text }
    this.progress = null;
    this.busy = false;
    this.toggleLock = false;
    this.listeners = new Set();
    this.ticker = null;
    this.unsubscribers = [
      api.onProgress((p) => {
        this.progress = p.percent;
        this.emit();
      }),
      api.onNotice((n) => this.onNotice(n)),
    ];
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  snapshot() {
    return {
      state: this.state,
      elapsedMs: this.clock ? this.clock.elapsedMs() : 0,
      level: this.audio ? this.audio.level() : 0,
      muted: this.muted,
      message: this.message,
      progress: this.progress,
    };
  }

  setMessage(kind, text) {
    this.message = text ? { kind, text } : null;
  }

  // 録画中に連続で呼ぶ更新（経過時間と音量の表示）
  startTicker() {
    this.stopTicker();
    this.ticker = setInterval(() => {
      if (this.state === 'recording' && this.clock && this.clock.elapsedMs() >= LIMIT_MS) {
        this.stop('limit');
        return;
      }
      if (this.state === 'recording' || this.state === 'paused') this.emit();
    }, TICK_MS);
  }

  stopTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  onNotice(n) {
    if (!n) return;
    if (n.kind === 'space' && (this.state === 'recording' || this.state === 'paused')) {
      this.setMessage('error', n.message);
      this.stop('space');
      return;
    }
    if (n.kind === 'error') {
      this.setMessage('error', n.message);
      this.emit();
    }
  }

  // F-015: 開始処理の途中や録画中の開始は無視する
  async start({ micDeviceId } = {}) {
    if (this.state !== 'idle' || this.busy) return;
    this.busy = true;
    this.muted = false;
    this.setMessage(null);
    this.progress = null;
    this.emit();

    let started;
    try {
      started = await this.api.startRecording({ fps: this.fps });
    } catch (err) {
      started = { ok: false, message: `開始できません: ${err.message}` };
    }
    if (!started.ok) {
      this.setMessage('error', started.message);
      this.busy = false;
      this.emit();
      return;
    }

    this.clock = new MediaClock();
    this.state = 'recording';
    try {
      await this.openSources(micDeviceId);
      const sink = this.makeSink();
      const shouldCapture = () => this.state === 'recording';
      this.audio = new AudioPipeline({
        micTrack: this.micStream.getAudioTracks()[0],
        systemTrack: this.displayStream.getAudioTracks()[0] || null,
        clock: this.clock,
        sink,
        muted: this.muted,
        shouldCapture,
      });
      this.video = new VideoPipeline({
        track: this.displayStream.getVideoTracks()[0],
        fps: this.fps,
        clock: this.clock,
        sink,
        keyframeIntervalSlots: this.fps * 10,
        shouldCapture,
      });
      await this.video.start();
      await this.audio.start();
      this.startTicker();
    } catch (err) {
      await this.abortStart(err);
      return;
    } finally {
      this.busy = false;
    }
    this.emit();
  }

  async openSources(micDeviceId) {
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'never', frameRate: this.fps },
        audio: true,
      });
    } catch (err) {
      const e = new Error('screen');
      e.cause = err;
      throw e;
    }
    this.displayStream = display;
    if (!display.getVideoTracks()[0]) throw new Error('screen');

    const mics = await listMicrophones();
    const chosen = micDeviceId || (mics[0] && mics[0].deviceId);
    if (!chosen) throw new Error('nomic');
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: chosen },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err) {
      err.isMic = true;
      throw err;
    }
  }

  async abortStart(err) {
    this.stopTicker();
    this.displayStream?.getTracks().forEach((t) => t.stop());
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.displayStream = null;
    this.micStream = null;
    try {
      await this.api.stopRecording({ durationMs: 0, reason: 'cancel' });
    } catch {
      // 取り消しに失敗しても、画面の状態は戻す
    }
    this.clock = null;
    this.state = 'idle';
    this.busy = false;
    this.setMessage('error', this.messageFor(err));
    this.emit();
  }

  messageFor(err) {
    if (err && err.message === 'nomic') return NO_MIC_MESSAGE;
    if (err && err.message === 'screen') return SCREEN_DENIED_MESSAGE;
    if (err && err.isMic) return micErrorMessage(err);
    return `エラーが発生しました: ${(err && err.message) || '不明'}`;
  }

  makeSink() {
    const api = this.api;
    return {
      chunk: (kind, bytes, meta) => api.sendChunk(kind, bytes, meta),
      skip: (tUs) => api.sendSkip(tUs),
      config: (desc) => api.sendChunk('video-config', desc, {}),
      audioConfig: (cfg) => api.sendChunk('audio-config', new TextEncoder().encode(JSON.stringify(cfg)), {}),
      encoder: (info) => api.sendChunk('encoder', new Uint8Array(0), info),
      error: (err) => this.onPipelineError(err),
    };
  }

  onPipelineError(err) {
    console.error('録画のエラー:', err);
    this.setMessage('error', `録画中にエラーが発生しました: ${err && err.message}`);
    this.stop('error');
  }

  // F-016 等: 一時停止・再開は、処理中の連続操作を無視する
  lockToggle() {
    if (this.toggleLock) return false;
    this.toggleLock = true;
    queueMicrotask(() => {
      this.toggleLock = false;
    });
    return true;
  }

  pause() {
    if (this.state !== 'recording' || !this.lockToggle()) return;
    this.state = 'paused';
    this.clock.pause();
    this.emit();
  }

  resume() {
    if (this.state !== 'paused' || !this.lockToggle()) return;
    this.state = 'recording';
    this.clock.run();
    this.emit();
  }

  toggleMute() {
    if (this.state !== 'recording' && this.state !== 'paused') return;
    this.muted = !this.muted;
    this.audio?.setMuted(this.muted);
    this.emit();
  }

  async stop(reason = 'user') {
    if ((this.state !== 'recording' && this.state !== 'paused') || this.busy) return;
    this.busy = true;
    this.state = 'stopping';
    this.progress = null;
    this.setMessage(null);
    this.clock.pause();
    this.stopTicker();
    const durationMs = this.clock.elapsedMs();
    this.emit();

    try {
      await this.video?.stop();
    } catch (err) {
      console.error(err);
    }
    try {
      await this.audio?.stop();
    } catch (err) {
      console.error(err);
    }
    this.displayStream?.getTracks().forEach((t) => t.stop());
    this.micStream?.getTracks().forEach((t) => t.stop());

    let result;
    try {
      result = await this.api.stopRecording({ durationMs, reason });
    } catch (err) {
      result = { status: 'failed', message: String(err && err.message) };
    }
    const limitPrefix = reason === 'limit' ? `${LIMIT_MESSAGE} ` : '';
    if (result.status === 'saved') {
      this.setMessage('info', `${limitPrefix}保存しました: ${result.path}`);
    } else if (result.status === 'stopped-space') {
      this.setMessage('error', `${result.message} 中間ファイル: ${result.dir}`);
    } else if (result.status === 'failed') {
      this.setMessage('error', `保存に失敗しました: ${result.message}`);
    } else if (result.status === 'cancelled') {
      this.setMessage(null);
    }

    this.progress = null;
    this.clock = null;
    this.video = null;
    this.audio = null;
    this.displayStream = null;
    this.micStream = null;
    this.state = 'idle';
    this.busy = false;
    this.emit();
  }

  async listDevices() {
    return listMicrophones();
  }

  dispose() {
    this.stopTicker();
    this.unsubscribers.forEach((u) => u());
  }
}

export { dbFromRms };
