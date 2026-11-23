# jsVideoRecoder12fps

JavaScript Video Recoderの実装。チケット起点によるAI開発の試行

画面と音声を mp4（H.264 + Opus、12fps）に記録する、小型のデスクトップアプリ（Electron）です。
仕様は `docs/requirements.md`、設計判断は `docs/adr/README.md`、進捗は `docs/feature-list.md` にあります。

## 必要なもの

- Node.js 22.12 以上（`package.json` の `engines`）
- ffmpeg / ffprobe（テストで使う。E2E と単体テストの一部）
- Python 3 と pytest（静的検査）

## 準備

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install pytest   # 静的検査用（任意の方法で pytest を入れてもよい）
```

## 実行

```bash
npm run dev        # ビルドしてから Electron を起動する
```

録画は「開始」「一時停止」「再開」「停止」で行います。保存先は Downloads フォルダです。

## テスト

```bash
npm run test:unit      # Vitest（単体テスト。ffmpeg を使う多重化の検証を含む）
npm run test:static    # pytest（静的検査）
npm run test:e2e       # Electron の E2E（フェイクのマイクと画面で実際に録画する）
```

E2E の結果は `tests/e2e/last-run.json` に書き出されます。
