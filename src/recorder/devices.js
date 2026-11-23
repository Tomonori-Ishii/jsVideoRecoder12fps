// マイクの一覧（F-007、F-008）

export async function requestMicPermission() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

// 音声入力を一覧にする。ラベルがなければ「マイク N」（要件 6.1）
export async function listMicrophones() {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `マイク ${i + 1}`,
    }));
}
