'use strict';

// AVCDecoderConfigurationRecord（avcC）を、SPS と PPS（NAL 単位）から組み立てる。
function buildAvcC(sps, pps) {
  const out = [1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255, ...sps, 1, pps.length >> 8, pps.length & 255, ...pps];
  return Uint8Array.from(out);
}

module.exports = { buildAvcC };
