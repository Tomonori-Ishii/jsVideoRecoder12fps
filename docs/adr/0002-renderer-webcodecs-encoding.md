# ADR-0002: 映像・音声の符号化はレンダラーで WebCodecs を使う

- 状態: 承認
- 関連: 要件 F-021、F-022、F-020、F-034、F-028、2.1

## 背景
要件は「映像は録画中に H.264 で符号化し、停止時に再符号化しない」「ハードウェア符号化を優先し、なければ CPU で符号化する」と定める。

## 調査結果（このマシンの Electron 45.4.1 での `isConfigSupported`）
| コーデック文字列 | 結果 |
|---|---|
| `avc1.42001f`（Baseline） | 非対応 |
| `avc1.42E01E`（Constrained Baseline） | 非対応 |
| `avc1.4D401F`（Main） | 非対応 |
| `avc1.640028`（High, Level 4.0） | 対応（`no-preference` と `prefer-software` の両方） |
| `vp8` / `vp09` / `av01` | 対応 |
| Opus（AudioEncoder） | 対応 |

## 決定
- 映像: `VideoEncoder`、コーデック `avc1.640028`、`avc: { format: 'avc' }`、1920×1080、12fps、約 1Mbps（可変）、`hardwareAcceleration: 'prefer-hardware'`。対応しない場合は `'no-preference'` にフォールバックする（ソフトウェア符号化を含む）。
- 音声: `AudioEncoder`、Opus、48kHz、モノラル、128kbps。
- 符号化は録画中に行い、出力（`EncodedVideoChunk` / `EncodedAudioChunk` とデコーダー設定）をメインプロセスへ送る（ADR-0004）。
- 使った方式（HW か SW）は WebCodecs から取れない。`prefer-hardware` の要求を受理したかどうかを記録する（`hwRequested` / `accepted` / `fellBack`）。このマシンでは `prefer-hardware` が受理されず、`no-preference`（CPU 側）になった（`fellBack: true`）。

## 結果
- 要件 F-034 の「使った方式を記録する」は、WebCodecs から実際の実装が取れないため、「要求した方式」と「フォールバックが起きたか」を記録する形で満たす。この差は [feature-list](../feature-list.md) に記す。
- 録画中の CPU 使用率（要件 7.4）は E2E で計測した。このマシン（6 コア）の Electron 全体の平均は 35.6%（1 コア換算）で、機全体（6 コア）では約 5.9%。

関連: ADR-0003
