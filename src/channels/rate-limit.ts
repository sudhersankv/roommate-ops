// Outbound pacing for Channel adapters (ADR 0001): token buckets per Chat and overall. Clock and sleep are injectable,
// so tests run instantly.

export type BucketSpec = { capacity: number; perSecond: number };

export class TokenBucket {
  private tokens: number;
  private at: number;
  constructor(
    private readonly spec: BucketSpec,
    now: number,
  ) {
    this.tokens = spec.capacity;
    this.at = now;
  }

  private refill(now: number) {
    this.tokens = Math.min(this.spec.capacity, this.tokens + ((now - this.at) / 1000) * this.spec.perSecond);
    this.at = now;
  }

  /** How long until one token is free (0 = now). */
  waitMs(now: number): number {
    this.refill(now);
    return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.spec.perSecond) * 1000);
  }

  take(now: number) {
    this.refill(now);
    this.tokens -= 1;
  }
}

export type LimiterOptions = {
  /** Buckets for one Chat (by key). Several = all must have a token. */
  perKey: (key: string) => BucketSpec[];
  global: BucketSpec;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** acquire(key) resolves when a message to `key` may go out. Callers for the same key are served in order. */
export class SendLimiter {
  private readonly buckets = new Map<string, TokenBucket[]>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly global: TokenBucket;
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: LimiterOptions) {
    this.clock = opts.clock ?? Date.now;
    this.sleep = opts.sleep ?? sleep;
    this.global = new TokenBucket(opts.global, this.clock());
  }

  acquire(key: string): Promise<void> {
    const next = (this.chains.get(key) ?? Promise.resolve()).then(() => this.waitFor(key));
    this.chains.set(key, next.catch(() => {}));
    return next;
  }

  private async waitFor(key: string) {
    let mine = this.buckets.get(key);
    if (!mine) this.buckets.set(key, (mine = this.opts.perKey(key).map((s) => new TokenBucket(s, this.clock()))));
    const all = [...mine, this.global];
    for (;;) {
      const now = this.clock();
      const wait = Math.max(...all.map((b) => b.waitMs(now)));
      if (wait <= 0) {
        for (const b of all) b.take(now);
        return;
      }
      await this.sleep(wait);
    }
  }
}
