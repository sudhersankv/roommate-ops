// Chores: the chart, whose turn it is (Rotation), done / skip logs, streaks, and the chart's ranking ("hall of shame").
// Days are the Group's local days (lib/time.ts). The pure helpers are exported for chores.test.ts.
//
// Whose turn: with a Rotation, the Member after whoever last did (or passed) it, in Rotation order; without one,
// whichever active Member did it (or passed it) least recently. A skip moves the turn on but isn't a done: no streak,
// and the chore stays due.
// Streak: how many of a Member's own most recent turns on a chore they did on time, in a row. A pass or a late done
// ends it.
import { and, desc, eq, gt, inArray, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysInZone, addDaysToDay, dayInZone, daysBetweenDays, startOfDay, zonedParts } from "@/lib/time";
import { record, sourceOf } from "./activity";
import { NotAllowedError, requireActive, requireAdmin } from "./authz";
import { listMembers } from "./members";
import { groupTimezone } from "./schedule";
import type { Ctx, GroupCtx } from "./types";

const { chores, choreLogs, members, scheduledPosts } = schema;

export type ChoreState = "overdue" | "due" | "ok";

export type ChoreStatus = {
  choreId: string;
  name: string;
  everyDays: number;
  /** The Rotation as saved (member ids), null = everyone, least recent first. */
  rotation: string[] | null;
  /** Who's in the turn order now, in order (active Members only). */
  order: { id: string; name: string }[];
  lastDoneBy: string | null;
  lastDoneById: string | null;
  lastDoneAt: Date | null;
  /** Local "YYYY-MM-DD" of the last done. */
  lastDoneDay: string | null;
  /** The local day it's due ("YYYY-MM-DD"): last done + everyDays, or today when it was never done. */
  dueDay: string;
  /** Days until due (negative = late). */
  dueIn: number;
  state: ChoreState;
  overdue: boolean;
  whoseTurn: string | null;
  whoseTurnId: string | null;
  /** The last doer's streak on this chore. */
  streak: number;
  /** memberId -> streak on this chore. */
  streaks: Record<string, number>;
};
export type ShameRow = { memberId: string; name: string; daysSinceLastChore: number | null; choresThisWeek: number };

/** One log line, newest first in every list below. */
export type TurnEntry = { memberId: string; at: Date; skipped: boolean };

const DAY = 24 * 60 * 60 * 1000;
export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The chores a new household starts with (Onboarding): everyone in the Rotation, least recent first. */
export const STARTER_CHORES: ReadonlyArray<{ name: string; everyDays: number }> = [
  { name: "Take out the trash", everyDays: 3 },
  { name: "Dishes", everyDays: 1 },
  { name: "Clean the bathroom", everyDays: 7 },
];

// ---------- pure bits ----------

/**
 * Fuzzy chore picker. Tiers, first non-empty wins:
 *  1. exact (case-insensitive, trimmed)
 *  2. chore name starts with the query
 *  3. one contains the other ("trash" ~ "Take out trash", "take out the trash please" ~ "Take out trash")
 *  4. they share a word of 4+ letters ("bathroom" ~ "Clean the bathroom", "took out the trash" ~ "Take out trash")
 * Within a tier the shortest name wins (closest match), then alphabetical.
 */
export function pickChore<T extends { name: string }>(query: string, candidates: T[]): T | undefined {
  const q = norm(query);
  if (!q) return undefined;
  const words = (s: string) => new Set(s.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)));
  const qw = words(q);
  const tiers: Array<(n: string) => boolean> = [
    (n) => n === q,
    (n) => n.startsWith(q),
    (n) => n.includes(q) || q.includes(n),
    (n) => [...words(n)].some((w) => qw.has(w) || qw.has(`${w}s`) || qw.has(w.replace(/e?s$/, ""))),
  ];
  for (const test of tiers) {
    const hits = candidates
      .filter((c) => test(norm(c.name)))
      .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
    if (hits[0]) return hits[0];
  }
  return undefined;
}
const STOP = new Set(["done", "with", "just", "that", "this", "today", "again", "clean", "took", "take", "made", "make"]);

/**
 * Least-recent fallback: the Member whose latest entry (done or passed) is the oldest. Never-done first; ties by name.
 * Null when nobody's here.
 */
