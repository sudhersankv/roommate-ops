// A fixed-size sliding window per key ("3 tries an hour per IP"), in memory. Fine for one machine; a restart forgets.
// The clock is injectable so tests run instantly.

export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Counts one try for `key`. False (and not counted) when `key` already used its `max` tries in the window. */
  take(key: string): boolean {
    const now = this.clock();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
  }
}
