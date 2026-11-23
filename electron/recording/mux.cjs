'use strict';

// 停止時の多重化（ADR-0005）。中間ファイルの符号化データを mp4 にまとめる。再符号化はしない。
// 符号化されていない枠は、スキップフレーム（ADR-0006）として合成する。

const fs = require('node:fs');
const { Muxer, StreamTarget } = require('mp4-muxer');
const C = require('./config.cjs');
const { scanSegments, readBody, readAudioBody } = require('./segment-log.cjs');
const {
  parseAvcC,
  parseSps,
  parsePps,
  splitAvcSample,
  joinAvcSample,
  rewriteFrameNum,
  sliceInfo,
  buildSkipSliceNal,
} = require('./h264.cjs');

function hex2(n) {
  return n.toString(16).padStart(2, '0');
}

// durationMs: 録画時間（一時停止を除く）。枠数は ceil(durationMs × fps / 1000)。
// 戻り値: { frames, skippedFrames, audioChunks, durationUs }
function muxRecording({ dir, fps, durationMs, outPath, onProgress = () => {} }) {
  const index = scanSegments(dir, fps);
  if (!index.videoConfig) throw new Error('映像の設定が中間ファイルにありません');
  const avc = parseAvcC(index.videoConfig);
  const sps = parseSps(avc.sps);
  const pps = parsePps(avc.pps);
  const frameCount = Math.ceil((durationMs * fps) / 1000);
  if (frameCount <= 0) throw new Error('録画時間が 0 です');
  const frameDurUs = Math.round(1e6 / fps);
  const totalUs = frameCount * frameDurUs;
  const slotUs = (s) => Math.round((s * 1e6) / fps);
  const codec = `avc1.${hex2(avc.sps[1])}${hex2(avc.sps[2])}${hex2(avc.sps[3])}`;
  const audioConfig = index.audioConfig || { codec: 'opus', numberOfChannels: C.AUDIO_CHANNELS, sampleRate: C.AUDIO_SAMPLE_RATE };

  const fd = fs.openSync(outPath, 'w');
  const target = new StreamTarget({
    onData: (data, position) => {
      fs.writeSync(fd, data, 0, data.length, position);
    },
  });
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: C.WIDTH, height: C.HEIGHT, frameRate: fps },
    audio: { codec: 'opus', numberOfChannels: audioConfig.numberOfChannels, sampleRate: audioConfig.sampleRate },
    fastStart: false,
  });

  let audioIdx = 0;
  let audioChunks = 0;
  let lastAudioEndUs = 0;
  let lastVideoEndUs = 0;
  let lastProgress = -1;
  const reportProgress = () => {
    const done = Math.min(totalUs, Math.max(lastVideoEndUs, lastAudioEndUs));
    const percent = Math.floor((done / totalUs) * 100);
    if (percent !== lastProgress) {
      lastProgress = percent;
      onProgress(percent);
    }
  };
  const flushAudioUntil = (limitUs) => {
    while (audioIdx < index.audio.length && index.audio[audioIdx].tUs <= limitUs) {
      const e = index.audio[audioIdx++];
      const { durationUs, data } = readAudioBody(dir, e);
      const meta = audioChunks === 0 ? { decoderConfig: audioConfig } : undefined;
      muxer.addAudioChunkRaw(data, 'key', e.tUs, durationUs, meta);
      lastAudioEndUs = e.tUs + durationUs;
      audioChunks++;
    }
  };

  // 枠の frame_num は、直近の IDR からの枠数（全枠が参照ピクチャー）。IDR は 0。
  const frameNumMod = 2 ** sps.log2MaxFrameNum;
  let idrSlot = 0;
  let skipped = 0;
  for (let s = 0; s < frameCount; s++) {
    const tUs = slotUs(s);
    flushAudioUntil(tUs);
    const entry = index.videoBySlot.get(s);
    if (entry) {
      const sample = readBody(dir, entry);
      const nals = splitAvcSample(sample, avc.lengthSize);
      const outNals = nals.map((nal) => {
        if (sliceInfo(nal).isIdr) idrSlot = s;
        return rewriteFrameNum(nal, sps, (s - idrSlot) % frameNumMod);
      });
      const data = joinAvcSample(outNals, avc.lengthSize);
      const isKey = (entry.flags & 1) === 1;
      const meta = s === 0 ? { decoderConfig: { codec, description: index.videoConfig } } : undefined;
      muxer.addVideoChunkRaw(data, isKey ? 'key' : 'delta', tUs, frameDurUs, meta);
    } else {
      if (s === 0) throw new Error('先頭の枠が符号化されていません');
      const nal = buildSkipSliceNal({ sps, pps, frameNum: (s - idrSlot) % frameNumMod });
      const data = joinAvcSample([nal], avc.lengthSize);
      muxer.addVideoChunkRaw(data, 'delta', tUs, frameDurUs);
      skipped++;
    }
    lastVideoEndUs = tUs + frameDurUs;
    reportProgress();
  }
  flushAudioUntil(Infinity);
  reportProgress();
  muxer.finalize();
  fs.closeSync(fd);
  onProgress(100);
  return { frames: frameCount, skippedFrames: skipped, audioChunks, durationUs: totalUs };
}

module.exports = { muxRecording };
