import { describe, it, expect } from 'vitest';
import { BitReader, escapeRbsp, unescapeNal } from '../../electron/recording/bits.cjs';
import {
  buildSkipSliceNal,
  parseAvcC,
  parsePps,
  parseSps,
  rewriteFrameNum,
  sliceInfo,
  splitAvcSample,
  joinAvcSample,
} from '../../electron/recording/h264.cjs';

// High プロファイル、レベル 4.0、POC type 2、frame_num 8 bit（log2_max_frame_num_minus4 = 4）の最小 SPS を組み立てる
function makeSps({ widthMbs = 120, heightMbs = 68 } = {}) {
  const { BitWriter } = require('../../electron/recording/bits.cjs');
  const w = new BitWriter();
  w.u(1, 0); // forbidden（NAL ヘッダーは下で付ける。ここは RBSP）
  return { w, widthMbs, heightMbs };
}

function buildSpsNal({ log2MaxFrameNumMinus4 = 4, pocType = 2, widthMbs = 120, heightMbs = 68 } = {}) {
  const { BitWriter } = require('../../electron/recording/bits.cjs');
  const w = new BitWriter();
  w.u(8, 100); // profile_idc = High
  w.u(8, 0); // constraint flags
  w.u(8, 40); // level 4.0
  w.ue(0); // seq_parameter_set_id
  w.ue(1); // chroma_format_idc = 1
  w.ue(0); // bit_depth_luma_minus8
  w.ue(0); // bit_depth_chroma_minus8
  w.u(1, 0); // qpprime_y_zero_transform_bypass_flag
  w.u(1, 0); // seq_scaling_matrix_present_flag
  w.ue(log2MaxFrameNumMinus4);
  w.ue(pocType);
  if (pocType === 0) w.ue(4);
  w.ue(1); // max_num_ref_frames
  w.u(1, 0); // gaps
  w.ue(widthMbs - 1);
  w.ue(heightMbs - 1);
  w.u(1, 1); // frame_mbs_only_flag
  w.u(1, 1); // direct_8x8_inference_flag
  w.u(1, 0); // frame_cropping_flag
  w.u(1, 0); // vui_parameters_present_flag
  w.trailing();
  const rbsp = w.toBytes();
  return new Uint8Array([0x67, ...escapeRbsp(rbsp)]);
}

function buildPpsNal({ cabac = 0, deblocking = 1 } = {}) {
  const { BitWriter } = require('../../electron/recording/bits.cjs');
  const w = new BitWriter();
  w.ue(0); // pic_parameter_set_id
  w.ue(0); // seq_parameter_set_id
  w.u(1, cabac);
  w.u(1, 0); // bottom_field_pic_order_in_frame_present_flag
  w.ue(0); // num_slice_groups_minus1
  w.ue(0); // num_ref_idx_l0_default_active_minus1
  w.ue(0); // num_ref_idx_l1_default_active_minus1
  w.u(1, 0); // weighted_pred_flag
  w.u(2, 0); // weighted_bipred_idc
  w.se(0); // pic_init_qp_minus26
  w.se(0); // pic_init_qs_minus26
  w.se(0); // chroma_qp_index_offset
  w.u(1, deblocking); // deblocking_filter_control_present_flag
  w.u(1, 0); // constrained_intra_pred_flag
  w.u(1, 0); // redundant_pic_cnt_present_flag
  w.trailing();
  return new Uint8Array([0x68, ...escapeRbsp(w.toBytes())]);
}

describe('SPS / PPS の解析', () => {
  it('SPS から frame_num の桁数、POC の種類、マクロブロック数を読む', () => {
    const sps = parseSps(buildSpsNal({ log2MaxFrameNumMinus4: 4, pocType: 2, widthMbs: 120, heightMbs: 68 }));
    expect(sps.log2MaxFrameNum).toBe(8);
    expect(sps.pocType).toBe(2);
    expect(sps.picSizeInMbs).toBe(120 * 68);
  });

  it('PPS から CAVLC / CABAC の区別を読む', () => {
    expect(parsePps(buildPpsNal({ cabac: 0 })).cabac).toBe(false);
    expect(parsePps(buildPpsNal({ cabac: 1 })).cabac).toBe(true);
  });

  it('POC の種類が 0 または 2 以外は対応外として例外にする', () => {
    expect(() => parseSps(buildSpsNal({ pocType: 1 }))).toThrow();
  });
});

