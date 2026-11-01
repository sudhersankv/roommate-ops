// Upkeep: house care that comes around every few weeks or months (filters, smoke alarms, the dryer vent). Due days
// are the Group's local days. "Due soon" = within 7 days; the weekly Group Report carries them, and House's Bundle line
// names whoever's up (house.ts).
//
// Whose turn (#73): the chores' rule (turnFor) over the whole group, no Rotation: whichever active Member did or passed
// the item least recently (never first, ties by name). The history is the item's own Activity rows ("upkeep.done" and
// "upkeep.skipped" with ref maintenance/<id>), so it needs no table of its own: a done moves the turn on, a pass too
// (only whoever's turn it is can pass), and a pass isn't a done (the due day stays).
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysToDay, dayInZone, daysBetweenDays } from "@/lib/time";
import { recordFor } from "./activity";
import { NotAllowedError, requireActive, requireAdmin } from "./authz";
import { turnFor, type TurnEntry } from "./chores";
import { listMembers } from "./members";
import { groupTimezone } from "./schedule";
import type { Ctx, GroupCtx } from "./types";

const { maintenance } = schema;

export type MaintenanceStatus = "overdue" | "due-soon" | "ok";

export type MaintenanceItem = {
  id: string;
  item: string;
  everyDays: number;
  lastDone: Date | null;
  /** Local "YYYY-MM-DD"; today when it was never done. */
  dueDay: string;
  /** Days until due (negative = late). */
  dueIn: number;
  status: MaintenanceStatus;
  /** Whoever's up next (active Members, least recent first), null when nobody's active. */
  whoseTurn: string | null;
  whoseTurnId: string | null;
};

/** Activity kinds that make an item's turn history. */
export const UPKEEP_DONE = "upkeep.done";
export const UPKEEP_SKIPPED = "upkeep.skipped";

/** "Due soon" window in days. */
export const DUE_SOON_DAYS = 7;

/** The usual five, offered when a Group tracks nothing yet (and added at Onboarding for households). */
export const DEFAULT_ITEMS: ReadonlyArray<{ item: string; everyDays: number }> = [
  { item: "Replace HVAC / air filter", everyDays: 90 },
  { item: "Test smoke alarms", everyDays: 180 },
  { item: "Clean dryer vent", everyDays: 180 },
  { item: "Descale coffee maker", everyDays: 60 },
  { item: "Check fire extinguisher", everyDays: 365 },
];

// ---------- pure helpers (unit-tested, no DB) ----------

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Due day, days left and status in `tz`. Never done counts as due today (due soon, not overdue): nobody remembers when
 * the filter was last changed, so the first nudge is gentle.
 */
export function upkeepSchedule(lastDone: Date | null, everyDays: number, tz: string, now = new Date()): { dueDay: string; dueIn: number; status: MaintenanceStatus } {
  const today = dayInZone(tz, now);
  const dueDay = lastDone ? addDaysToDay(dayInZone(tz, lastDone), everyDays) : today;
  const dueIn = daysBetweenDays(today, dueDay);
  return { dueDay, dueIn, status: dueIn < 0 ? "overdue" : dueIn <= DUE_SOON_DAYS ? "due-soon" : "ok" };
}

/** Soonest first, then by name. */
export function compareByDue(a: { dueIn: number; item: string }, b: { dueIn: number; item: string }): number {
  return a.dueIn - b.dueIn || a.item.localeCompare(b.item);
}

const STOP = new Set(["the", "a", "an", "changed", "change", "replaced", "replace", "did", "done", "check", "checked", "clean", "cleaned", "test", "tested", "our", "my"]);
const words = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));

/**
 * Fuzzy pick by name: exact -> startsWith -> includes (either direction) -> shares a word ("changed the air filter"
 * finds "Replace HVAC / air filter"). Returns undefined when nothing matches, or when the shared word is ambiguous.
 */
export function pickByName<T extends { item: string }>(items: readonly T[], query: string): T | undefined {
  const q = norm(query);
  if (!q) return undefined;
  const direct =
    items.find((m) => norm(m.item) === q) ??
    items.find((m) => norm(m.item).startsWith(q)) ??
    items.find((m) => norm(m.item).includes(q) || q.includes(norm(m.item)));
  if (direct) return direct;
  const qw = words(q);
  const scored = items.map((m) => ({ m, n: [...words(m.item)].filter((w) => qw.has(w) || qw.has(`${w}s`) || qw.has(w.replace(/s$/, ""))).length })).filter((x) => x.n > 0);
  scored.sort((a, b) => b.n - a.n);
  if (!scored.length || (scored[1] && scored[1].n === scored[0].n)) return undefined;
  return scored[0].m;
}

