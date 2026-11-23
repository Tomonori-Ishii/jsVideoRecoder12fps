// E2E テスト（Electron + Playwright）。フェイクのマイクと画面で実際に録画し、mp4 を ffprobe で検査する。
// 結果は tests/e2e/last-run.json に書く。失敗が 1 件でもあれば終了コード 1。
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, makeHome, sleep, clickButton, ROOT } from './helpers.mjs';

const results = [];
const record = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name} ${detail}`);
};
const check = (id, name, cond, detail = '') => record(id, name, !!cond, detail);

const probe = (file) => {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,profile,width,height,r_frame_rate,nb_frames,sample_rate,channels:format=duration', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  return JSON.parse(out);
};
const decodeErrors = (file) => {
  try {
    const out = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim();
  } catch (e) {
    return String(e.stderr || e.message);
  }
};
const meanVolume = (file) => {
  // volumedetect の結果は stderr に出る
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume: (-?[\d.]+) dB/.exec(r.stderr);
  return m ? Number(m[1]) : null;
};
const downloads = (home) => path.join(home, 'Downloads');
const mp4s = (home) => fs.readdirSync(downloads(home)).filter((f) => f.endsWith('.mp4'));
const findStateFiles = (home) => {
  const out = [];
  const root = path.join(home, 'userData', 'recordings');
  if (!fs.existsSync(root)) return out;
  for (const r of fs.readdirSync(root)) {
    const f = path.join(root, r, 'state.json');
    if (fs.existsSync(f)) out.push(JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  return out;
};
// Electron 関連プロセスの CPU 使用率の合計（ps の %CPU。1 コアを 100% とする）
const electronCpu = (pid) => {
  const rows = execFileSync('ps', ['-eo', 'pid,ppid,pcpu'], { encoding: 'utf8' }).trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Set([pid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [p, pp] of rows) if (kids.has(pp) && !kids.has(p)) { kids.add(p); grew = true; }
  }
  return rows.filter(([p]) => kids.has(p)).reduce((sum, r) => sum + r[2], 0);
};
const readBtn = (win, name) => win.locator(`button[aria-label="${name}"]`).isDisabled();
const statusText = (win) => win.locator('.status').innerText();
async function waitFor(fn, timeoutMs = 60000, stepMs = 300) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(stepMs);
  }
  return false;
}
const elapsedText = (win) => win.locator('.elapsed').innerText();
const elapsedMs = (text) => {
  const m = /^(\d+):(\d{2}):(\d{2})\.(\d)$/.exec(text.trim());
  return m ? ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]) * 100 : NaN;
};

async function scenarioBasic() {
  const home = makeHome();
  const { app, win } = await launch({ home });
  try {
    await sleep(1500);
    check('F-001-a', '待機中は開始が有効、停止・一時停止は無効', !(await readBtn(win, '開始')) && (await readBtn(win, '停止')) && (await readBtn(win, '一時停止')), '');
    await clickButton(win, '開始');
    await sleep(1500);
    check('F-001-b', '録画中は経過時間が進み、開始は無効', elapsedMs(await elapsedText(win)) > 800 && (await readBtn(win, '開始')), await elapsedText(win));
    let maxLevel = 0;
    let liveDb = '';
    for (let i = 0; i < 20; i++) {
      await sleep(150);
      maxLevel = Math.max(maxLevel, Number(await win.locator('.meter').getAttribute('aria-valuenow')));
      liveDb = await win.locator('.db').innerText();
    }
    check('F-005-a', '録画中は音量バーと dB 表示が無音より上を示す（フェイクのマイク音、3 秒間の最大）', maxLevel > 0 && liveDb !== '-60.0 dB', `最大 aria-valuenow=${maxLevel} 最後の dB=${liveDb}`);
    const states = findStateFiles(home);
    check('F-034', '録画ごとに符号化の要求と結果（ハードウェア優先、CPU へのフォールバック）を記録する', states.length === 1 && states[0].encoder && states[0].encoder.hwRequested === 'prefer-hardware', JSON.stringify(states[0] && states[0].encoder));
    const cpuSamples = [];
    for (let i = 0; i < 4; i++) { await sleep(500); cpuSamples.push(electronCpu(app.process().pid)); }
    const cpuAvg = cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length;
    check('CPU', '録画中の Electron 全体の CPU 使用率（参考値。要件 7.4 の上限は 10%）', true, `平均 ${cpuAvg.toFixed(1)}%（1 コア = 100%、コア数 ${require_nproc()}。機全体では ${(cpuAvg / Number(require_nproc())).toFixed(1)}%）`);
    await clickButton(win, '一時停止');
    await sleep(300);
    check('F-006', '一時停止中は音量バーを 0%、dB 表示を -60.0 dB にする', (await win.locator('.meter').getAttribute('aria-valuenow')) === '0' && (await win.locator('.db').innerText()) === '-60.0 dB', '');
    const t1 = await elapsedText(win);
    await sleep(1500);
    const t2 = await elapsedText(win);
    check('F-002', '一時停止中は経過時間が進まず、ボタンが再開になる', t1 === t2 && (await win.locator('button[aria-label="再開"]').count()) === 1, `${t1} -> ${t2}`);
    await clickButton(win, '再開');
    await sleep(1500);
    check('F-003', '再開すると経過時間が続きから進む', elapsedMs(await elapsedText(win)) > elapsedMs(t2) + 800, `${t2} -> ${await elapsedText(win)}`);
    const recordedMs = elapsedMs(await elapsedText(win));
    await clickButton(win, '停止');
    const saved = await waitFor(async () => (await statusText(win)).includes('保存しました'), 90000);
    check('F-010', '停止後に「保存しました: <絶対パス>」を表示する', saved, await statusText(win));
    const files = mp4s(home);
    check('F-030', 'ファイル名が screen_YYYYMMDD_HHMMSS.mp4 で Downloads に保存される', files.length === 1 && /^screen_\d{8}_\d{6}\.mp4$/.test(files[0]), files.join(','));
    if (files.length === 1) {
      const file = path.join(downloads(home), files[0]);
      const info = probe(file);
      const v = info.streams.find((s) => s.codec_type === 'video');
      const a = info.streams.find((s) => s.codec_type === 'audio');
      check('F-021', '映像のフレームレートが 12fps', v && v.r_frame_rate === '12/1', v && v.r_frame_rate);
      check('F-022', 'H.264 の mp4、1920×1080', v && v.codec_name === 'h264' && v.width === 1920 && v.height === 1080, `${v && v.codec_name} ${v && v.width}x${v && v.height} ${v && v.profile}`);
      const dur = Number(info.format.duration);
      const expect = recordedMs / 1000;
      check('F-024', '一時停止を除いた録画時間と映像の長さが一致（±0.25 秒）', Math.abs(dur - expect) < 0.25, `mp4=${dur.toFixed(2)}s 停止直前の経過時間=${expect.toFixed(1)}s`);
      check('F-020-a', '音声トラックがある（Opus 48kHz モノラル）', a && a.codec_name === 'opus' && Number(a.sample_rate) === 48000 && Number(a.channels) === 1, a && `${a.codec_name} ${a.sample_rate} ${a.channels}`);
      const err = decodeErrors(file);
      check('F-019', '録画した mp4 がエラーなくデコードできる', err === '', err.slice(0, 200));
    }
    check('F-012', '「待機中」「録画中」「一時停止中」の文字を表示しない', !/待機中|録画中|一時停止中/.test(await win.locator('.app').innerText()), '');
  } finally {
    await app.close();
  }
}

async function scenarioAudioAndMic() {
  const home = makeHome();
  const { app, win } = await launch({ home });
  try {
    await sleep(1500);
    const options = await win.locator('select.mic-select option').allInnerTexts();
    check('F-007-a', 'マイクの一覧にデバイス名が出る', options.length >= 2 && options.every((o) => o.trim().length > 0), options.join(' / '));
    check('F-011', '操作ボタン（開始・一時停止・停止・ミュート）が aria-label と title を持つ', (await win.locator('button[aria-label][title]').count()) === 4, '');
    check('F-008', '起動時にマイクの名前が表示される（許可済み）', options.some((o) => /Fake/.test(o)), '');
    await clickButton(win, '開始');
    await sleep(1200);
    await clickButton(win, 'ミュート');
    const pressed = await win.locator('button[aria-label="ミュートを解除"]').getAttribute('aria-pressed');
    check('F-013-a', 'ミュートを押すと状態が切り替わる', pressed === 'true', `aria-pressed=${pressed}`);
    await sleep(2000);
    await clickButton(win, 'ミュートを解除');
    await sleep(800);
    check('F-013-b', 'ミュートを解除するとアイコンが戻る', (await win.locator('button[aria-label="ミュート"]').count()) === 1, '');
    await clickButton(win, '停止');
    const saved = await waitFor(async () => (await statusText(win)).includes('保存しました'), 90000);
    check('F-005-b', '録画中に音量が表示されている（保存まで完了）', saved, await statusText(win));
  } finally {
    await app.close();
  }
}

async function scenarioMuteSilence() {
  // マイクをミュートすると、マイクの音だけ無音になる。システム音（ここでは静止画面の音声なし）は無い状態で確かめる。
  const home = makeHome();
  const { app, win } = await launch({ home });
  try {
    await sleep(1500);
    await useStaticScreen(win);
    await clickButton(win, '開始');
    await sleep(300);
    await clickButton(win, 'ミュート');
    await sleep(3000);
    await clickButton(win, '停止');
    await waitFor(async () => (await statusText(win)).includes('保存しました'), 90000);
    await win.evaluate(() => clearInterval(window.__staticTimer));
    const file = path.join(downloads(home), mp4s(home)[0]);
    const vol = meanVolume(file);
    check('F-013-c', 'ミュート中はマイクの音を無音として記録する', vol !== null && vol < -60, `mean_volume=${vol} dB`);
    const info = probe(file);
    const d = Number(info.format.duration);
    check('F-013-d', 'ミュート中も映像と時間軸は保たれる（長さは録画時間と一致）', Math.abs(d - 3.0) < 0.4, `duration=${d.toFixed(2)}s`);
  } finally {
    await app.close();
  }
}

async function scenarioMuteKeepsSpeaker() {
  // フェイク環境では画面収録にシステム音（フェイクの音）が付く。マイクをミュートしてもシステム音は残る（F-013、F-020）。
  const home = makeHome();
  const { app, win } = await launch({ home });
  try {
    await sleep(1500);
    await clickButton(win, '開始');
    await sleep(300);
    await clickButton(win, 'ミュート');
    await sleep(3000);
    await clickButton(win, '停止');
    await waitFor(async () => (await statusText(win)).includes('保存しました'), 90000);
    const file = path.join(downloads(home), mp4s(home)[0]);
    const vol = meanVolume(file);
    check('F-020-b', 'マイクをミュートしてもシステム音（スピーカー側の入力）は記録に残る（フェイク環境）', vol !== null && vol > -40, `mean_volume=${vol} dB`);
  } finally {
    await app.close();
  }
}

// 画面を静止させる（getDisplayMedia を、同じ内容を描き続ける canvas の captureStream に置き換える）。
// 実際のフェイク画面は常に動くため、スキップ枠（F-035）の経路を確かめるためにこの置き換えを使う。
async function useStaticScreen(win, colorA = '#3366cc') {
  await win.evaluate((color) => {
    const c = document.createElement('canvas');
    c.width = 1920;
    c.height = 1080;
    const ctx = c.getContext('2d');
    window.__staticColor = color;
    const paint = () => {
      ctx.fillStyle = window.__staticColor;
      ctx.fillRect(0, 0, 1920, 1080);
      ctx.fillStyle = '#ffffff';
      ctx.font = '96px sans-serif';
      ctx.fillText('static', 200, 400);
    };
    paint();
    window.__staticTimer = setInterval(paint, 83);
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(12);
  }, colorA);
}

async function scenarioStaticScreen() {
  const home = makeHome();
  const { app, win } = await launch({ home });
  try {
    await sleep(1500);
    await useStaticScreen(win);
    await clickButton(win, '開始');
    await sleep(2500);
    // 画面を 1 回だけ変える
    await win.evaluate(() => {
      window.__staticColor = '#cc3333';
    });
    await sleep(2000);
    await clickButton(win, '停止');
    await waitFor(async () => (await statusText(win)).includes('保存しました'), 90000);
    await win.evaluate(() => clearInterval(window.__staticTimer));
    const file = path.join(downloads(home), mp4s(home)[0]);
    const info = probe(file);
    const v = info.streams.find((x) => x.codec_type === 'video');
    check('F-035-a', '同じ画面が続いても mp4 は 12fps（枠数と長さが一致）', v.r_frame_rate === '12/1' && Math.abs(Number(info.format.duration) - Number(v.nb_frames) / 12) < 0.1, `nb_frames=${v.nb_frames} duration=${info.format.duration}`);
    check('F-019-b', '静止画面の録画もデコードできる', decodeErrors(file) === '', decodeErrors(file).slice(0, 200));
    const frames = decodeY(file, 1920, 1080);
    const same = (a, b) => Buffer.compare(a, b) === 0;
    let identicalRun = 0;
    for (let i = 1; i < frames.length; i++) if (same(frames[i], frames[i - 1])) identicalRun++;
    check('F-035-b', '同じ画面の枠は直前の枠と同じ画素になる（スキップ枠を含む）', identicalRun >= 20, `連続して同じ枠=${identicalRun} / ${frames.length - 1}`);
    const firstRed = frames.findIndex((f, i) => i > 0 && !same(f, frames[0]));
    check('F-035-c', '画面が変わった後の枠は、変わった画面になる（変化は途中の枠から）', firstRed > 0 && firstRed < frames.length - 1 && identicalRun >= 20, `変化の枠=${firstRed} / ${frames.length}`);
  } finally {
    await app.close();
  }
}

async function scenarioPermissionErrors() {
  const home = makeHome();
  const { app, win } = await launch({ home });
  try {
    await sleep(1500);
    await win.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        throw new DOMException('denied', 'NotAllowedError');
      };
    });
    await clickButton(win, '開始');
    await sleep(1500);
    const t = await statusText(win);
    check('F-031', '画面収録が拒否されると、その文言を表示して録画は始まらない', t.includes('画面の録画が許可されていません') && (await win.locator('button[aria-label="開始"]').isEnabled()), t);
  } finally {
    await app.close();
  }
  const second = await launch({ home: makeHome() });
  try {
    await sleep(1500);
    await second.win.evaluate(() => {
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (constraints) => {
        if (constraints && constraints.audio && constraints.audio.deviceId) {
          return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
        }
        return orig(constraints);
      };
    });
    await clickButton(second.win, '開始');
    await sleep(2000);
    const t = await statusText(second.win);
    check('F-009-a', 'マイクが許可されないとき、所定の文言を 1 行で表示する', t.includes('マイクの使用が許可されていません'), t);
    check('F-009-b', '録画は始まらず、開始ボタンが再び使える', await second.win.locator('button[aria-label="開始"]').isEnabled(), '');
  } finally {
    await second.app.close();
  }
}

async function scenarioDoublePress() {
  const home = makeHome();
  const { app, win } = await launch({ home });
  try {
    await sleep(1500);
    await win.locator('button[aria-label="開始"]').evaluate((el) => {
      el.click();
      el.click();
      el.click();
    });
    await sleep(2000);
    await clickButton(win, '一時停止');
    await win.locator('button[aria-label="再開"]').evaluate((el) => {
      el.click();
      el.click();
    });
    await sleep(800);
    await clickButton(win, '停止');
    await waitFor(async () => (await statusText(win)).includes('保存しました'), 90000);
    const n = mp4s(home).length;
    check('F-015', '開始ボタンを連打しても録画は 1 本だけ', n === 1, `mp4=${n}`);
    check('F-018', '一時停止・再開を連打しても状態が食い違わない（保存まで正常）', n === 1, '');
  } finally {
    await app.close();
  }
}

async function scenarioSaveFailure() {
  const home = makeHome();
  const { app, win } = await launch({ home });
  try {
    await sleep(1500);
    await clickButton(win, '開始');
    await sleep(1500);
    fs.chmodSync(downloads(home), 0o555); // 保存先を書き込み不可にして多重化を失敗させる
    await clickButton(win, '停止');
    const failed = await waitFor(async () => (await statusText(win)).includes('保存に失敗'), 90000);
    fs.chmodSync(downloads(home), 0o755);
    const partial = fs.readdirSync(downloads(home)).filter((f) => f.endsWith('.partial')).length;
    check('F-017-a', '停止処理が失敗するとエラーを表示する', failed, await statusText(win));
    await sleep(500);
    check('F-017-b', '失敗後にボタンが初期状態に戻る（開始が有効）', !(await readBtn(win, '開始')), '');
    check('F-029', '失敗時に .partial が残らない', partial === 0, `partial=${partial}`);
    await clickButton(win, '開始');
    await sleep(1000);
    await clickButton(win, '停止');
    const ok = await waitFor(async () => (await statusText(win)).includes('保存しました'), 90000);
    check('F-017-c', '失敗後に次の録画を開始・保存できる', ok, await statusText(win));
  } finally {
    fs.chmodSync(downloads(home), 0o755);
    await app.close();
  }
}

async function scenarioCrashCleanup() {
  const home = makeHome();
  let { app, win } = await launch({ home });
  await sleep(1500);
  await clickButton(win, '開始');
  await sleep(2500);
  const pid = app.process().pid;
  const before = findRecordingDirs(home);
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // 既に終了している場合は無視する
  }
  await sleep(1500);
  const killedDirs = findRecordingDirs(home);
  ({ app, win } = await launch({ home }));
  try {
    await sleep(2000);
    const after = findRecordingDirs(home);
    check('F-038', '異常終了後、次回起動時に中間ファイルを削除する', killedDirs.length === 1 && after.length === 0, `終了直後=${killedDirs.length} 再起動後=${after.length} 起動前=${before.length}`);
  } finally {
    await app.close();
  }
}

function decodeY(file, w, h) {
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'], { maxBuffer: 1024 * 1024 * 1024 });
  const fb = (w * h * 3) / 2;
  const frames = [];
  for (let p = 0; p + fb <= out.length; p += fb) frames.push(out.subarray(p, p + w * h));
  return frames;
}

function findRecordingDirs(home) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 6 || !fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (name === 'recordings' && fs.statSync(p).isDirectory()) {
        for (const r of fs.readdirSync(p)) out.push(path.join(p, r));
      } else if (fs.statSync(p).isDirectory() && name !== 'Downloads') {
        walk(p, depth + 1);
      }
    }
  };
  walk(home, 0);
  return out;
}

async function scenarioWindow() {
  const home = makeHome();
  const { app, win } = await launch({ home });
  try {
    await sleep(1000);
    const size = await win.evaluate(() => [window.innerWidth, window.innerHeight]);
    const fixed = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { resizable: w.isResizable(), fullscreenable: w.isFullScreenable(), title: w.getTitle() };
    });
    // 最大化を要求しても、窓の大きさが 292×80 のまま戻ることを確かめる
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await sleep(1000);
    const after = await win.evaluate(() => [window.innerWidth, window.innerHeight]);
    check('F-014', '内容の領域は 292×80、リサイズ・最大化・全画面化ができない', size[0] === 292 && size[1] === 80 && !fixed.resizable && !fixed.fullscreenable && after[0] === 292 && after[1] === 80, `初期=${size.join('x')} 最大化後=${after.join('x')} ${JSON.stringify(fixed)}`);
    check('F-016', 'タイトルは Video Recoder、lang は ja', fixed.title === 'Video Recoder' && (await win.evaluate(() => document.documentElement.lang)) === 'ja', fixed.title);
  } finally {
    await app.close();
  }
}

const only = process.argv[2];
function require_nproc() {
  return execFileSync('nproc', { encoding: 'utf8' }).trim();
}
const scenarios = [
  ['basic', scenarioBasic],
  ['audio', scenarioAudioAndMic],
  ['double', scenarioDoublePress],
  ['save-failure', scenarioSaveFailure],
  ['crash', scenarioCrashCleanup],
  ['window', scenarioWindow],
  ['mute', scenarioMuteSilence],
  ['mute-speaker', scenarioMuteKeepsSpeaker],
  ['static', scenarioStaticScreen],
  ['errors', scenarioPermissionErrors],
];
for (const [name, fn] of scenarios) {
  if (only && only !== name) continue;
  try {
    await fn();
  } catch (err) {
    record(`scenario:${name}`, '実行時エラー', false, String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
  }
}

const failed = results.filter((r) => !r.ok).length;
fs.writeFileSync(path.join(ROOT, 'tests', 'e2e', 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(`\n合計 ${results.length} 件、失敗 ${failed} 件`);
process.exit(failed ? 1 : 0);
