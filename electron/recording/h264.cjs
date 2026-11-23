'use strict';

// H.264 のヘッダー解析と、スキップフレーム（全マクロブロックがスキップの P スライス）の合成。
// ADR-0003（High プロファイル、CAVLC のみ合成）、ADR-0006（POC は type 2）に対応する。

const { BitReader, BitWriter, escapeRbsp, unescapeNal } = require('./bits.cjs');

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

// AVCDecoderConfigurationRecord（avcC）から SPS と PPS を取り出す
function parseAvcC(avcC) {
  if (!avcC || avcC.length < 7 || avcC[0] !== 1) throw new Error('avcC が不正です');
  const lengthSize = (avcC[4] & 3) + 1;
  let p = 5;
  const numSps = avcC[p++] & 31;
  const sps = [];
  for (let i = 0; i < numSps; i++) {
    const len = (avcC[p] << 8) | avcC[p + 1];
    p += 2;
    sps.push(avcC.subarray(p, p + len));
    p += len;
  }
  const numPps = avcC[p++];
  const pps = [];
  for (let i = 0; i < numPps; i++) {
    const len = (avcC[p] << 8) | avcC[p + 1];
    p += 2;
    pps.push(avcC.subarray(p, p + len));
    p += len;
  }
  if (sps.length === 0 || pps.length === 0) throw new Error('avcC に SPS / PPS がありません');
  return { lengthSize, sps: sps[0], pps: pps[0] };
}

// SPS（NAL の 1 バイト目を含む）を解析する。対応外の構成は例外にする。
function parseSps(spsNal) {
  const r = new BitReader(unescapeNal(spsNal.subarray(1)));
  const profile = r.u(8);
  r.u(8); // constraint flags
  const level = r.u(8);
  r.ue(); // seq_parameter_set_id
  if (HIGH_PROFILES.has(profile)) {
    const chroma = r.ue();
    if (chroma === 3) r.u(1);
    r.ue(); // bit_depth_luma_minus8
    r.ue(); // bit_depth_chroma_minus8
    r.u(1); // qpprime_y_zero_transform_bypass_flag
    if (r.u(1)) throw new Error('対応外: seq_scaling_matrix_present_flag');
  }
  const log2MaxFrameNum = r.ue() + 4;
  const pocType = r.ue();
  if (pocType === 0) {
    r.ue(); // log2_max_pic_order_cnt_lsb_minus4（POC の下位ビット数）
  } else if (pocType !== 2) {
    throw new Error(`対応外: pic_order_cnt_type ${pocType}`);
  }
  r.ue(); // max_num_ref_frames
  r.u(1); // gaps_in_frame_num_value_allowed_flag
  const widthMbs = r.ue() + 1;
  const heightMapUnits = r.ue() + 1;
  const frameMbsOnly = r.u(1);
  if (!frameMbsOnly) throw new Error('対応外: frame_mbs_only_flag = 0');
  return {
    profile,
    level,
    log2MaxFrameNum,
    pocType,
    picSizeInMbs: widthMbs * heightMapUnits,
  };
}

// PPS（NAL の 1 バイト目を含む）を解析する
function parsePps(ppsNal) {
  const r = new BitReader(unescapeNal(ppsNal.subarray(1)));
  const ppsId = r.ue();
  r.ue(); // seq_parameter_set_id
  const cabac = r.u(1);
  const bottomFieldPicOrderPresent = r.u(1);
  const numSliceGroupsMinus1 = r.ue();
  if (numSliceGroupsMinus1 > 0) throw new Error('対応外: スライスグループ');
  r.ue(); // num_ref_idx_l0_default_active_minus1
  r.ue(); // num_ref_idx_l1_default_active_minus1
  const weightedPred = r.u(1);
  r.u(2); // weighted_bipred_idc
  r.se(); // pic_init_qp_minus26
  r.se(); // pic_init_qs_minus26
  r.se(); // chroma_qp_index_offset
  const deblockingControlPresent = r.u(1);
  r.u(1); // constrained_intra_pred_flag
  const redundantPicCntPresent = r.u(1);
  return {
    ppsId,
    cabac: cabac === 1,
    bottomFieldPicOrderPresent: bottomFieldPicOrderPresent === 1,
    weightedPred: weightedPred === 1,
    deblockingControlPresent: deblockingControlPresent === 1,
    redundantPicCntPresent: redundantPicCntPresent === 1,
  };
}

// AVC 形式（長さ付き NAL の連続）を NAL の配列に分ける
function splitAvcSample(sample, lengthSize) {
  const nals = [];
  let p = 0;
  while (p < sample.length) {
    let len = 0;
    for (let i = 0; i < lengthSize; i++) len = len * 256 + sample[p + i];
    p += lengthSize;
    nals.push(sample.subarray(p, p + len));
    p += len;
  }
  return nals;
}