export function nextUp<T extends { id: string; name: string }>(people: T[], lastByMember: Map<string, Date>): T | null {
  const ordered = [...people].sort((a, b) => {
    const ta = lastByMember.get(a.id)?.getTime() ?? -Infinity;
    const tb = lastByMember.get(b.id)?.getTime() ?? -Infinity;
    return ta - tb || a.name.localeCompare(b.name);
  });
  return ordered[0] ?? null;
}

/** Name of whoever's next, least-recent rule. */
export function whoseTurn(people: Array<{ id: string; name: string }>, lastByMember: Map<string, Date>): string | null {
  return nextUp(people, lastByMember)?.name ?? null;
}

/** The turn order that applies: the Rotation filtered to active Members, or everyone when it's empty or unset. */
export function effectiveOrder<T extends { id: string }>(rotation: readonly string[] | null | undefined, people: T[]): { order: T[]; rotating: boolean } {
  const byId = new Map(people.map((p) => [p.id, p]));
  const order = [...new Set(rotation ?? [])].map((id) => byId.get(id)).filter((p): p is T => !!p);
  return order.length ? { order, rotating: true } : { order: people, rotating: false };
}

/** Whose turn it is on one chore. `entries` newest first. */
export function turnFor<T extends { id: string; name: string }>(rotation: readonly string[] | null | undefined, people: T[], entries: TurnEntry[]): T | null {
  const { order, rotating } = effectiveOrder(rotation, people);
  if (!rotating) {
    const last = new Map<string, Date>();
    for (const e of entries) if (!last.has(e.memberId)) last.set(e.memberId, e.at);
    return nextUp(order, last);
  }
  const ids = order.map((p) => p.id);
  const last = entries.find((e) => ids.includes(e.memberId));
  if (!last) return order[0] ?? null;
  return order[(ids.indexOf(last.memberId) + 1) % order.length] ?? null;
}

/** Due day, days left and state for a chore in `tz`. Never done = due today. */
export function choreSchedule(lastDoneAt: Date | null, everyDays: number, tz: string, now = new Date()): { dueDay: string; dueIn: number; state: ChoreState } {
  const today = dayInZone(tz, now);
  const dueDay = lastDoneAt ? addDaysToDay(dayInZone(tz, lastDoneAt), everyDays) : today;
  const dueIn = daysBetweenDays(today, dueDay);
  return { dueDay, dueIn, state: dueIn < 0 ? "overdue" : dueIn === 0 ? "due" : "ok" };
}

/**
 * memberId -> streak on one chore. `entries` newest first. A done is on time when its local day is no later than the
 * previous done's day + everyDays (the first done ever is on time).
 */
export function streaksFor(entries: TurnEntry[], everyDays: number, tz: string): Map<string, number> {
  const chrono = [...entries].reverse();
  const onTime = new Map<TurnEntry, boolean>();
  let prevDone: Date | null = null;
  for (const e of chrono) {
    if (e.skipped) continue;
    onTime.set(e, !prevDone || daysBetweenDays(addDaysToDay(dayInZone(tz, prevDone), everyDays), dayInZone(tz, e.at)) <= 0);
    prevDone = e.at;
  }
  const out = new Map<string, number>();
  const closed = new Set<string>();
  for (const e of entries) {
    if (closed.has(e.memberId)) continue;
    if (e.skipped || !onTime.get(e)) {
      closed.add(e.memberId);
      if (!out.has(e.memberId)) out.set(e.memberId, 0);
      continue;
    }
    out.set(e.memberId, (out.get(e.memberId) ?? 0) + 1);
  }
  return out;
}

/** Worst first: fewest chores this week, then longest since last chore (never = worst), then name. */
export function rankShame<T extends ShameRow>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.choresThisWeek - b.choresThisWeek ||
      (b.daysSinceLastChore ?? Infinity) - (a.daysSinceLastChore ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
}

/** Overdue first, then due today, then soonest, then by name. */
export function sortStatus<T extends { dueIn: number; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.dueIn - b.dueIn || a.name.localeCompare(b.name));
}

export const daysSince = (d: Date, now = new Date()) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY));

/** "The chart" in one friendly line: least done this week first. */
export function chartLine(rows: ShameRow[]): string {
  if (rows.length === 0) return "Nobody's on the chart yet.";
  const parts = rows.map((r) => (r.choresThisWeek === 0 ? `${r.name} 0${r.daysSinceLastChore == null ? " (none yet)" : ` (last one ${r.daysSinceLastChore === 0 ? "today" : `${r.daysSinceLastChore}d ago`})`}` : `${r.name} ${r.choresThisWeek}`));
  return `The chart this week: ${parts.join(", ")}.`;
}

