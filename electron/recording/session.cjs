'use strict';

// 1 回の録画（セッション）の管理。中間ファイルへの書き込み、停止と保存（ADR-0004、0005、0010）。
// Electron 非依存にし、単体テストから直接使えるようにする。

const fs = require('node:fs');
const path = require('node:path');
const { SegmentWriter, TYPE, totalBytes } = require('./segment-log.cjs');
const { muxRecording } = require('./mux.cjs');
const { writeState, removeRecordingDir } = require('./state.cjs');
const { outputName } = require('./paths.cjs');
const { freeBytes, canMux } = require('./disk.cjs');

class RecordingSession {
  // dir: 録画フォルダ（中間ファイル）。outDir: 保存先（Downloads）。
  constructor({ id, dir, outDir, fps, startedAt, onProgress = () => {} }) {
    this.id = id;
    this.dir = dir;
    this.outDir = outDir;
    this.fps = fps;
    this.startedAt = startedAt;
    this.onProgress = onProgress;
    this.writer = null;
    this.encoderInfo = null;
    this.abortedForSpace = false;
    this.finished = false;
  }

  start() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.writer = new SegmentWriter(this.dir);
    writeState(this.dir, {
      id: this.id,
      status: 'recording',
      fps: this.fps,
      startedAt: this.startedAt.toISOString(),
      dir: this.dir,
      encoder: null,
      partialPath: null,
    });
  }

  // kind: 'video' | 'audio' | 'video-config' | 'audio-config' | 'encoder'
  writeChunk(kind, data, meta = {}) {
    if (this.finished || this.abortedForSpace || !this.writer) return;
    const bytes = Buffer.from(data.buffer ? data : new Uint8Array(data));
    switch (kind) {
      case 'video':
        this.writer.append(TYPE.VIDEO, meta.key ? 1 : 0, meta.tUs, bytes);
        break;
      case 'audio': {
        const body = Buffer.alloc(4 + bytes.length);
        body.writeUInt32LE(Math.max(0, Math.round(meta.durationUs || 0)), 0);
        bytes.copy(body, 4);
        this.writer.append(TYPE.AUDIO, 0, meta.tUs, body);
        break;
      }
      case 'video-config':
        this.writer.append(TYPE.VIDEO_CONFIG, 0, 0, bytes);
        break;
      case 'audio-config':
        this.writer.append(TYPE.AUDIO_CONFIG, 0, 0, bytes);
        break;
      case 'encoder':
        this.encoderInfo = meta;
        writeState(this.dir, this.snapshot({ encoder: meta }));
        break;
      default:
        throw new Error(`未知の種類: ${kind}`);
    }
  }

  writeSkip(tUs) {
    if (this.finished || this.abortedForSpace || !this.writer) return;
    this.writer.append(TYPE.SKIP, 0, tUs, Buffer.alloc(0));
  }

  snapshot(extra = {}) {
    return {
      id: this.id,
      status: 'recording',
      fps: this.fps,
      startedAt: this.startedAt.toISOString(),
      dir: this.dir,
      encoder: this.encoderInfo,
      partialPath: null,
      ...extra,
    };
  }

  // 空き容量の不足で録画を止める（mp4 は作らず、中間ファイルを残す）
  abortForSpace() {
    if (this.writer) this.writer.close();
    this.abortedForSpace = true;
    writeState(this.dir, this.snapshot({ status: 'stopped-space' }));
  }

  // 通常の停止。戻り値: { status: 'saved'|'failed'|'stopped-space'|'cancelled', ... }
  async stop({ durationMs }) {
    if (this.finished) return { status: 'failed', message: '録画は既に終了しています' };
    this.finished = true;
    if (this.writer) this.writer.close();
    if (this.abortedForSpace) {
      return this.keepForSpace('空き容量が不足したため録画を止めました。');
    }
    if (durationMs <= 0) {
      removeRecordingDir(this.dir);
      return { status: 'cancelled' };
    }
    const intermediate = totalBytes(this.dir);
    const free = await freeBytes(this.outDir);
    if (!canMux(free, intermediate)) {
      writeState(this.dir, this.snapshot({ status: 'stopped-space' }));
      return this.keepForSpace('空き容量が不足したため、mp4 を作らずに中間ファイルを残しました。');
    }

    const finalPath = path.join(this.outDir, outputName(this.startedAt));
    const partialPath = finalPath + '.partial';
    writeState(this.dir, this.snapshot({ status: 'stopping', partialPath }));
    try {
      muxRecording({
        dir: this.dir,
        fps: this.fps,
        durationMs,
        outPath: partialPath,
        onProgress: (percent) => this.onProgress(percent),
      });
      if (fs.existsSync(finalPath)) fs.rmSync(finalPath, { force: true }); // 同名は上書き（要件 7.6）
      fs.renameSync(partialPath, finalPath);
    } catch (err) {
      fs.rmSync(partialPath, { force: true });
      writeState(this.dir, this.snapshot({ status: 'failed', partialPath: null, error: String(err && err.message) }));
      return { status: 'failed', message: String(err && err.message) };
    }
    removeRecordingDir(this.dir);
    return { status: 'saved', path: finalPath };
  }

  keepForSpace(message) {
    return { status: 'stopped-space', dir: this.dir, message };
  }
}

module.exports = { RecordingSession };
