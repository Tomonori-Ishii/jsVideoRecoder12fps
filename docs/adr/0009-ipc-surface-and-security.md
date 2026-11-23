# ADR-0009: IPC の公開範囲とセキュリティ設定

- 状態: 承認
- 関連: 要件 7.2、Issue #1〜#38 の基盤

## 決定
- `BrowserWindow` の `webPreferences`: `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- preload（`electron/preload.cjs`）が `contextBridge` で公開する API は次の 7 関数だけ（要件 7.2 の表どおり。開始・停止の呼び出し、送信 2 種、購読 3 種）。
  1. `startRecording(options)`（レンダラー → メイン、呼び出し）
  2. `stopRecording(options)`（レンダラー → メイン、呼び出し）
  3. `sendChunk(kind, data, meta)`（符号化データの送信）
  4. `sendSkip(tUs)`（スキップ指示の送信）
  5. `onSaved(callback)`（メイン → レンダラー）
  6. `onProgress(callback)`（メイン → レンダラー）
  7. `onNotice(callback)`（メイン → レンダラー）
- ファイル読み書き、任意の IPC、任意の `ipcRenderer` は公開しない。
- 権限: `media` と `display-capture` だけ許可し、それ以外は拒否する。
- 外部 URL は読み込まない。`dist/index.html` だけを `file://` で読み込む。`will-navigate` と `setWindowOpenHandler` で外部遷移を拒否する。
- 静的検査（pytest、`tests/static/test_static.py`）で、この 7 つ以外の公開、チャンネル名が `rec:` のみであること、権限の範囲、窓の寸法、`loadURL` を使わないことを確認する。
- 窓の最大化は Linux の窓マネージャーが止めないことがあるため、最大化されたら戻す（E2E で 292×80 のままを確認）。
