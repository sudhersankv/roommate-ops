// Quick messages read as one (#41). "we need to make tacos tonight, what do we need" and "roomie suggest" two seconds
// later are one thought: both texts go to ONE agent run, so Roomie answers once instead of answering the first and then
// asking "suggest what?" about the second.
//
// The adapters' per-Chat queue (queue.ts) runs one message at a time, so the merge can't wait inside the pipeline: the
// second message's work only starts after the first's is done. Instead every message is noted on arrival (arrive(),
// synchronously, in the event handler), and when a plain text's turn comes (take()) it looks at what arrived after it:
//   - the next message in that Chat is a plain text from the same sender: this text rides along with it (take() returns
//     null, nothing runs now); the later one runs with both texts joined;
//   - the next message is someone else's (or a photo, a command): this one runs now, alone. Other senders' messages are
//     never held or merged: their arrival ends the wait at once;
//   - nothing yet: it waits until `windowMs` after its own arrival (or until the next arrival, whichever is first).
// The wait only ever holds that Chat's queue, and only for plain texts. windowMs 0 (tests) = every message on its own.
import { envMs, sleep as realSleep } from "./rate-limit";

/** Default merge window: consecutive texts from one person this close together are one request (MERGE_WINDOW_MS). */
export const MERGE_WINDOW_MS = 4_000;
/** At most this many texts are joined into one run; the next starts a new one. */
export const MAX_MERGED = 5;
/** Arrivals older than this are forgotten (the next one's take() has long happened). */
const KEEP_MS = 60_000;

/** One message as noted on arrival. */
export type Arrival = { readonly id: number; readonly chat: string; readonly sender: string; readonly at: number; readonly mergeable: boolean };

/** What a message carries into the run: its text and whether it addressed Roomie. */
export type Piece = { text: string; mentionsRoomie?: boolean; isReplyToRoomie?: boolean };

/** The run's input: the texts joined (one per line, in order), addressed if any of them was. */
export type Merged = Piece & { /** When the first of them arrived (ms): the stale-reply rule's "since". */ arrivedAt: number; /** How many texts went in. */ count: number };

export type CoalescerOptions = { windowMs?: number; clock?: () => number; sleep?: (ms: number) => Promise<void> };

export class Coalescer {
  readonly windowMs: number;
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private seq = 0;
  private readonly arrivals = new Map<string, Arrival[]>();
  private readonly wakers = new Map<string, (() => void)[]>();
  /** Texts waiting for a later arrival's run, by that arrival's id. */
  private readonly carried = new Map<number, { pieces: Piece[]; at: number }>();

  constructor(opts: CoalescerOptions = {}) {
    this.windowMs = opts.windowMs ?? envMs("MERGE_WINDOW_MS") ?? MERGE_WINDOW_MS;
    this.clock = opts.clock ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
  }

  /** Note a message the moment it arrives, before it's queued. `mergeable` = a plain text (no media, not a command). */
  arrive(chat: string, sender: string, mergeable: boolean): Arrival {
    const now = this.clock();
    const a: Arrival = { id: ++this.seq, chat, sender, at: now, mergeable };
    const list = (this.arrivals.get(chat) ?? []).filter((x) => now - x.at < KEEP_MS);
    list.push(a);
    this.arrivals.set(chat, list);
    const wake = this.wakers.get(chat);
    this.wakers.delete(chat);
    wake?.forEach((w) => w());
    return a;
  }

  /**
   * The message's turn in the queue: null = it went along with a later message from the same sender (run nothing);
   * otherwise what to run, with any earlier texts it carries joined in front.
   */
  async take(a: Arrival, piece: Piece): Promise<Merged | null> {
    const held = this.carried.get(a.id);
    this.carried.delete(a.id);
    const pieces = [...(held?.pieces ?? []), piece];
    const at = held?.at ?? a.at;
    if (a.mergeable && this.windowMs > 0 && pieces.length < MAX_MERGED) {
      for (;;) {
        const next = (this.arrivals.get(a.chat) ?? []).find((x) => x.id > a.id);
        if (next) {
          if (next.sender === a.sender && next.mergeable) {
            this.carried.set(next.id, { pieces, at });
            this.forget(a);
            return null;
          }
          break;
        }
        const left = a.at + this.windowMs - this.clock();
        if (left <= 0) break;
        await Promise.race([this.sleep(left), new Promise<void>((r) => this.wakers.set(a.chat, [...(this.wakers.get(a.chat) ?? []), r]))]);
      }
    }
    this.forget(a);
    return {
      text: pieces.map((p) => p.text.trim()).filter(Boolean).join("\n"),
      ...(pieces.some((p) => p.mentionsRoomie) ? { mentionsRoomie: true } : {}),
      ...(pieces.some((p) => p.isReplyToRoomie) ? { isReplyToRoomie: true } : {}),
      arrivedAt: at,
      count: pieces.length,
    };
  }

  /** Drop an arrival once it's been taken (later arrivals are what a take() looks at). */
  private forget(a: Arrival) {
    const rest = (this.arrivals.get(a.chat) ?? []).filter((x) => x.id !== a.id);
    if (rest.length) this.arrivals.set(a.chat, rest);
    else this.arrivals.delete(a.chat);
  }
}

/** The message's content with a merged run's joined text (and addressing) in place of its own, plus when it came. */
export function withMerged<T extends { text: string; mentionsRoomie?: boolean; isReplyToRoomie?: boolean }>(content: T, merged: Merged): T & { receivedAt: Date; merged?: number } {
  const joined =
    merged.count > 1
      ? { text: merged.text, mentionsRoomie: !!(content.mentionsRoomie || merged.mentionsRoomie), isReplyToRoomie: !!(content.isReplyToRoomie || merged.isReplyToRoomie), merged: merged.count }
      : {};
  return { ...content, ...joined, receivedAt: new Date(merged.arrivedAt) };
}
