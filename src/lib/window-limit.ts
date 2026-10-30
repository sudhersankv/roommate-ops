// "N tries per key per window". Two flavours:
//   - take(key): a sliding window in memory (the beta form, Trick votes). Fine for one machine; a restart forgets.
//   - hit(key) / used(key): fixed windows (UTC-aligned: a day is a UTC day) in a CounterStore, so a restart doesn't
//     reset them. The agent-run caps (lib/caps.ts) use Postgres (lib/rate-counters.ts); tests use MemoryCounters.
// The clock is injectable so tests run instantly.

/** Fixed-window counts. `hit` adds one unless the count is already `max` (then false, nothing counted). */
export interface CounterStore {
  hit(key: string, windowStart: Date, max: number): Promise<boolean>;
  count(key: string, windowStart: Date): Promise<number>;
}

export class MemoryCounters implements CounterStore {
  private readonly counts = new Map<string, number>();
  private id = (key: string, windowStart: Date) => `${key}@${windowStart.getTime()}`;
  async hit(key: string, windowStart: Date, max: number) {
    const id = this.id(key, windowStart);
    const n = this.counts.get(id) ?? 0;
    if (n >= max) return false;
    this.counts.set(id, n + 1);
    if (this.counts.size > 50_000) this.counts.clear();
    return true;
  }
  async count(key: string, windowStart: Date) {
    return this.counts.get(this.id(key, windowStart)) ?? 0;
  }
}

export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
    /** Backs hit()/used() with fixed windows; without one they use a MemoryCounters of their own. */
    private readonly store: CounterStore = new MemoryCounters(),
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

  /** The start of the fixed window `now` falls in. */
  windowStart(now = this.clock()): Date {
    return new Date(Math.floor(now / this.windowMs) * this.windowMs);
  }

  /** Like take(), on the store's fixed window. */
  hit(key: string): Promise<boolean> {
    return this.store.hit(key, this.windowStart(), this.max);
  }

  /** How many of `key`'s tries the current fixed window has used. */
  used(key: string): Promise<number> {
    return this.store.count(key, this.windowStart());
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
  }
}
