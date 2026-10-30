// Caps on what one Group, Member or adder can make Roomie spend (audit B3). Counted in fixed windows (a day is a UTC
// day) in rate_counters, so a restart doesn't reset them; tests pass a MemoryCounters.
//   - agent runs (a message that reaches the model): 60 a day per Member, 30 per 10 minutes and 200 a day per Group
//   - Jev (the Gate's classifier, one call per Chat message): 2,000 a day per Group; past that, hard triggers only
//   - new Groups: 3 a day per person who adds Roomie (onboarding.ts)
//   - input: 2,000 characters per message (longer is cut before the Gate, and stored cut)
// Over a run cap Roomie says BREATHER once per Group per day (only when it was addressed), then stays quiet.
import type { CounterStore } from "./window-limit";
import { WindowLimiter } from "./window-limit";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export const CAPS = {
  memberDay: { max: 60, windowMs: DAY },
  groupBurst: { max: 30, windowMs: 10 * MIN },
  groupDay: { max: 200, windowMs: DAY },
  jevDay: { max: 2_000, windowMs: DAY },
  adderDay: { max: 3, windowMs: DAY },
} as const;

export const MAX_INPUT_CHARS = 2_000;
export const BREATHER = "I'm taking a breather; back tomorrow.";
export const TOO_MANY_GROUPS = "I'm in enough groups for today for you; try tomorrow.";

export const capKeys = {
  member: (memberId: string) => `member:${memberId}:day`,
  groupBurst: (groupId: string) => `group:${groupId}:10m`,
  groupDay: (groupId: string) => `group:${groupId}:day`,
  jev: (groupId: string) => `jev:group:${groupId}:day`,
  adder: (channel: string, userExternalId: string) => `adder:${channel}:${userExternalId}:day`,
  notice: (groupId: string) => `notice:group:${groupId}:day`,
};

/** Cut a message to MAX_INPUT_CHARS (on a code point, so no half emoji). */
export function clipInput(text: string, max = MAX_INPUT_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

export type RunCap = "member" | "group-burst" | "group-day";

export type Caps = {
  /** Counts one agent run for the Member and the Group; the cap it hit (nothing counted past it), or null. */
  run(groupId: string, memberId: string): Promise<RunCap | null>;
  /** Counts one Jev call for the Group; false past the daily cap. */
  jev(groupId: string): Promise<boolean>;
  /** Counts one new Group for this adder; false past the daily cap. */
  newGroup(channel: string, userExternalId: string): Promise<boolean>;
  /** True the first time today for this Group (the breather line goes out once). */
  noticeOnce(groupId: string): Promise<boolean>;
  /** The Group's agent runs in today's window. */
  limiter: { groupDay: WindowLimiter };
};

export function makeCaps(store: CounterStore, clock: () => number = Date.now): Caps {
  const lim = (c: { max: number; windowMs: number }) => new WindowLimiter(c.max, c.windowMs, clock, store);
  const member = lim(CAPS.memberDay);
  const burst = lim(CAPS.groupBurst);
  const groupDay = lim(CAPS.groupDay);
  const jev = lim(CAPS.jevDay);
  const adder = lim(CAPS.adderDay);
  const notice = lim({ max: 1, windowMs: DAY });
  return {
    // Most specific first, so one Member over their cap never uses up the Group's budget.
    async run(groupId, memberId) {
      if (!(await member.hit(capKeys.member(memberId)))) return "member";
      if (!(await burst.hit(capKeys.groupBurst(groupId)))) return "group-burst";
      if (!(await groupDay.hit(capKeys.groupDay(groupId)))) return "group-day";
      return null;
    },
    jev: (groupId) => jev.hit(capKeys.jev(groupId)),
    newGroup: (channel, userExternalId) => adder.hit(capKeys.adder(channel, userExternalId)),
    noticeOnce: (groupId) => notice.hit(capKeys.notice(groupId)),
    limiter: { groupDay },
  };
}

/** The process's caps on Postgres (built on first use; the DB client is imported lazily too). */
export async function caps(): Promise<Caps> {
  const g = globalThis as { __roomieCaps?: Caps };
  if (g.__roomieCaps) return g.__roomieCaps;
  const { pgCounters } = await import("./rate-counters");
  return (g.__roomieCaps ??= makeCaps(pgCounters));
}

/** Tests: swap the caps (e.g. makeCaps(new MemoryCounters())). */
export function setCaps(c: Caps | undefined) {
  (globalThis as { __roomieCaps?: Caps }).__roomieCaps = c;
}
