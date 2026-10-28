// P3 · Sudhersan. Chores: the chart, who did what, whose turn, and the Hall of Shame.
// Pure helpers (pickChore, whoseTurn, rankShame, countStreak) are exported so chores.test.ts can run them without a DB.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { record } from "./activity";
import { requireActive } from "./authz";
import { listMembers } from "./members";
import type { Ctx, GroupCtx } from "./types";

const { chores, choreLogs, members } = schema;

export type ChoreStatus = {
  choreId: string;
  name: string;
  everyDays: number;
  lastDoneBy: string | null;
  lastDoneById: string | null;
  lastDoneAt: Date | null;
  /** lastDoneAt + everyDays; null = never done, so it's due now. */
  dueAt: Date | null;
  overdue: boolean;
  whoseTurn: string | null;
  whoseTurnId: string | null;
  /** How many times in a row the last doer did it. */
  streak: number;
};
export type ShameRow = { memberId: string; name: string; daysSinceLastChore: number | null; choresThisWeek: number };

const DAY = 24 * 60 * 60 * 1000;
export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// ---------- pure bits ----------

/**
 * Fuzzy chore picker. Tiers, first non-empty wins:
 *  1. exact (case-insensitive, trimmed)
 *  2. chore name starts with the query
 *  3. one contains the other ("trash" ~ "Take out trash", "take out the trash please" ~ "Take out trash")
 * Within a tier the shortest name wins (closest match), then alphabetical.
 */
export function pickChore<T extends { name: string }>(query: string, candidates: T[]): T | undefined {
  const q = norm(query);
  if (!q) return undefined;
  const tiers: Array<(n: string) => boolean> = [
    (n) => n === q,
    (n) => n.startsWith(q),
    (n) => n.includes(q) || q.includes(n),
  ];
  for (const test of tiers) {
    const hits = candidates
      .filter((c) => test(norm(c.name)))
      .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
    if (hits[0]) return hits[0];
  }
  return undefined;
}

/**
 * Whose turn: the active member whose most recent log for this chore is the oldest.
 * Members who have never done it come first; ties break by name. Null when nobody lives here.
 */
export function whoseTurn(
  people: Array<{ id: string; name: string }>,
  lastDoneByMember: Map<string, Date>,
): string | null {
  return nextUp(people, lastDoneByMember)?.name ?? null;
}

/** Same as whoseTurn, but the whole Member. */
export function nextUp<T extends { id: string; name: string }>(people: T[], lastDoneByMember: Map<string, Date>): T | null {
  const ordered = [...people].sort((a, b) => {
    const ta = lastDoneByMember.get(a.id)?.getTime() ?? -Infinity;
    const tb = lastDoneByMember.get(b.id)?.getTime() ?? -Infinity;
    return ta - tb || a.name.localeCompare(b.name);
  });
  return ordered[0] ?? null;
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

/** Streak: consecutive most-recent logs (newest first) of one chore done by `memberId`. */
export function countStreak(doersNewestFirst: string[], memberId: string): number {
  let n = 0;
  for (const id of doersNewestFirst) {
    if (id !== memberId) break;
    n++;
  }
  return n;
}

/** Overdue first, then by name. */
export function sortStatus<T extends { overdue: boolean; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.name.localeCompare(b.name));
}

export function isOverdue(lastDoneAt: Date | null, everyDays: number, now = new Date()): boolean {
  if (!lastDoneAt) return true;
  return now.getTime() - lastDoneAt.getTime() > everyDays * DAY;
}

export const daysSince = (d: Date, now = new Date()) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY));

// ---------- DB ----------

async function groupChores(groupId: string) {
  return db.select().from(chores).where(eq(chores.groupId, groupId));
}

/** All logs for the Group, newest first, with the doer's name. */
async function groupLogs(groupId: string) {
  return db
    .select({
      choreId: choreLogs.choreId,
      memberId: choreLogs.memberId,
      memberName: members.displayName,
      doneAt: choreLogs.doneAt,
    })
    .from(choreLogs)
    .innerJoin(chores, eq(choreLogs.choreId, chores.id))
    .innerJoin(members, eq(choreLogs.memberId, members.id))
    .where(eq(chores.groupId, groupId))
    .orderBy(desc(choreLogs.doneAt));
}

const named = (people: { id: string; displayName: string }[]) => people.map((m) => ({ id: m.id, name: m.displayName }));

