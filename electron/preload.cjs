'use strict';

// preload（要件 7.2、ADR-0009）。公開する API は次の 7 関数だけ。
// ファイルの読み書きや任意の IPC は公開しない。

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('recorder', {
  // レンダラー → メイン
  startRecording: (options) => ipcRenderer.invoke('rec:start', options),
  stopRecording: (options) => ipcRenderer.invoke('rec:stop', options),
  sendChunk: (kind, data, meta) => ipcRenderer.send('rec:chunk', kind, data, meta),
  sendSkip: (tUs) => ipcRenderer.send('rec:skip', tUs),
  // メイン → レンダラー
  onSaved: (callback) => subscribe('rec:saved', callback),
  onProgress: (callback) => subscribe('rec:progress', callback),
  onNotice: (callback) => subscribe('rec:notice', callback),
});