// ---------- nudges and the learned rhythm (pure, chore-nudge.test.ts) ----------
//
// A chore with a history gets a private nudge to whoever's turn it is (#60): on the due day at the chore's usual local
// hour, then while it's late a shorter follow-up every max(1, round(everyDays / 2)) days, at most three. A done ends
// it; a pass moves it to the next person, who starts again at the first nudge on the day of the pass. A chore nobody
// has ever done has no rhythm yet: it stays on the Bundle's group line instead.

/** At most this many follow-ups after the due day's nudge. */
export const MAX_FOLLOW_UPS = 3;
/** The usual hour needs this many dones; with fewer the Bundle's hour is used. */
export const USUAL_HOUR_MIN_DONES = 3;
/** The usual hour reads the last 10 dones; the rhythm too. */
const RECENT_DONES = 10;
/** observedEvery needs this many done days. */
export const RHYTHM_MIN_DONES = 4;
/** Nudges go out between 08:00 and 21:00 local (quiet hours start at 22). */
const EARLIEST = 8;
const LATEST = 21;

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/** Days between follow-ups: half the cycle, at least a day (every 1 or 2 days -> daily, weekly -> every 4 days). */
export const followUpEvery = (everyDays: number) => Math.max(1, Math.round(everyDays / 2));

/**
 * The chore's usual local hour: the median hour of its last 10 dones (passes don't count), clamped to 08-21. Fewer than
 * three dones: `fallback` (the Bundle's hour), clamped the same way. `entries` newest first.
 */
export function usualHour(entries: readonly TurnEntry[], tz: string, fallback: number): number {
  const hours = entries.filter((e) => !e.skipped).slice(0, RECENT_DONES).map((e) => zonedParts(tz, e.at).hour);
  const h = hours.length >= USUAL_HOUR_MIN_DONES ? median(hours) : fallback;
  return Math.min(LATEST, Math.max(EARLIEST, h));
}

