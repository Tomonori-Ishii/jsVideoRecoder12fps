'use strict';

// メインプロセス（要件 2.1、ADR-0001、0008、0009、0010）
// - 窓の生成（292×80、固定サイズ、録画中は映像から除外）
// - 権限（media、display-capture のみ）と対象画面（プライマリ画面）の指定
// - 中間ファイルへの書き込み、停止時の多重化、空き容量の監視、起動時の掃除

const { app, BrowserWindow, ipcMain, session, desktopCapturer, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const C = require('./recording/config.cjs');
const { RecordingSession } = require('./recording/session.cjs');
const { cleanupStale, removeRecordingDir } = require('./recording/state.cjs');
const { recordingId } = require('./recording/paths.cjs');
const { freeBytes, canStart, canContinue } = require('./recording/disk.cjs');
const { totalBytes } = require('./recording/segment-log.cjs');

app.setName('Video Recoder'); // userData は ~/.config/Video Recoder になる

const ALLOWED_PERMISSIONS = new Set(['media', 'display-capture']);

let mainWindow = null;
let active = null; // 録画中の RecordingSession
let diskTimer = null;
let lastProgressSent = 0;

function recordingsRoot() {
  return path.join(app.getPath('userData'), 'recordings');
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: C.WINDOW.width,
    height: C.WINDOW.height,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Video Recoder',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.setMaximizable(false);
  mainWindow.setFullScreenable(false);
  mainWindow.setResizable(false);
  // 録画ウィンドウを映像から除外する（F-025）。対応しない OS では効かない（ADR-0008）。
  mainWindow.setContentProtection(true);
  // Linux の窓マネージャーは最大化を止められないことがあるため、最大化されたら戻す（F-014）
  mainWindow.on('maximize', () => mainWindow.unmaximize());
  mainWindow.on('enter-full-screen', () => mainWindow.setFullScreen(false));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  // 画面は選択画面を出さず、プライマリ画面を固定で対象にする（F-026、ADR-0008）
  ses.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const primary = screen.getPrimaryDisplay();
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      });
      const source = sources.find((s) => s.display_id === String(primary.id)) || sources[0];
      if (!source) {
        callback({});
        return;
      }
      callback({ video: source, audio: 'loopback' });
    },
    { useSystemPicker: false },
  );
}

function stopDiskTimer() {
  if (diskTimer) clearInterval(diskTimer);
  diskTimer = null;
}

// 録画中の空き容量の確認（F-033）。足りなければ録画を止め、中間ファイルを残す。
function startDiskTimer(session) {
  stopDiskTimer();
  diskTimer = setInterval(async () => {
    if (!active || active !== session) return stopDiskTimer();
    try {
      const free = await freeBytes(session.dir);
      if (!canContinue(free, totalBytes(session.dir))) {
        stopDiskTimer();
        session.abortForSpace();
        send('rec:notice', {
          kind: 'space',
          path: session.dir,
          message: `空き容量が不足したため録画を止めました。中間ファイル: ${session.dir}`,
        });
      }
    } catch (err) {
      console.error('空き容量の確認に失敗:', err);
    }
  }, C.DISK_CHECK_MS);
}

function registerIpc() {
  ipcMain.handle('rec:start', async (event, payload) => {
    if (event.sender !== mainWindow.webContents) return { ok: false, message: '不正な呼び出しです' };
    if (active) return { ok: false, message: '録画中です' };
    const fps = C.normalizeFps(payload && payload.fps);
    const root = recordingsRoot();
    fs.mkdirSync(root, { recursive: true });
    const free = await freeBytes(root);
    if (!canStart(free)) {
      return {
        ok: false,
        code: 'space',
        message: '空き容量が不足しているため、録画を始められません。',
      };
    }
    const now = new Date();
    let id = recordingId(now);
    let n = 1;
    while (fs.existsSync(path.join(root, id))) id = `${recordingId(now)}_${n++}`;
    const dir = path.join(root, id);
    const next = new RecordingSession({
      id,
      dir,
      outDir: app.getPath('downloads'),
      fps,
      startedAt: now,
      onProgress: (percent) => {
        // F-036: 進み具合は約 0.5 秒ごとに通知する
        const t = Date.now();
        if (percent === 100 || t - lastProgressSent >= C.PROGRESS_MS) {
          lastProgressSent = t;
          send('rec:progress', { percent });
        }
      },
    });
    next.start();
    active = next;
    startDiskTimer(next);
    return { ok: true, id, fps, width: C.WIDTH, height: C.HEIGHT };
  });

  ipcMain.on('rec:chunk', (event, kind, data, meta) => {
    if (event.sender !== mainWindow.webContents || !active) return;
    try {
      active.writeChunk(kind, data, meta || {});
    } catch (err) {
      console.error('書き込みに失敗:', err);
      send('rec:notice', { kind: 'error', message: `書き込みに失敗しました: ${err.message}` });
    }
  });

  ipcMain.on('rec:skip', (event, tUs) => {
    if (event.sender !== mainWindow.webContents || !active) return;
    active.writeSkip(tUs);
  });

  ipcMain.handle('rec:stop', async (event, payload) => {
    if (event.sender !== mainWindow.webContents) return { status: 'failed', message: '不正な呼び出しです' };
    if (!active) return { status: 'failed', message: '録画していません' };
    const current = active;
    active = null;
    stopDiskTimer();
    if (payload && payload.reason === 'cancel') {
      current.finished = true;
      if (current.writer) current.writer.close();
      removeRecordingDir(current.dir);
      return { status: 'cancelled' };
    }
    const durationMs = Number(payload && payload.durationMs) || 0;
    lastProgressSent = 0;
    const result = await current.stop({ durationMs });
    if (result.status === 'saved') send('rec:saved', { path: result.path });
    if (result.status === 'failed') send('rec:notice', { kind: 'error', message: result.message });
    if (result.status === 'stopped-space') send('rec:notice', { kind: 'space', path: result.dir, message: result.message });
    return result;
  });
}

app.whenReady().then(() => {
  const removed = cleanupStale(recordingsRoot());
  if (removed.length > 0) console.log('起動時に掃除しました:', removed);
  setupPermissions();
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