/**
 * The item as people say it: "Replace HVAC / air filter" -> "Air filter", "Test smoke alarms" -> "Smoke alarm test",
 * "Clean dryer vent" -> "Dryer vent", "Check fire extinguisher" -> "Fire extinguisher check". Else the name as tracked.
 */
export function upkeepLabel(item: string): string {
  let s = item.trim().replace(/\s+/g, " ");
  if (s.includes("/")) s = s.slice(s.lastIndexOf("/") + 1).trim() || s;
  const m = /^(test|check|replace|change|clean|descale|service|flush|inspect)\s+(?:the\s+)?(.+)$/i.exec(s);
  if (m) {
    const verb = m[1].toLowerCase();
    s = verb === "test" || verb === "check" ? `${m[2].replace(/([^s])s$/i, "$1")} ${verb}` : m[2];
  }
  s = s.replace(/^(?:the|our|my)\s+/i, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Quick jobs (a test or a check) get "Takes a minute." in the Bundle. */
export const isQuickUpkeep = (item: string) => /\b(test|check)$/i.test(upkeepLabel(item));

/** Whose turn on one item: the chores' turnFor over the active Members, no Rotation. `entries` newest first. */
export function upkeepTurn<T extends { id: string; name: string }>(people: T[], entries: TurnEntry[]): T | null {
  return turnFor(null, people, entries);
}

// ---------- DB-backed services ----------

async function rows(groupId: string) {
  return db.select().from(maintenance).where(eq(maintenance.groupId, groupId));
}

/** itemId -> its dones and passes, newest first, from the Group's Activity (rows with a Member only). */
async function turnHistory(groupId: string): Promise<Map<string, TurnEntry[]>> {
  const { activity } = schema;
  const logs = await db
    .select({ refId: activity.refId, memberId: activity.actorMemberId, at: activity.createdAt, kind: activity.kind })
    .from(activity)
    .where(and(eq(activity.groupId, groupId), eq(activity.refTable, "maintenance"), inArray(activity.kind, [UPKEEP_DONE, UPKEEP_SKIPPED]), isNotNull(activity.actorMemberId)))
    .orderBy(desc(activity.createdAt));
  const out = new Map<string, TurnEntry[]>();
  for (const l of logs) {
    if (!l.refId || !l.memberId || !l.at) continue;
    const list = out.get(l.refId) ?? [];
    list.push({ memberId: l.memberId, at: l.at, skipped: l.kind === UPKEEP_SKIPPED });
    out.set(l.refId, list);
  }
  return out;
}

const named = (people: { id: string; displayName: string }[]) => people.map((m) => ({ id: m.id, name: m.displayName }));

/** Track an upkeep item. Same name (case-insensitive) already tracked -> just update its cadence. */
export async function addMaintenance(ctx: Ctx, input: { item: string; everyDays: number }): Promise<{ id: string; item: string; everyDays: number; created: boolean }> {
  await requireActive(ctx);
  const item = input.item.trim().replace(/\s+/g, " ");
  const everyDays = Math.min(3650, Math.max(1, Math.round(Number(input.everyDays) || 0)));
  if (!item) throw new Error("Upkeep item needs a name.");
  if (!Number(input.everyDays)) throw new Error("How often, in days? (90 for a filter, 180 for smoke alarms)");
  const existing = (await rows(ctx.groupId)).find((m) => norm(m.item) === norm(item));
  if (existing) {
    await db.update(maintenance).set({ everyDays }).where(eq(maintenance.id, existing.id));
    return { id: existing.id, item: existing.item, everyDays, created: false };
  }
  const [m] = await db.insert(maintenance).values({ groupId: ctx.groupId, item, everyDays }).returning();
  await recordFor(ctx, "upkeep.added", `started tracking ${item}`, { table: "maintenance", id: m.id });
  return { id: m.id, item, everyDays, created: true };
}

async function find(ctx: GroupCtx, input: { item?: string; id?: string }) {
  const all = await rows(ctx.groupId);
  const match = (input.id ? all.find((m) => m.id === input.id) : undefined) ?? (input.item ? pickByName(all, input.item) : undefined);
  if (!match) {
    const known = all.map((m) => `"${m.item}"`).join(", ");
    throw new Error(
      all.length
        ? `No upkeep item matches "${input.item ?? ""}". Known items: ${known}.`
        : `No upkeep item matches "${input.item ?? ""}" and nothing is tracked yet. Add it first.`,
    );
  }
  return match;
}

/**
 * Mark an item done now, by the sender; the turn moves on. Fuzzy name match; unknown names throw with the list of
 * known items so Roomie can ask. `nextUp` is whoever's up next time.
 */
export async function markDone(ctx: Ctx, input: { item?: string; id?: string }): Promise<{ item: string; nextDueDay: string; everyDays: number; nextUp: string | null }> {
  await requireActive(ctx);
  const match = await find(ctx, input);
  const now = new Date();
  await db
    .update(maintenance)
    .set({ lastDone: now })
    .where(and(eq(maintenance.id, match.id), eq(maintenance.groupId, ctx.groupId)));
  await recordFor(ctx, UPKEEP_DONE, `did ${match.item}`, { table: "maintenance", id: match.id });
  const [tz, history, people] = await Promise.all([groupTimezone(ctx.groupId), turnHistory(ctx.groupId), listMembers(ctx)]);
  const next = upkeepTurn(named(people), history.get(match.id) ?? []);
  return { item: match.item, everyDays: match.everyDays, nextDueDay: upkeepSchedule(now, match.everyDays, tz, now).dueDay, nextUp: next?.name ?? null };
}

/** The sender passes their turn on an item: whoever's next is up. Only whoever's turn it is can pass; the due day stays. */
export async function skipUpkeep(ctx: Ctx, input: { item?: string; id?: string }): Promise<{ item: string; nextUp: string | null }> {
  await requireActive(ctx);
  const match = await find(ctx, input);
  const [history, people] = await Promise.all([turnHistory(ctx.groupId), listMembers(ctx)]);
  const everyone = named(people);
  const entries = history.get(match.id) ?? [];
  const up = upkeepTurn(everyone, entries);
  if (up?.id !== ctx.memberId) throw new NotAllowedError(`It's ${up?.name ?? "nobody"}'s turn on ${match.item}, not yours, so there's nothing to pass.`, "not-yours");
  const next = upkeepTurn(everyone, [{ memberId: ctx.memberId, at: new Date(), skipped: true }, ...entries]);
  await recordFor(ctx, UPKEEP_SKIPPED, `passed their turn on ${match.item}${next && next.id !== ctx.memberId ? ` to ${next.name}` : ""}`, { table: "maintenance", id: match.id });
  return { item: match.item, nextUp: next?.name ?? null };
}

/** Admin: stop tracking an item. */
export async function removeMaintenance(ctx: Ctx, input: { item?: string; id?: string }): Promise<{ removed: string }> {
  await requireAdmin(ctx);
  const match = await find(ctx, input);
  await db.delete(maintenance).where(and(eq(maintenance.id, match.id), eq(maintenance.groupId, ctx.groupId)));
  await recordFor(ctx, "upkeep.removed", `stopped tracking ${match.item}`, { table: "maintenance", id: match.id });
  return { removed: match.item };
}

/** Every item with its due day and status, soonest first. */
export async function listMaintenance(ctx: GroupCtx, now = new Date()): Promise<MaintenanceItem[]> {
  const [all, tz, history, people] = await Promise.all([rows(ctx.groupId), groupTimezone(ctx.groupId), turnHistory(ctx.groupId), listMembers(ctx)]);
  const everyone = named(people);
  return all
    .map((r) => {
      const up = upkeepTurn(everyone, history.get(r.id) ?? []);
      return { id: r.id, item: r.item, everyDays: r.everyDays, lastDone: r.lastDone, ...upkeepSchedule(r.lastDone, r.everyDays, tz, now), whoseTurn: up?.name ?? null, whoseTurnId: up?.id ?? null };
    })
    .sort(compareByDue);
}

/** Items overdue or due within 7 days, soonest first (Home, the Report). */
export async function dueMaintenance(ctx: GroupCtx, now = new Date()): Promise<MaintenanceItem[]> {
  return (await listMaintenance(ctx, now)).filter((m) => m.status !== "ok");
}

/** Add the usual five, skipping any the Group already tracks. Returns how many were added. */
export async function addDefaults(ctx: Ctx): Promise<number> {
  await requireActive(ctx);
  const have = new Set((await rows(ctx.groupId)).map((m) => norm(m.item)));
  const missing = DEFAULT_ITEMS.filter((d) => !have.has(norm(d.item)));
  if (missing.length) {
    await db.insert(maintenance).values(missing.map((d) => ({ groupId: ctx.groupId, ...d })));
    await recordFor(ctx, "upkeep.added", `started tracking the usual ${missing.length === 5 ? "five" : missing.length}: ${missing.map((d) => d.item.toLowerCase()).join(", ")}`);
  }
  return missing.length;
}