/** The chore as people say it: "Take out the trash" -> "Trash", "Clean the bathroom" -> "Bathroom"; else the chart's name, sentence case. */
export function choreLabel(name: string): string {
  const short = name.trim().replace(/^(?:take|taking)\s+out\s+(?:the\s+)?/i, "").replace(/^(?:do|clean)\s+the\s+/i, "") || name.trim();
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/** Shorter each time: "Morning Sam! Trash is yours today." (Hey after noon) -> "Trash, Sam." -> "Sam. Trash." */
export function choreNudgeText(step: number, chore: string, firstName: string, localHour: number): string {
  const label = choreLabel(chore);
  if (step === 0) return `${localHour < 12 ? "Morning" : "Hey"} ${firstName}! ${label} is yours today.`;
  if (step === 1) return `${label}, ${firstName}.`;
  return `${firstName}. ${label}.`;
}

export type NudgeChore = { name: string; everyDays: number; rotation: readonly string[] | null };
export type ChoreNudge = { memberId: string; name: string; step: number; hour: number; dueDay: string; text: string };

/**
 * Today's private nudge for one chore, or null. `entries` newest first; `people` the active Members (the turn order is
 * turnFor's). `defaultHour` is the Bundle's hour, used until the chore has a usual hour. The caller sends it once the
 * local hour reaches `hour`.
 */
export function choreNudgePlan(
  chore: NudgeChore,
  entries: readonly TurnEntry[],
  now: Date,
  tz: string,
  opts: { people: readonly { id: string; name: string }[]; defaultHour: number },
): ChoreNudge | null {
  const lastDone = entries.find((e) => !e.skipped);
  if (!lastDone) return null;
  const { dueDay, dueIn } = choreSchedule(lastDone.at, chore.everyDays, tz, now);
  if (dueIn > 0) return null;
  const person = turnFor(chore.rotation, [...opts.people], [...entries]);
  if (!person) return null;
  // A pass on or after the due day: the next person starts at the first nudge, that day.
  const pass = entries.find((e) => e.skipped && e.at.getTime() > lastDone.at.getTime());
  const passDay = pass ? dayInZone(tz, pass.at) : null;
  const start = passDay && passDay > dueDay ? passDay : dueDay;
  const late = daysBetweenDays(start, dayInZone(tz, now));
  const every = followUpEvery(chore.everyDays);
  if (late < 0 || late % every !== 0 || late / every > MAX_FOLLOW_UPS) return null;
  const step = late / every;
  const hour = usualHour(entries, tz, opts.defaultHour);
  const firstName = person.name.trim().split(/\s+/)[0] || person.name;
  return { memberId: person.id, name: person.name, step, hour, dueDay, text: choreNudgeText(step, chore.name, firstName, Math.max(hour, zonedParts(tz, now).hour)) };
}

/**
 * How often the group really does a chore: the median gap in local days between its last 10 done days (passes left
 * out, two dones on one day count once). Null with fewer than four done days.
 */
export function observedEvery(entries: readonly TurnEntry[], tz: string): number | null {
  const days = [...new Set(entries.filter((e) => !e.skipped).map((e) => dayInZone(tz, e.at)))].sort().reverse().slice(0, RECENT_DONES);
  if (days.length < RHYTHM_MIN_DONES) return null;
  const gaps = days.slice(1).map((d, i) => daysBetweenDays(d, days[i]));
  return Math.max(1, median(gaps));
}

/** Worth offering a change: off by at least a day and at least 30% of the chart's cycle. */
export const rhythmDiffers = (observed: number, everyDays: number) => Math.abs(observed - everyDays) >= 1 && Math.abs(observed - everyDays) >= 0.3 * everyDays;

const everyWords = (n: number) => (n === 1 ? "every day" : `every ${n} days`);

/** The report's offer: "Trash actually goes out every 3 days. Want me to change it?" */
export function rhythmOfferText(chore: string, observed: number): string {
  const label = choreLabel(chore);
  const said = /\b(trash|garbage|rubbish|recycling|bins?)\b/i.test(chore) ? `${label} actually goes out ${everyWords(observed)}.` : `You actually do ${label.toLowerCase()} ${everyWords(observed)}.`;
  return `${said} Want me to change it?`;
}

// ---------- DB ----------

type ChoreRow = typeof chores.$inferSelect;

async function groupChores(groupId: string): Promise<ChoreRow[]> {
  return db.select().from(chores).where(eq(chores.groupId, groupId));
}

/** Every log line for the Group, newest first, with the Member's name. */
async function groupLogs(groupId: string) {
  return db
    .select({ choreId: choreLogs.choreId, memberId: choreLogs.memberId, memberName: members.displayName, doneAt: choreLogs.doneAt, skipped: choreLogs.skipped })
    .from(choreLogs)
    .innerJoin(chores, eq(choreLogs.choreId, chores.id))
    .innerJoin(members, eq(choreLogs.memberId, members.id))
    .where(eq(chores.groupId, groupId))
    .orderBy(desc(choreLogs.doneAt), desc(choreLogs.id));
}

const named = (people: { id: string; displayName: string }[]) => people.map((m) => ({ id: m.id, name: m.displayName }));

async function validRotation(ctx: GroupCtx, rotation: string[] | null | undefined): Promise<string[] | null | undefined> {
  if (rotation === undefined) return undefined;
  if (rotation === null || rotation.length === 0) return null;
  const active = new Set((await listMembers(ctx)).map((m) => m.id));
  const ids = [...new Set(rotation)];
  const bad = ids.filter((id) => !active.has(id));
  if (bad.length) throw new Error("Everyone in the rotation has to be an active member of the group.");
  return ids;
}

/**
 * Puts a chore on the chart. Same name (case-insensitive) already there: updates its cadence (and its Rotation when
 * one is given). `rotation` is member ids in turn order; [] or null = everyone, least recent first.
 */
export async function addChore(
  ctx: Ctx,
  input: { name: string; everyDays?: number; rotation?: string[] | null },
): Promise<{ choreId: string; name: string; everyDays: number; created: boolean; rotation: string[] }> {
  await requireActive(ctx);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Chore needs a name.");
  if (name.length > 60) throw new Error("That chore name is a bit long. Something shorter?");
  const everyDays = Math.min(365, Math.max(1, Math.round(Number(input.everyDays) || 7)));
  const rotation = await validRotation(ctx, input.rotation);
  const people = await listMembers(ctx);
  const nameOf = (ids: string[] | null) => effectiveOrder(ids, named(people)).order.map((p) => p.name);
  const existing = (await groupChores(ctx.groupId)).find((c) => norm(c.name) === norm(name));
  if (existing) {
    const [c] = await db
      .update(chores)
      .set({ everyDays, ...(rotation !== undefined ? { rotation } : {}) })
      .where(eq(chores.id, existing.id))
      .returning();
    await record(ctx.groupId, ctx.memberId, "chore.changed", `changed ${c.name} to every ${everyDays} day${everyDays === 1 ? "" : "s"}`, { table: "chores", id: c.id }, sourceOf(ctx));
    return { choreId: c.id, name: c.name, everyDays, created: false, rotation: nameOf(c.rotation) };
  }
  const [c] = await db.insert(chores).values({ groupId: ctx.groupId, name, everyDays, rotation: rotation ?? null }).returning();
  await record(ctx.groupId, ctx.memberId, "chore.added", `put ${name} on the chart`, { table: "chores", id: c.id }, sourceOf(ctx));
  return { choreId: c.id, name, everyDays, created: true, rotation: nameOf(c.rotation) };
}

/** Onboarding for a household: trash, dishes and bathroom, unless the chart already has chores. Returns how many. */
export async function addStarterChores(ctx: Ctx): Promise<number> {
  await requireActive(ctx);
  if ((await groupChores(ctx.groupId)).length) return 0;
  await db.insert(chores).values(STARTER_CHORES.map((c) => ({ groupId: ctx.groupId, ...c, rotation: null })));
  await record(ctx.groupId, ctx.memberId, "chore.added", `put ${STARTER_CHORES.map((c) => c.name.toLowerCase()).join(", ")} on the chart`);
  return STARTER_CHORES.length;
}

async function findChore(ctx: GroupCtx, input: { chore?: string; choreId?: string }): Promise<ChoreRow | undefined> {
  const chart = await groupChores(ctx.groupId);
  if (input.choreId) {
    const c = chart.find((x) => x.id === input.choreId);
    if (!c) throw new Error("That chore isn't on the chart anymore.");
    return c;
  }
  const query = (input.chore ?? "").trim();
  if (!query) throw new Error("Which chore?");
  return pickChore(query, chart);
}

const unknownChore = async (ctx: GroupCtx, query: string) => {
  const chart = await groupChores(ctx.groupId);
  return new Error(chart.length ? `No chore matches "${query}". On the chart: ${chart.map((c) => c.name).join(", ")}.` : "There are no chores on the chart yet.");
};

/**
 * Logs a chore done by ctx.memberId (or `memberId`, any active Member). `choreId` picks it exactly (dashboard);
 * otherwise `chore` is fuzzy-matched by name and added (every 7 days) if it isn't on the chart.
 */
export async function logChore(
  ctx: Ctx,
  input: { chore?: string; choreId?: string; memberId?: string; at?: Date },
): Promise<{ chore: string; choreId: string; doneBy: string; streak: number; nextUp: string | null; added: boolean; nudged: boolean }> {
  await requireActive(ctx);
  const memberId = input.memberId ?? ctx.memberId;
  const people = await listMembers(ctx);
  const doer = people.find((m) => m.id === memberId);
  if (!doer) throw new Error("That person isn't an active member of this group.");

  let chore = await findChore(ctx, input);
  let added = false;
  if (!chore) {
    const name = (input.chore ?? "").trim().slice(0, 60);
    [chore] = await db.insert(chores).values({ groupId: ctx.groupId, name, everyDays: 7 }).returning();
    added = true;
  }
  const nudged = !added && (await nudgedSinceLastDone(ctx.groupId, chore.id));
  await db.insert(choreLogs).values({ choreId: chore.id, memberId, ...(input.at ? { doneAt: input.at } : {}) });
  await record(ctx.groupId, ctx.memberId, "chore.done", memberId === ctx.memberId ? `marked ${chore.name} done` : `marked ${chore.name} done for ${doer.displayName}`, { table: "chores", id: chore.id }, sourceOf(ctx));
  const status = (await choreStatus(ctx)).find((c) => c.choreId === chore.id)!;
  return { chore: chore.name, choreId: chore.id, doneBy: doer.displayName, streak: Math.max(1, status.streaks[memberId] ?? 1), nextUp: status.whoseTurn, added, nudged };
}

/** Whether Roomie DM'd someone about this chore (scheduled_posts "chore.dm") since it was last done. */
async function nudgedSinceLastDone(groupId: string, choreId: string): Promise<boolean> {
  const [last] = await db
    .select({ at: choreLogs.doneAt })
    .from(choreLogs)
    .where(and(eq(choreLogs.choreId, choreId), eq(choreLogs.skipped, false)))
    .orderBy(desc(choreLogs.doneAt))
    .limit(1);
  const rows = await db
    .select({ period: scheduledPosts.period })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.groupId, groupId), eq(scheduledPosts.kind, "chore.dm"), like(scheduledPosts.period, `%:${choreId}:%`), ...(last ? [gt(scheduledPosts.createdAt, last.at)] : [])))
    .limit(1);
  return rows.length > 0;
}

