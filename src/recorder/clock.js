// メディアクロック（ADR-0007）。録画中だけ進み、一時停止中は止まる。

export class MediaClock {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.accumulated = 0;
    this.startedAt = null;
  }

  get running() {
    return this.startedAt !== null;
  }

  // 開始、または一時停止からの再開
  run() {
    if (this.startedAt === null) this.startedAt = this.now();
  }

  pause() {
    if (this.startedAt !== null) {
      this.accumulated += this.now() - this.startedAt;
      this.startedAt = null;
    }
  }

  elapsedMs() {
    return this.accumulated + (this.startedAt === null ? 0 : this.now() - this.startedAt);
  }
}
