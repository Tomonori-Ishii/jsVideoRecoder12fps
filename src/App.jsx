import { useEffect, useState } from 'react';
import { Recorder } from './recorder/recorder.js';
import { formatElapsed, formatDb, meterPercent, dbFromRms } from './recorder/format.js';
import { listMicrophones, requestMicPermission } from './recorder/devices.js';
import Controls from './components/Controls.jsx';
import MicSelect from './components/MicSelect.jsx';
import Meter from './components/Meter.jsx';
import StatusLine from './components/StatusLine.jsx';

const recorder = new Recorder(window.recorder);

export default function App() {
  const [snap, setSnap] = useState(recorder.snapshot());
  const [mics, setMics] = useState([]);
  const [micId, setMicId] = useState('');

  useEffect(() => {
    const unsubscribe = recorder.subscribe(setSnap);
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const list = await listMicrophones();
      if (cancelled) return;
      setMics(list);
      setMicId((prev) => (list.some((m) => m.deviceId === prev) ? prev : list[0]?.deviceId ?? ''));
    };
    // F-008: 起動時に一度マイクの使用を求め、名前を表示できるようにする
    requestMicPermission().catch(() => {}).finally(refresh);
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, []);

  const live = snap.state === 'recording';
  const db = live ? dbFromRms(snap.level) : -60; // F-006: 一時停止中は 0% / -60.0 dB
  const percent = live ? meterPercent(db) : 0;

  let text = snap.message ? snap.message.text : '';
  let kind = snap.message ? snap.message.kind : 'info';
  if (snap.state === 'stopping') {
    text = snap.progress === null ? '保存しています…' : `保存しています… ${snap.progress}%`;
    kind = 'info';
  }

  return (
    <div className="app">
      <div className="elapsed" aria-label="経過時間">
        {formatElapsed(snap.elapsedMs)}
      </div>
      <div className="db" aria-label="音量の数値">
        {formatDb(db)}
      </div>
      <Meter percent={percent} />
      <div className="mic-row">
        <MicSelect
          mics={mics}
          value={micId}
          disabled={snap.state !== 'idle'}
          onChange={setMicId}
        />
      </div>
      <Controls
        state={snap.state}
        muted={snap.muted}
        onStart={() => recorder.start({ micDeviceId: micId })}
        onPauseResume={() => (snap.state === 'paused' ? recorder.resume() : recorder.pause())}
        onStop={() => recorder.stop('user')}
        onMute={() => recorder.toggleMute()}
      />
      <StatusLine text={text} kind={kind} />
    </div>
  );
}
