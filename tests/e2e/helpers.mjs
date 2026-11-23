// E2E の共通処理: Electron を起動し、一時的な HOME（保存先 Downloads・userData を隔離）で動かす。
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');

export function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-e2e-'));
  fs.mkdirSync(path.join(home, 'Downloads'), { recursive: true });
  return home;
}

export async function launch({ home, fake = true, extraArgs = [], env = {} }) {
  const args = [
    path.join(ROOT, 'electron', 'main.cjs'),
    '--ozone-platform=x11',
    `--user-data-dir=${path.join(home, 'userData')}`,
    ...(fake ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : []),
    ...extraArgs,
  ];
  const app = await electron.launch({
    executablePath: ELECTRON,
    args,
    cwd: ROOT,
    env: { ...process.env, HOME: home, XDG_DOWNLOAD_DIR: path.join(home, 'Downloads'), ...env },
    timeout: 60000,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  return { app, win };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ボタンを押す。Playwright の安定性待ちは、ウィンドウが前面にないとアニメーションフレームが来ず止まるため、DOM の click を直接呼ぶ。
export async function clickButton(win, name) {
  await win.locator(`button[aria-label="${name}"]`).evaluate((el) => {
    if (el.disabled) throw new Error(`ボタンが無効です: ${el.getAttribute('aria-label')}`);
    el.click();
  });
}
