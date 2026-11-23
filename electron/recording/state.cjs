'use strict';

// 録画の状態ファイル（<録画フォルダ>/state.json）。ADR-0010。
// 異常終了や容量不足で残った録画を、次回起動時に掃除するために使う。

const fs = require('node:fs');
const path = require('node:path');

const STATE_FILE = 'state.json';

function statePath(dir) {
  return path.join(dir, STATE_FILE);
}

function writeState(dir, state) {
  const tmp = statePath(dir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...state }, null, 2), 'utf8');
  fs.renameSync(tmp, statePath(dir));
}

function readState(dir) {
  try {
    return JSON.parse(fs.readFileSync(statePath(dir), 'utf8'));
  } catch {
    return null;
  }
}

// 録画フォルダを消す。`.partial` が状態に残っていれば先に消す。
function removeRecordingDir(dir) {
  const state = readState(dir);
  if (state && state.partialPath) {
    fs.rmSync(state.partialPath, { force: true });
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// 起動時の掃除（F-037、F-038）。state.json を持つ録画フォルダを削除する。
// 戻り値: 削除したフォルダの一覧
function cleanupStale(recordingsRoot) {
  const removed = [];
  if (!fs.existsSync(recordingsRoot)) return removed;
  for (const name of fs.readdirSync(recordingsRoot)) {
    const dir = path.join(recordingsRoot, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (!fs.existsSync(statePath(dir))) continue;
    removeRecordingDir(dir);
    removed.push(dir);
  }
  return removed;
}

module.exports = { STATE_FILE, statePath, writeState, readState, removeRecordingDir, cleanupStale };