/**
 * Change a chore's cycle ("make trash every 3 days", a yes to the report's rhythm offer). Fuzzy by name like log_chore;
 * any active Member, as adding one is. The Rotation and history stay.
 */
export async function updateChore(ctx: Ctx, input: { chore?: string; choreId?: string; everyDays: number }): Promise<{ choreId: string; name: string; everyDays: number; before: number }> {
  await requireActive(ctx);
  const c = await findChore(ctx, input);
  if (!c) throw await unknownChore(ctx, input.chore ?? "");
  const everyDays = Math.min(365, Math.max(1, Math.round(Number(input.everyDays) || c.everyDays)));
  if (everyDays !== c.everyDays) {
    await db.update(chores).set({ everyDays }).where(and(eq(chores.id, c.id), eq(chores.groupId, ctx.groupId)));
    await record(ctx.groupId, ctx.memberId, "chore.changed", `changed ${c.name} to ${everyDays === 1 ? "every day" : `every ${everyDays} days`}`, { table: "chores", id: c.id }, sourceOf(ctx));
  }
  return { choreId: c.id, name: c.name, everyDays, before: c.everyDays };
}

const entriesOf = (logs: Awaited<ReturnType<typeof groupLogs>>, choreId: string): TurnEntry[] =>
  logs.filter((l) => l.choreId === choreId).map((l) => ({ memberId: l.memberId, at: l.doneAt, skipped: l.skipped }));

