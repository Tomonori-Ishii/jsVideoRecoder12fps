# ADR-0008: 画面・音声の取得と権限、プラットフォーム上の制約

- 状態: 承認（Linux での実測に基づく。Windows は未検証）
- 関連: 要件 F-019、F-020、F-023、F-025、F-026、F-031、F-007、F-008、F-013

## 決定
- 画面: `getDisplayMedia` を使う。メインプロセスの `setDisplayMediaRequestHandler` で、プライマリ画面の ID（`screen:<番号>:0`）を固定で返す。選択画面は出さない（F-026）。
- マイク: `getUserMedia({ audio: { deviceId } })`。起動時に一度許可を求め、ラベルを出せるようにする（F-008）。
- スピーカー（システム音）: `setDisplayMediaRequestHandler` の `audio: 'loopback'`。
- 権限: `setPermissionRequestHandler` と `setPermissionCheckHandler` で `media` と `display-capture` だけを許可する（ADR-0009）。
- カーソル: 取得の制約（`cursor: 'never'`）を指定し、映像にカーソルを含めない（F-023）。
- 録画ウィンドウ: `win.setContentProtection(true)` で、対応する OS では映像から除外する（F-025）。

## 実測（このマシン、Linux X11、Electron 45.4.1）
- `getUserMedia` のマイク、`getDisplayMedia` の映像と音声（フェイク）は取得できた。
- 実機のスピーカーのループバック（`audio: 'loopback'`）は、Linux で動くかどうか未確認（Issue #20 で確認）。Electron の仕様上、Windows と macOS が主な対象である。
- 静止画面の検証は、`getDisplayMedia` を同じ内容を描く canvas の `captureStream` に差し替えて行った（E2E の `useStaticScreen`）。実画面の静止は Linux の実機で確認していない。
- 最大化は Linux で止まらないことがあったため、`maximize` イベントで戻す対応を入れた（E2E F-014 で確認）。

## プラットフォーム上の制約
- Linux でループバックが動かない場合、システム音（F-020 のスピーカー側）は記録できない。その場合は機能一覧で「保留（Linux では未対応）」とする。
- Linux で `setContentProtection` が映像からの除外を保証しない場合は、F-025 を「保留（Windows で検証）」とする。

## テストでの扱い
- E2E はフェイクデバイス（`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`）で行う（要件 8.3）。
