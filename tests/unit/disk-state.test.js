import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canStart, canContinue, canMux, freeBytes } from '../../electron/recording/disk.cjs';
import { writeState, readState, cleanupStale, removeRecordingDir } from '../../electron/recording/state.cjs';
import C from '../../electron/recording/config.cjs';

const GB = 1024 ** 3;

describe('空き容量の判定（F-033、ADR-0010）', () => {
  it('開始は 3GB 以上の空きが必要（境界値を含む）', () => {
    expect(canStart(3 * GB)).toBe(true);
    expect(canStart(3 * GB - 1)).toBe(false);
  });

  it('録画中は「中間データ + 0.5GB」以上が必要', () => {
    const data = 1 * GB;
    expect(canContinue(data + C.RUN_EXTRA_FREE_BYTES, data)).toBe(true);
    expect(canContinue(data + C.RUN_EXTRA_FREE_BYTES - 1, data)).toBe(false);
  });

  it('通常停止では「中間データ + 0.2GB」以上が必要（不足時は mp4 を作らない）', () => {
    const data = 1 * GB;
    expect(canMux(data + C.MUX_EXTRA_FREE_BYTES, data)).toBe(true);
    expect(canMux(data + C.MUX_EXTRA_FREE_BYTES - 1, data)).toBe(false);
  });

  it('実際のファイルシステムの空き容量を取得できる', async () => {
    const free = await freeBytes(os.tmpdir());
    expect(free).toBeGreaterThan(0);
  });
});

describe('状態ファイルと起動時の掃除（F-037、F-038）', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-state-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('状態を書き、読み戻せる', () => {
    const dir = path.join(root, 'rec_1');
    fs.mkdirSync(dir);
    writeState(dir, { id: 'rec_1', status: 'recording' });
    expect(readState(dir)).toMatchObject({ id: 'rec_1', status: 'recording', version: 1 });
  });

  it('state.json を持つ録画フォルダと、記録された .partial を削除する。持たないフォルダは残す', () => {
    const stale = path.join(root, 'rec_stale');
    const keep = path.join(root, 'other');
    const downloads = path.join(root, 'Downloads');
    fs.mkdirSync(stale);
    fs.mkdirSync(keep);
    fs.mkdirSync(downloads);
    const partial = path.join(downloads, 'screen_1.mp4.partial');
    fs.writeFileSync(partial, 'x');
    writeState(stale, { id: 'rec_stale', status: 'failed', partialPath: partial });
    const removed = cleanupStale(root);
    expect(removed).toEqual([stale]);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(keep)).toBe(true);
    expect(fs.existsSync(partial)).toBe(false); // 状態に記録された .partial も消す
  });

  it('記録された .partial を、録画フォルダごと削除する', () => {
    const rec = path.join(root, 'rec_2');
    const partial = path.join(root, 'screen_2.mp4.partial');
    fs.mkdirSync(rec);
    fs.writeFileSync(partial, 'x');
    writeState(rec, { id: 'rec_2', status: 'stopping', partialPath: partial });
    removeRecordingDir(rec);
    expect(fs.existsSync(rec)).toBe(false);
    expect(fs.existsSync(partial)).toBe(false);
  });

  it('録画ルートが無ければ何もしない', () => {
    expect(cleanupStale(path.join(root, 'missing'))).toEqual([]);
  });
});