/** Today's private nudges for the Group's chores (choreNudgePlan per chore), with the chore's id. */
export async function nudgePlans(ctx: GroupCtx, now: Date, defaultHour: number): Promise<(ChoreNudge & { choreId: string; chore: string })[]> {
  const [chart, logs, people, tz] = await Promise.all([groupChores(ctx.groupId), groupLogs(ctx.groupId), listMembers(ctx), groupTimezone(ctx.groupId)]);
  const everyone = named(people);
  return chart.flatMap((c) => {
    const plan = choreNudgePlan({ name: c.name, everyDays: c.everyDays, rotation: c.rotation ?? null }, entriesOf(logs, c.id), now, tz, { people: everyone, defaultHour });
    return plan ? [{ ...plan, choreId: c.id, chore: c.name }] : [];
  });
}

/** Chores whose real rhythm (observedEvery) differs from the chart's enough to offer a change. */
export async function rhythmMismatches(ctx: GroupCtx): Promise<{ choreId: string; name: string; everyDays: number; observed: number }[]> {
  const [chart, logs, tz] = await Promise.all([groupChores(ctx.groupId), groupLogs(ctx.groupId), groupTimezone(ctx.groupId)]);
  return chart.flatMap((c) => {
    const observed = observedEvery(entriesOf(logs, c.id), tz);
    return observed !== null && rhythmDiffers(observed, c.everyDays) ? [{ choreId: c.id, name: c.name, everyDays: c.everyDays, observed }] : [];
  });
}

/** The sender passes their turn: the next Member in the Rotation is up. Only whoever's turn it is can pass it. */
export async function skipChore(ctx: Ctx, input: { chore?: string; choreId?: string }): Promise<{ chore: string; choreId: string; nextUp: string | null }> {
  const actor = await requireActive(ctx);
  const chore = await findChore(ctx, input);
  if (!chore) throw await unknownChore(ctx, input.chore ?? "");
  const before = (await choreStatus(ctx)).find((c) => c.choreId === chore.id)!;
  if (before.whoseTurnId !== ctx.memberId) {
    throw new NotAllowedError(`It's ${before.whoseTurn ?? "nobody"}'s turn on ${chore.name}, not yours, so there's nothing to pass.`, "not-yours");
  }
  await db.insert(choreLogs).values({ choreId: chore.id, memberId: ctx.memberId, skipped: true });
  const after = (await choreStatus(ctx)).find((c) => c.choreId === chore.id)!;
  await record(ctx.groupId, ctx.memberId, "chore.skipped", `passed their turn on ${chore.name}${after.whoseTurn && after.whoseTurnId !== actor.id ? ` to ${after.whoseTurn}` : ""}`, { table: "chores", id: chore.id }, sourceOf(ctx));
  return { chore: chore.name, choreId: chore.id, nextUp: after.whoseTurn };
}