/** Adds a chore; same name (case-insensitive) already on the chart just updates its cadence. */
export async function addChore(ctx: Ctx, input: { name: string; everyDays: number }): Promise<void> {
  await requireActive(ctx);
  const name = input.name.trim();
  if (!name) throw new Error("Chore needs a name.");
  const everyDays = Math.max(1, Math.round(Number(input.everyDays) || 7));
  const existing = (await groupChores(ctx.groupId)).find((c) => norm(c.name) === norm(name));
  if (existing) {
    await db.update(chores).set({ everyDays }).where(eq(chores.id, existing.id));
    return;
  }
  const [c] = await db.insert(chores).values({ groupId: ctx.groupId, name, everyDays }).returning();
  await record(ctx.groupId, ctx.memberId, "chore.added", `put ${name} on the chart`, { table: "chores", id: c.id });
}

/**
 * Logs a chore for ctx.memberId (or `memberId`). `choreId` picks it exactly (dashboard); otherwise `chore` is
 * fuzzy-matched by name and created (every 7 days) if unknown.
 */
export async function logChore(ctx: Ctx, input: { chore?: string; choreId?: string; memberId?: string }): Promise<{ chore: string; streak: number }> {
  await requireActive(ctx);
  const memberId = input.memberId ?? ctx.memberId;
  const people = await listMembers(ctx);
  const doer = people.find((m) => m.id === memberId);
  if (!doer) throw new Error("That person isn't an active member of this group.");

  const chart = await groupChores(ctx.groupId);
  let chore = input.choreId ? chart.find((c) => c.id === input.choreId) : undefined;
  if (input.choreId && !chore) throw new Error("That chore isn't on the chart anymore.");
  if (!chore) {
    const query = (input.chore ?? "").trim();
    if (!query) throw new Error("Which chore?");
    chore = pickChore(query, chart);
    if (!chore) [chore] = await db.insert(chores).values({ groupId: ctx.groupId, name: query, everyDays: 7 }).returning();
  }

  await db.insert(choreLogs).values({ choreId: chore.id, memberId });
  const recent = await db
    .select({ memberId: choreLogs.memberId })
    .from(choreLogs)
    .where(eq(choreLogs.choreId, chore.id))
    .orderBy(desc(choreLogs.doneAt));
  await record(ctx.groupId, ctx.memberId, "chore.done", memberId === ctx.memberId ? `marked ${chore.name} done` : `marked ${chore.name} done for ${doer.displayName}`, { table: "chores", id: chore.id });
  return { chore: chore.name, streak: Math.max(1, countStreak(recent.map((r) => r.memberId), memberId)) };
}

export async function choreStatus(ctx: GroupCtx): Promise<ChoreStatus[]> {
  const [chart, logs, people] = await Promise.all([groupChores(ctx.groupId), groupLogs(ctx.groupId), listMembers(ctx)]);
  const now = new Date();
  const rows = chart.map((c) => {
    const mine = logs.filter((l) => l.choreId === c.id); // newest first
    const latest = mine[0];
    const lastByMember = new Map<string, Date>();
    for (const l of mine) if (!lastByMember.has(l.memberId)) lastByMember.set(l.memberId, l.doneAt);
    const up = nextUp(named(people), lastByMember);
    return {
      choreId: c.id,
      name: c.name,
      everyDays: c.everyDays,
      lastDoneBy: latest?.memberName ?? null,
      lastDoneById: latest?.memberId ?? null,
      lastDoneAt: latest?.doneAt ?? null,
      dueAt: latest ? new Date(latest.doneAt.getTime() + c.everyDays * DAY) : null,
      overdue: isOverdue(latest?.doneAt ?? null, c.everyDays, now),
      whoseTurn: up?.name ?? null,
      whoseTurnId: up?.id ?? null,
      streak: latest ? countStreak(mine.map((l) => l.memberId), latest.memberId) : 0,
    };
  });
  return sortStatus(rows);
}

/** Sorted worst first. */
export async function hallOfShame(ctx: GroupCtx): Promise<ShameRow[]> {
  const [people, logs] = await Promise.all([listMembers(ctx), groupLogs(ctx.groupId)]);
  const now = new Date();
  const weekAgo = now.getTime() - 7 * DAY;
  const rows = people.map((m) => {
    const mine = logs.filter((l) => l.memberId === m.id);
    return {
      memberId: m.id,
      name: m.displayName,
      daysSinceLastChore: mine[0] ? daysSince(mine[0].doneAt, now) : null,
      choresThisWeek: mine.filter((l) => l.doneAt.getTime() >= weekAgo).length,
    };
  });
  return rankShame(rows);
}

/** Removes a chore and its history. Dashboard-only housekeeping. */
export async function removeChore(ctx: Ctx, input: { choreId: string }): Promise<void> {
  await requireActive(ctx);
  const [c] = await db
    .select({ id: chores.id })
    .from(chores)
    .where(and(eq(chores.id, input.choreId), eq(chores.groupId, ctx.groupId)));
  if (!c) return;
  await db.delete(choreLogs).where(inArray(choreLogs.choreId, [c.id]));
  await db.delete(chores).where(eq(chores.id, c.id));
}