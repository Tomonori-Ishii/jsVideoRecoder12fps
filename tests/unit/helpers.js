import { execFileSync } from 'node:child_process';

// Annex B（開始コード付き）の H.264 を NAL の配列に分ける
export function splitAnnexB(buf) {
  const nals = [];
  let i = 0;
  const starts = [];
  while (i + 3 <= buf.length) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      starts.push({ at: i, len: 3 });
      i += 3;
    } else if (i + 4 <= buf.length && buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 1) {
      starts.push({ at: i, len: 4 });
      i += 4;
    } else {
      i++;
    }
  }
  for (let k = 0; k < starts.length; k++) {
    const from = starts[k].at + starts[k].len;
    const to = k + 1 < starts.length ? starts[k + 1].at : buf.length;
    nals.push(new Uint8Array(buf.subarray(from, to)));
  }
  return nals;
}

// ffmpeg（libx264、CAVLC、B フレームなし）で、与えた YUV420 の枠からストリームを作る
export function encodeWithX264(frames, width, height, fps) {
  const raw = Buffer.concat(frames.map((f) => Buffer.from(f)));
  return execFileSync(
    'ffmpeg',
    [
      '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'high', '-bf', '0',
      '-x264-params', 'cabac=0:keyint=1000:min-keyint=1000:scenecut=0:ref=1:no-scenecut=1',
      '-f', 'h264', 'pipe:1',
    ],
    { input: raw, maxBuffer: 1024 * 1024 * 512 },
  );
}

// 1 枚の YUV420 フレーム（Y 面は値の並び、UV は 128）
export function makeFrame(width, height, value) {
  const ySize = width * height;
  const out = new Uint8Array(ySize + ySize / 2);
  // 滑らかな模様（符号化の誤差を小さくするため、急な縁を作らない）
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = 128 + 90 * Math.sin(x / 120 + value) + 50 * Math.cos(y / 90 - value);
      out[y * width + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  out.fill(128, ySize);
  return out;
}

// デコード結果の Y 面（輝度）を枠ごとに返す。色変換を挟まないため、符号化の誤差だけを測れる。
export function decodeToY(file, width, height) {
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'], {
    maxBuffer: 1024 * 1024 * 512,
  });
  const frameBytes = (width * height * 3) / 2;
  const frames = [];
  for (let p = 0; p + frameBytes <= out.length; p += frameBytes) frames.push(out.subarray(p, p + width * height));
  return frames;
}
