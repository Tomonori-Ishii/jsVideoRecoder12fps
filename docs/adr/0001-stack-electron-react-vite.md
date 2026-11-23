# ADR-0001: 技術スタック（Electron / React / Vite）

- 状態: 承認
- 関連: 要件定義書 2.1、7.3。Issue #1〜#38 全般

## 背景
要件でデスクトップアプリ（Electron）、UI は React、ビルドは Vite と指定されている。画面取得と映像・音声の符号化はブラウザ API（getDisplayMedia、WebCodecs、Web Audio）を使う必要がある。

## 決定
- Electron 45.4.1、React 19.3.1（react-dom 同版）、Vite 8.3.8（@vitejs/plugin-react 6.3.0）。
- メインプロセスは CommonJS（`electron/main.cjs`）。レンダラーは ES モジュールで Vite がビルドし、`dist/index.html` を読み込む。
- テストは Vitest 5.1.1（単体）、playwright-core 1.65.1（Electron の E2E）、pytest（静的検査）。
- 実行環境: Node.js 22.12 以上を前提とする（要件 7.3）。検証はこのマシンの Node.js 20.19.2 でも行えたが、`engines` は `>=22.12` とする。

## 理由
- 要件で指定された組み合わせであり、変更すると要件の再確認が必要になる。
- Electron の Chromium が WebCodecs、getDisplayMedia、Web Audio を提供する。

## 結果
- 配布物（インストーラー）は作らない（要件 2.2）。
- Electron のバイナリはビルド時に取得する（ネットワークが必要）。実行はオフラインで動作する（要件 7.6）。