describe('スキップフレームの合成（ADR-0006）', () => {
  const sps = parseSps(buildSpsNal({ widthMbs: 120, heightMbs: 68 }));
  const pps = parsePps(buildPpsNal({ cabac: 0, deblocking: 1 }));

  it('参照ピクチャーの P スライスとして合成し、frame_num と全マクロブロック数を書く', () => {
    const nal = buildSkipSliceNal({ sps, pps, frameNum: 37 });
    expect(nal[0]).toBe(0x21); // nal_ref_idc = 1、非 IDR スライス
    expect(sliceInfo(nal)).toEqual({ isIdr: false, isRef: true });
    // ヘッダーを読み直す
    const r = new BitReader(unescapeNal(nal.subarray(1)));
    expect(r.ue()).toBe(0); // first_mb_in_slice
    expect(r.ue()).toBe(5); // slice_type = P
    expect(r.ue()).toBe(0); // pic_parameter_set_id
    expect(r.u(sps.log2MaxFrameNum)).toBe(37);
    expect(r.u(1)).toBe(0); // num_ref_idx_active_override_flag
    expect(r.u(1)).toBe(0); // ref_pic_list_modification_flag_l0
    expect(r.u(1)).toBe(0); // adaptive_ref_pic_marking_mode_flag
    expect(r.se()).toBe(0); // slice_qp_delta
    expect(r.ue()).toBe(0); // disable_deblocking_filter_idc
    expect(r.se()).toBe(0);
    expect(r.se()).toBe(0);
    expect(r.ue()).toBe(sps.picSizeInMbs); // mb_skip_run = 全マクロブロック
  });

  it('CABAC の PPS では合成しない（ADR-0003 のフォールバック対象）', () => {
    const cabacPps = parsePps(buildPpsNal({ cabac: 1 }));
    expect(() => buildSkipSliceNal({ sps, pps: cabacPps, frameNum: 1 })).toThrow(/CABAC/);
  });

  it('既存のスライスの frame_num を書き換えられる（長さは変わらない）', () => {
    const slice = buildSkipSliceNal({ sps, pps, frameNum: 5 });
    const rewritten = rewriteFrameNum(slice, sps, 200);
    const r = new BitReader(unescapeNal(rewritten.subarray(1)));
    r.ue();
    r.ue();
    r.ue();
    expect(r.u(sps.log2MaxFrameNum)).toBe(200);
    expect(rewritten.length).toBe(slice.length);
  });

  it('AVC 形式のサンプルを NAL に分け、また結合できる', () => {
    const a = new Uint8Array([0x65, 1, 2, 3]);
    const b = new Uint8Array([0x41, 9]);
    const joined = joinAvcSample([a, b], 4);
    const split = splitAvcSample(joined, 4);
    expect(split.map((n) => Array.from(n))).toEqual([Array.from(a), Array.from(b)]);
  });

  it('avcC から SPS と PPS を取り出せる', () => {
    const spsNal = buildSpsNal();
    const ppsNal = buildPpsNal();
    const avcC = new Uint8Array([1, spsNal[1], spsNal[2], spsNal[3], 0xff, 0xe1, spsNal.length >> 8, spsNal.length & 255, ...spsNal, 1, ppsNal.length >> 8, ppsNal.length & 255, ...ppsNal]);
    const parsed = parseAvcC(avcC);
    expect(parsed.lengthSize).toBe(4);
    expect(Array.from(parsed.sps)).toEqual(Array.from(spsNal));
    expect(Array.from(parsed.pps)).toEqual(Array.from(ppsNal));
  });
});