function joinAvcSample(nals, lengthSize) {
  let total = 0;
  for (const n of nals) total += lengthSize + n.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const n of nals) {
    let len = n.length;
    for (let i = lengthSize - 1; i >= 0; i--) {
      out[p + i] = len % 256;
      len = Math.floor(len / 256);
    }
    p += lengthSize;
    out.set(n, p);
    p += n.length;
  }
  return out;
}

function setBits(bytes, bitPos, n, value) {
  for (let i = 0; i < n; i++) {
    const bit = Math.floor(value / 2 ** (n - 1 - i)) % 2;
    const idx = (bitPos + i) >> 3;
    const shift = 7 - ((bitPos + i) & 7);
    bytes[idx] = (bytes[idx] & ~(1 << shift)) | (bit << shift);
  }
}

// スライス（nal_unit_type 1 または 5）の frame_num を frameNum に書き換える（ADR-0006）。
// frame_num の位置と長さは変わらないため、ビットを上書きするだけでよい。
// スライス以外の NAL は変更しない。戻り値: 書き換え後の NAL。
function rewriteFrameNum(nal, sps, frameNum) {
  const type = nal[0] & 31;
  if (type !== 1 && type !== 5) return nal;
  const rbsp = unescapeNal(nal.subarray(1));
  const r = new BitReader(rbsp);
  r.ue(); // first_mb_in_slice
  r.ue(); // slice_type
  r.ue(); // pic_parameter_set_id
  const pos = r.pos;
  r.u(sps.log2MaxFrameNum); // 読み飛ばし（位置の確認）
  const rewritten = Uint8Array.from(rbsp);
  setBits(rewritten, pos, sps.log2MaxFrameNum, frameNum % 2 ** sps.log2MaxFrameNum);
  const escaped = escapeRbsp(rewritten);
  const out = new Uint8Array(1 + escaped.length);
  out[0] = nal[0];
  out.set(escaped, 1);
  return out;
}

// スライスのヘッダーから、IDR かどうかと nal_ref_idc を返す
function sliceInfo(nal) {
  return { isIdr: (nal[0] & 31) === 5, isRef: ((nal[0] >> 5) & 3) !== 0 };
}

// スキップフレーム（全マクロブロックが P_Skip）の NAL を合成する。
// 参照ピクチャーとして扱う（nal_ref_idc = 1）。POC は pic_order_cnt_type 2 により frame_num から決まる。
// frame_num は、直前の枠の次の値（全枠が参照ピクチャーのため、枠番号どおりになる）。
function buildSkipSliceNal({ sps, pps, frameNum }) {
  if (pps.cabac) throw new Error('CABAC のスキップ合成は未対応（ADR-0003 のフォールバック）');
  if (pps.weightedPred) throw new Error('重み付き予測のスキップ合成は未対応');
  if (sps.pocType !== 2) throw new Error('POC の種類が 2 以外のスキップ合成は未対応');
  const w = new BitWriter();
  w.ue(0); // first_mb_in_slice
  w.ue(5); // slice_type（5 = P、スライス内で全て P）
  w.ue(pps.ppsId); // pic_parameter_set_id
  w.u(sps.log2MaxFrameNum, frameNum % 2 ** sps.log2MaxFrameNum);
  if (pps.redundantPicCntPresent) w.ue(0); // redundant_pic_cnt
  w.u(1, 0); // num_ref_idx_active_override_flag
  w.u(1, 0); // ref_pic_list_modification_flag_l0
  w.u(1, 0); // adaptive_ref_pic_marking_mode_flag（スライディングウィンドウ）
  w.se(0); // slice_qp_delta
  if (pps.deblockingControlPresent) {
    w.ue(0); // disable_deblocking_filter_idc（有効）
    w.se(0); // slice_alpha_c0_offset_div2
    w.se(0); // slice_beta_offset_div2
  }
  // slice_data（CAVLC）: mb_skip_run に全マクロブロック数
  w.ue(sps.picSizeInMbs);
  w.trailing();
  const escaped = escapeRbsp(w.toBytes());
  const nal = new Uint8Array(1 + escaped.length);
  nal[0] = 0x21; // forbidden_zero=0, nal_ref_idc=1, nal_unit_type=1（非 IDR スライス）
  nal.set(escaped, 1);
  return nal;
}

module.exports = {
  parseAvcC,
  parseSps,
  parsePps,
  splitAvcSample,
  joinAvcSample,
  rewriteFrameNum,
  sliceInfo,
  buildSkipSliceNal,
};
