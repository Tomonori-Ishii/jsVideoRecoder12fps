// 符号化の設定（ADR-0002、ADR-0003）。

const VIDEO_CODEC = 'avc1.640028'; // H.264 High, Level 4.0
const VIDEO_BITRATE = 1_000_000;
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 1;
const AUDIO_BITRATE = 128_000;

// ハードウェア符号化を優先し、受け付けられない場合は既定の方式（ソフトウェアを含む）にする（F-034）。
// info.used は要求が受け付けられた方式。実際の実装（HW か SW か）は WebCodecs から取れないため、
// 「要求の受理」だけを記録する（ADR-0002）。
export async function videoCodecConfig(fps) {
  const base = {
    codec: VIDEO_CODEC,
    width: 1920,
    height: 1080,
    framerate: fps,
    bitrate: VIDEO_BITRATE,
    latencyMode: 'realtime',
    avc: { format: 'avc' },
  };
  for (const preference of ['prefer-hardware', 'no-preference']) {
    const encoderConfig = { ...base, hardwareAcceleration: preference };
    const support = await VideoEncoder.isConfigSupported(encoderConfig);
    if (support.supported) {
      return {
        encoderConfig,
        info: {
          hwRequested: 'prefer-hardware',
          accepted: preference,
          fellBack: preference !== 'prefer-hardware',
        },
      };
    }
  }
  throw new Error('H.264 の符号化に対応していません');
}

export async function audioCodecConfig(sampleRate) {
  const encoderConfig = {
    codec: 'opus',
    sampleRate,
    numberOfChannels: AUDIO_CHANNELS,
    bitrate: AUDIO_BITRATE,
  };
  const support = await AudioEncoder.isConfigSupported(encoderConfig);
  if (!support.supported) throw new Error('Opus の符号化に対応していません');
  return encoderConfig;
}

export const AUDIO = { SAMPLE_RATE: AUDIO_SAMPLE_RATE, CHANNELS: AUDIO_CHANNELS };
