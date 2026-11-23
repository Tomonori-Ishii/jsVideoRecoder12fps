// 録画セッションの書き込みと停止の結果（ADR-0004、0010）。ffmpeg は使わず、保存の判定と状態だけを見る。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RecordingSession } from '../../electron/recording/session.cjs';
import { readState } from '../../electron/recording/state.cjs';

describe('録画セッション（ADR-0004、0010）', () => {
  let root;
  let dir;
  let outDir;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-sess-'));
    dir = path.join(root, 'rec');
    outDir = path.join(root, 'Downloads');
    fs.mkdirSync(outDir);
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('開始時に状態ファイルを作り、停止で録画時間が 0 なら取り消して何も残さない', async () => {
    const s = new RecordingSession({ id: 'rec', dir, outDir, fps: 12, startedAt: new Date(2026, 0, 1, 10, 0, 0) });
    s.start();
    expect(readState(dir).status).toBe('recording');
    const result = await s.stop({ durationMs: 0 });
    expect(result.status).toBe('cancelled');
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('録画中に空き容量が不足して止めた場合は mp4 を作らず、中間ファイルを残す（stopped-space）', async () => {
    const s = new RecordingSession({ id: 'rec', dir, outDir, fps: 12, startedAt: new Date(2026, 0, 1), onProgress: () => {} });
    s.start();
    s.writeChunk('video-config', new Uint8Array([1, 2, 3]));
    s.writeChunk('video', new Uint8Array([9, 9, 9]), { tUs: 0, key: true });
    s.abortForSpace();
    const result = await s.stop({ durationMs: 1000 });
    expect(result.status).toBe('stopped-space');
    expect(fs.existsSync(dir)).toBe(true);
    expect(readState(dir).status).toBe('stopped-space');
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it('停止後に届いた符号化データは捨てる（例外にしない）', async () => {
    const s = new RecordingSession({ id: 'rec', dir, outDir, fps: 12, startedAt: new Date(2026, 0, 1) });
    s.start();
    await s.stop({ durationMs: 0 });
    expect(() => s.writeChunk('video', new Uint8Array([1]), { tUs: 0, key: true })).not.toThrow();
  });
});
