// 画面に出すメッセージ（F-009、F-031、F-033）

export const SCREEN_DENIED_MESSAGE =
  '画面の録画が許可されていません。OSやアプリの画面収録の設定を確認してください。';
export const NO_MIC_MESSAGE = 'マイクが見つかりません。マイクを接続してください。';
export const LIMIT_MESSAGE = '録画時間の上限（2時間）に達したため、録画を止めました。';

// マイクのエラー名を、要件 F-009 の文言に対応させる
export function micErrorMessage(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'マイクの使用が許可されていません。OSやアプリのマイク設定を確認してください。';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'マイクが見つかりません。マイクを接続してから再度お試しください。';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'マイクを使用できません。他のアプリがマイクを使用していないか確認してください。';
  }
  return `エラーが発生しました: ${(err && err.message) || name || '不明'}`;
}

// 表示しきれない長さの文言を省略する（末尾を … にする）
export function truncate(text, max) {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max - 1).join('') + '…';
}
