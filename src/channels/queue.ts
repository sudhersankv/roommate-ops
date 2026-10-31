// Inbound work per Chat for Channel adapters: handlers return at once, messages within a Chat stay in order.
/** Work queued per key, in order; idle() waits for all of it. One slow agent run doesn't hold up other Chats. */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly live = new Set<Promise<void>>();

  constructor(private readonly label = "channel") {}

  push(key: string, task: () => Promise<unknown>) {
    const p = (this.tails.get(key) ?? Promise.resolve())
      .then(task)
      .then(() => {})
      .catch((err) => console.error(`[${this.label}] chat ${key}`, err));
    this.tails.set(key, p);
    this.live.add(p);
    void p.finally(() => {
      this.live.delete(p);
      if (this.tails.get(key) === p) this.tails.delete(key);
    });
  }

  async idle() {
    while (this.live.size) await Promise.allSettled([...this.live]);
  }
}