/** Admin: take a chore off the chart, with its history. */
export async function removeChore(ctx: Ctx, input: { choreId?: string; chore?: string }): Promise<{ removed: string }> {
  await requireAdmin(ctx);
  const c = await findChore(ctx, input);
  if (!c) throw await unknownChore(ctx, input.chore ?? "");
  await db.delete(choreLogs).where(inArray(choreLogs.choreId, [c.id]));
  await db.delete(chores).where(and(eq(chores.id, c.id), eq(chores.groupId, ctx.groupId)));
  await record(ctx.groupId, ctx.memberId, "chore.removed", `took ${c.name} off the chart`, { table: "chores", id: c.id }, sourceOf(ctx));
  return { removed: c.name };
}

export async function choreStatus(ctx: GroupCtx, now = new Date()): Promise<ChoreStatus[]> {
  const [chart, logs, people, tz] = await Promise.all([groupChores(ctx.groupId), groupLogs(ctx.groupId), listMembers(ctx), groupTimezone(ctx.groupId)]);
  const everyone = named(people);
  const rows = chart.map((c): ChoreStatus => {
    const mine = logs.filter((l) => l.choreId === c.id);
    const entries: TurnEntry[] = mine.map((l) => ({ memberId: l.memberId, at: l.doneAt, skipped: l.skipped }));
    const latest = mine.find((l) => !l.skipped);
    const up = turnFor(c.rotation, everyone, entries);
    const streaks = streaksFor(entries, c.everyDays, tz);
    const sched = choreSchedule(latest?.doneAt ?? null, c.everyDays, tz, now);
    return {
      choreId: c.id,
      name: c.name,
      everyDays: c.everyDays,
      rotation: c.rotation ?? null,
      order: effectiveOrder(c.rotation, everyone).order,
      lastDoneBy: latest?.memberName ?? null,
      lastDoneById: latest?.memberId ?? null,
      lastDoneAt: latest?.doneAt ?? null,
      lastDoneDay: latest ? dayInZone(tz, latest.doneAt) : null,
      ...sched,
      overdue: sched.state === "overdue",
      whoseTurn: up?.name ?? null,
      whoseTurnId: up?.id ?? null,
      streak: latest ? (streaks.get(latest.memberId) ?? 0) : 0,
      streaks: Object.fromEntries(streaks),
    };
  });
  return sortStatus(rows);
}

/** Chores due today or late, for the daily nudge and Home. */
export async function choresDue(ctx: GroupCtx, now = new Date()): Promise<ChoreStatus[]> {
  return (await choreStatus(ctx, now)).filter((c) => c.state !== "ok");
}

/** The chart, worst first. "This week" = the last 7 local days, today included. */
export async function hallOfShame(ctx: GroupCtx, now = new Date()): Promise<ShameRow[]> {
  const [people, logs, tz] = await Promise.all([listMembers(ctx), groupLogs(ctx.groupId), groupTimezone(ctx.groupId)]);
  const weekStart = startOfDay(tz, addDaysInZone(tz, now, -6)).getTime();
  const done = logs.filter((l) => !l.skipped);
  const rows = people.map((m) => {
    const mine = done.filter((l) => l.memberId === m.id);
    return {
      memberId: m.id,
      name: m.displayName,
      daysSinceLastChore: mine[0] ? daysSince(mine[0].doneAt, now) : null,
      choresThisWeek: mine.filter((l) => l.doneAt.getTime() >= weekStart).length,
    };
  });
  return rankShame(rows);
}

/** Best current streak per Member across chores (for the report): highest first, zeros left out. */
export function bestStreaks(status: ChoreStatus[], people: { id: string; name: string }[]): { name: string; streak: number; chore: string }[] {
  return people
    .map((p) => {
      let best = { name: p.name, streak: 0, chore: "" };
      for (const c of status) if ((c.streaks[p.id] ?? 0) > best.streak) best = { name: p.name, streak: c.streaks[p.id], chore: c.name };
      return best;
    })
    .filter((b) => b.streak > 0)
    .sort((a, b) => b.streak - a.streak || a.name.localeCompare(b.name));
}
