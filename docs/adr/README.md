# Architecture Decision Records（ADR）

要件定義書（`docs/requirements.md`）と、機能 Issue #1〜#38 を基に決めた設計判断の一覧です。

| 番号 | タイトル | 状態 |
|---|---|---|
| [0001](0001-stack-electron-react-vite.md) | 技術スタック（Electron / React / Vite） | 承認 |
| [0002](0002-renderer-webcodecs-encoding.md) | 映像・音声の符号化はレンダラーで WebCodecs を使う | 承認 |
| [0003](0003-h264-profile-high.md) | H.264 のプロファイルは High（avc1.640028）を使う | 承認（要件書 F-022 の補足） |
| [0004](0004-intermediate-segment-log.md) | 中間ファイルは 3 分単位のレコード列にする | 承認 |
| [0005](0005-mp4-mux-at-stop.md) | 停止時に mp4 を多重化する（メインプロセス、再符号化なし） | 承認 |
| [0006](0006-skip-frame-synthesized-slice.md) | スキップフレームは H.264 の P スライスを合成して表す | 承認 |
| [0007](0007-media-clock-excludes-pause.md) | 時刻は一時停止を除いた録画時間（メディアクロック）で管理する | 承認 |
| [0008](0008-capture-permissions-and-platform-limits.md) | 画面・音声の取得と権限、プラットフォーム上の制約 | 承認 |
| [0009](0009-ipc-surface-and-security.md) | IPC の公開範囲とセキュリティ設定 | 承認 |
| [0010](0010-disk-monitoring-and-cleanup.md) | 空き容量の監視と起動時の掃除 | 承認 |
