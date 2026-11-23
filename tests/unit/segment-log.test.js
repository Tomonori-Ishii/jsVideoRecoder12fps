import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SegmentWriter, scanSegments, readBody, readAudioBody, totalBytes, TYPE } from '../../electron/recording/segment-log.cjs';

describe('中間ファイルのレコード列（ADR-0004）', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-seg-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('映像・音声・スキップ・設定を書き、索引から読み戻せる', () => {
    const w = new SegmentWriter(dir);
    w.append(TYPE.VIDEO_CONFIG, 0, 0, Buffer.from([1, 2, 3]));
    w.append(TYPE.VIDEO, 1, 0, Buffer.from([10, 11, 12, 13]));
    const audioBody = Buffer.alloc(4 + 3);
    audioBody.writeUInt32LE(20000, 0);
    audioBody.set([7, 8, 9], 4);
    w.append(TYPE.AUDIO, 0, 5000, audioBody);
    w.append(TYPE.SKIP, 0, 1000000 / 12, Buffer.alloc(0));
    w.append(TYPE.VIDEO, 0, 1000000 / 12, Buffer.from([20]));
    w.close();

    const idx = scanSegments(dir, 12);
    expect(Array.from(idx.videoConfig)).toEqual([1, 2, 3]);
    expect(idx.videoBySlot.get(0).flags).toBe(1);
    expect(Array.from(readBody(dir, idx.videoBySlot.get(0)))).toEqual([10, 11, 12, 13]);
    expect(Array.from(readBody(dir, idx.videoBySlot.get(1)))).toEqual([20]);
    expect(idx.skipStarts).toHaveLength(1);
    const audio = readAudioBody(dir, idx.audio[0]);
    expect(audio.durationUs).toBe(20000);
    expect(Array.from(audio.data)).toEqual([7, 8, 9]);
    expect(totalBytes(dir)).toBeGreaterThan(0);
  });

  it('途中で切れたレコードは読まない', () => {
    const w = new SegmentWriter(dir);
    w.append(TYPE.VIDEO, 1, 0, Buffer.from([1, 2, 3, 4, 5]));
    w.close();
    const file = path.join(dir, 'seg-000.bin');
    fs.truncateSync(file, fs.statSync(file).size - 2);
    const idx = scanSegments(dir, 12);
    expect(idx.videoBySlot.size).toBe(0);
  });

  it('時刻が 3 分を超えると次のセグメントファイルに分ける', () => {
    const w = new SegmentWriter(dir);
    w.append(TYPE.VIDEO, 1, 0, Buffer.from([1]));
    w.append(TYPE.VIDEO, 1, 181e6, Buffer.from([2]));
    w.close();
    expect(fs.readdirSync(dir).sort()).toEqual(['seg-000.bin', 'seg-001.bin']);
  });
});
