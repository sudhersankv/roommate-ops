// Rent (#25, ADR 0019): the Group's rent is its recurring monthly Expense with category "rent" (no table of its own),
// one Payer (who pays the landlord) and Shares in any split method. Three local days before the due day Money's Bundle
// line says so and each person with a Share gets their own amount in a DM, with pay links to the Payer; on the due day
// the line comes back only while someone still owes the Payer. Never a Member's amount in the group. The day maths and
// the texts are pure (rent.test.ts); the DB side is in money-rent.dbtest.ts.
import { and, desc, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SplitMethod } from "@/db/enums";
import { CantMessagePrivatelyError, type Button, type Outgoing } from "@/channels/types";
import { roomiePaused } from "@/lib/kill-switch";
import { daytimeHour } from "@/lib/quiet-hours";
import { formatMoney } from "@/lib/money";
import { payLinks } from "@/lib/pay-links";
import { addDaysToDay, dayInZone, zonedTimeToUtc } from "@/lib/time";
import { NotAllowedError, requireActive } from "./authz";
import { listMembersWithHandles } from "./members";
import { getExpense, logExpense, updateExpense, type ExpenseInput } from "./money";
import { joinNames, type ReportPart } from "./report";
import { bundleWindow, claimPost, getSchedule, groupTimezone } from "./schedule";
import type { Ctx, GroupCtx } from "./types";

const { expenses, groups, petMoments, settlements } = schema;

export type RentShare = { memberId: string; name: string; cents: number };
export type Rent = {
  expenseId: string;
  description: string;
  cents: number;
  /** Day of the month, 1-28 (recurring clamps later days to the 28th). */
  dueDay: number;
  /** The parent's own day: the first month it was charged. */
  startsOn: string;
  payerId: string;
  payerName: string;
  method: SplitMethod;
  shares: RentShare[];
};

/* ---------- pure ---------- */

export const clampDueDay = (day: number) => Math.min(Math.max(Math.trunc(day), 1), 28);

/** "$2,400", "$800.50". */
export const shortMoney = (cents: number) => formatMoney(cents).replace(/\.00$/, "");

const weekdayOf = (day: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

/** The first day on or after `from` ("2026-10-30") that falls on day-of-month `dueDay` (clamped to 28). */
export function nextDueOnOrAfter(dueDay: number, from: string): string {
  const dom = String(clampDueDay(dueDay)).padStart(2, "0");
  const thisMonth = `${from.slice(0, 7)}-${dom}`;
  if (thisMonth >= from) return thisMonth;
  const y = Number(from.slice(0, 4));
  const m = Number(from.slice(5, 7));
  return m === 12 ? `${y + 1}-01-${dom}` : `${y}-${String(m + 1).padStart(2, "0")}-${dom}`;
}

/**
 * The next due day on or after today in the Group's zone, and the day three before it (when the group hears about
 * it and the DMs go out). Local days, so DST and late-night UTC dates don't move them.
 */
export function rentWindows(dueDay: number, tz: string, now: Date): { aheadDay: string; dueDay: string } {
  const due = nextDueOnOrAfter(dueDay, dayInZone(tz, now));
  return { aheadDay: addDaysToDay(due, -3), dueDay: due };
}

/** The group's line three days before. Who pays the landlord, never anyone's share. */
export function rentGroupLine(rent: Pick<Rent, "cents" | "payerName">, dueOn: string): string {
  return `🏠 Rent ${shortMoney(rent.cents)} is due ${weekdayOf(dueOn)}. ${rent.payerName} pays the landlord.`;
}

/** The due day's line, only while someone still owes the Payer: names, never amounts. */
export function rentDueLine(rent: Pick<Rent, "payerName">, stillOwing: string[]): string | null {
  return stillOwing.length ? `🏠 Rent is due today. ${rent.payerName}'s still waiting on ${joinNames(stillOwing)}.` : null;
}

export type RentDm = { memberId: string; cents: number; text: string; buttons: Button[] };

/** One private message per Share except the Payer's: their own amount and pay links to the Payer's handles. */
export function rentDmsFor(rent: Pick<Rent, "payerId" | "payerName" | "shares">, payerHandles: Parameters<typeof payLinks>[0], dueOn: string): RentDm[] {
  return rent.shares
    .filter((s) => s.memberId !== rent.payerId && s.cents > 0)
    .map((s) => {
      const buttons = payLinks(payerHandles, s.cents, { to: rent.payerName, note: "Rent" });
      const how = buttons.length
        ? `${rent.payerName} pays the landlord, so pay ${rent.payerName}.`
        : `${rent.payerName} pays the landlord; no pay link yet: ${rent.payerName} can tell me their Venmo, PayPal or Cash App.`;
      return { memberId: s.memberId, cents: s.cents, text: `Rent's due ${weekdayOf(dueOn)}: your share is ${shortMoney(s.cents)}. ${how}`, buttons };
    });
}

/** A Settlement as the rent line reads it: who paid whom, how much, on which local day. */
export type RentPayment = { fromId: string; toId: string; cents: number; day: string };

/**
 * Who still owes this month's rent: each Share but the Payer's that is more than what that Member has paid the Payer
 * since `since` (the day the rent DMs went out, three days before the due day). Only this occurrence's Shares and
 * Settlements to the Payer count: groceries owed to the Payer, or a debt the Settle plan routes elsewhere, don't.
 */
export function owingRent(payerId: string, shares: readonly RentShare[], paid: readonly RentPayment[], since: string): string[] {
  const paidBy = (memberId: string) => paid.filter((p) => p.fromId === memberId && p.toId === payerId && p.day >= since).reduce((sum, p) => sum + p.cents, 0);
  return shares.filter((s) => s.memberId !== payerId && s.cents > paidBy(s.memberId)).map((s) => s.name);
}

/* ---------- DB ---------- */

/** The Group's rent: its live recurring parent with category rent (the newest, if there were ever two), or null. */
export async function getRent(ctx: GroupCtx): Promise<Rent | null> {
  const [row] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.groupId, ctx.groupId), eq(expenses.category, "rent"), isNotNull(expenses.recurring), isNull(expenses.recurringParentId), isNull(expenses.deletedAt)))
    .orderBy(desc(expenses.createdAt))
    .limit(1);
  if (!row) return null;
  const e = await getExpense(ctx, row.id);
  if (!e?.payers?.length) return null;
  return {
    expenseId: e.id,
    description: e.description,
    cents: e.cents,
    dueDay: clampDueDay(Number(e.occurredOn!.slice(8, 10))),
    startsOn: e.occurredOn!,
    payerId: e.payers[0].memberId,
    payerName: e.payers[0].name,
    method: e.method ?? "equal",
    shares: (e.splits ?? []).map((s) => ({ memberId: s.memberId, name: s.name, cents: s.cents })).sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name)),
  };
}

export type RentInput = Pick<ExpenseInput, "method" | "splitAmong" | "splits" | "percents" | "shares" | "payerId"> & {
  cents?: number;
  /** Day of the month it's due (1-31; past the 28th means the 28th). */
  dueDay?: number;
};

const splitOf = (i: RentInput) => ({
  ...(i.method ? { method: i.method } : {}),
  ...(i.splitAmong ? { splitAmong: i.splitAmong } : {}),
  ...(i.splits ? { splits: i.splits } : {}),
  ...(i.percents ? { percents: i.percents } : {}),
  ...(i.shares ? { shares: i.shares } : {}),
});

/** The latest month already charged: the parent's own day or its newest copy (deleted copies count: they were charged). */
async function lastCharged(parentId: string): Promise<string> {
  const [r] = await db
    .select({ day: sql<string>`max(${expenses.occurredOn})::text` })
    .from(expenses)
    .where(or(eq(expenses.id, parentId), eq(expenses.recurringParentId, parentId)));
  return r.day;
}

/**
 * Set up or change the rent. New: the amount and the due day are needed; the Payer defaults to the sender, the split
 * to everyone evenly, and the first month is the next due day. A change is the Payer's or an Admin's. A parent not
 * charged yet is changed in place; once it has been, the old one stops repeating and a new parent starts at the next
 * due day not already charged, so past months keep what they were.
 */
export async function setRent(ctx: Ctx, input: RentInput, now = new Date()): Promise<Rent> {
  const actor = await requireActive(ctx);
  const tz = await groupTimezone(ctx.groupId);
  const today = dayInZone(tz, now);
  const current = await getRent(ctx);
  if (input.cents !== undefined && (!Number.isInteger(input.cents) || input.cents <= 0)) throw new Error("Rent must be more than $0.00.");
  if (input.dueDay !== undefined && (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31)) throw new Error("Which day of the month is rent due (1 to 31)?");

  if (!current) {
    if (!input.cents) throw new Error("How much is the rent?");
    if (!input.dueDay) throw new Error("Which day of the month is rent due?");
    await logExpense(ctx, {
      cents: input.cents,
      description: "Rent",
      category: "rent",
      recurring: "monthly",
      occurredOn: nextDueOnOrAfter(input.dueDay, today),
      payerId: input.payerId ?? ctx.memberId,
      ...splitOf(input),
    });
    return (await getRent(ctx))!;
  }

  if (actor.role !== "admin" && actor.id !== current.payerId) {
    throw new NotAllowedError(`Only ${current.payerName} (who pays the landlord) or an admin can change the rent.`, "not-yours");
  }
  const dueDay = input.dueDay ?? current.dueDay;
  const patch = { ...(input.cents ? { cents: input.cents } : {}), ...(input.payerId ? { payerId: input.payerId } : {}), ...splitOf(input) };

  if (current.startsOn > today) {
    await updateExpense(ctx, { expenseId: current.expenseId, ...patch, ...(input.dueDay ? { occurredOn: nextDueOnOrAfter(dueDay, today) } : {}) });
    return (await getRent(ctx))!;
  }

  // Already charged: copy it forward, change the copy, then stop the old one repeating.
  const after = addDaysToDay(await lastCharged(current.expenseId), 1);
  const startsOn = nextDueOnOrAfter(dueDay, after > today ? after : today);
  const old = (await getExpense(ctx, current.expenseId))!;
  const oldSplit: Partial<ExpenseInput> =
    old.method === "exact"
      ? { method: "exact", splits: current.shares.map((s) => ({ memberId: s.memberId, cents: s.cents })) }
      : old.method === "percent"
        ? { method: "percent", percents: (old.splits ?? []).map((s) => ({ memberId: s.memberId, percent: Number(s.weight ?? 0) })) }
        : old.method === "shares"
          ? { method: "shares", shares: (old.splits ?? []).map((s) => ({ memberId: s.memberId, shares: Number(s.weight ?? 0) })) }
          : { method: "equal", splitAmong: current.shares.map((s) => s.memberId) };
  const next = await logExpense(ctx, { cents: current.cents, description: current.description, category: "rent", recurring: "monthly", occurredOn: startsOn, payerId: current.payerId, ...oldSplit });
  try {
    await updateExpense(ctx, { expenseId: next.id, ...patch });
  } catch (e) {
    await db.delete(expenses).where(eq(expenses.id, next.id));
    throw e;
  }
  await updateExpense(ctx, { expenseId: current.expenseId, recurring: null });
  return (await getRent(ctx))!;
}

/** What rent_status and the dashboard read: ready-to-say strings. */
export function rentSummary(rent: Rent, tz: string, now = new Date()) {
  const w = rentWindows(rent.dueDay, tz, now);
  const next = rent.startsOn > w.dueDay ? rent.startsOn : w.dueDay;
  return {
    amount: shortMoney(rent.cents),
    dueDay: rent.dueDay,
    nextDue: next,
    nextDueWeekday: weekdayOf(next),
    paysLandlord: rent.payerName,
    method: rent.method,
    shares: rent.shares.map((s) => ({ name: s.name, share: shortMoney(s.cents) })),
  };
}

/* ---------- the offer (say-once) ---------- */

const OFFER_KEY = "once";

/** Claims the rent offer: true only the first time for the Group. */
export async function claimRentOffer(groupId: string): Promise<boolean> {
  const rows = await db.insert(petMoments).values({ groupId, kind: "rent-offer", key: OFFER_KEY }).onConflictDoNothing().returning({ key: petMoments.key });
  return rows.length > 0;
}

/** rent_status: the rent, or { rent: null, offer } where offer is true only the first time anyone asks. */
export async function rentStatus(ctx: GroupCtx, now = new Date()): Promise<{ rent: ReturnType<typeof rentSummary> | null; offer: boolean }> {
  const rent = await getRent(ctx);
  if (rent) return { rent: rentSummary(rent, await groupTimezone(ctx.groupId), now), offer: false };
  return { rent: null, offer: await claimRentOffer(ctx.groupId) };
}

export const RENT_OFFER_LINE = `Want me to keep track of rent? Say "roomie, rent is 2400 on the 1st, I pay it" and I'll tell everyone their share before it's due.`;

/** Money's report adds the offer once, while there's no rent and nobody was offered it yet. */
export async function rentOfferReportParts(ctx: GroupCtx): Promise<ReportPart[]> {
  if (await getRent(ctx)) return [];
  return (await claimRentOffer(ctx.groupId)) ? [{ icon: "🏠", text: RENT_OFFER_LINE }] : [];
}

/* ---------- the Bundle line and the DMs ---------- */

/** Money's rent line in the morning Bundle: three days before, then on the due day while someone still owes. */
export async function rentBundleLine(ctx: GroupCtx, now = new Date()): Promise<string | null> {
  const rent = await getRent(ctx);
  if (!rent) return null;
  const tz = await groupTimezone(ctx.groupId);
  const today = dayInZone(tz, now);
  const w = rentWindows(rent.dueDay, tz, now);
  if (rent.startsOn > w.dueDay) return null;
  if (today === w.aheadDay) return rentGroupLine(rent, w.dueDay);
  if (today === w.dueDay) {
    const since = addDaysToDay(w.dueDay, -3);
    const [shares, paid] = await Promise.all([occurrenceShares(ctx, rent, w.dueDay), paymentsTo(ctx.groupId, rent.payerId, tz, since)]);
    return shares ? rentDueLine(rent, owingRent(rent.payerId, shares, paid, since)) : null;
  }
  return null;
}

/** This month's rent Shares: its recurring copy's (the parent's until the copy is made), or null when it was deleted. */
async function occurrenceShares(ctx: GroupCtx, rent: Rent, dueOn: string): Promise<RentShare[] | null> {
  if (rent.startsOn === dueOn) return rent.shares;
  const [copy] = await db
    .select({ id: expenses.id, deletedAt: expenses.deletedAt })
    .from(expenses)
    .where(and(eq(expenses.groupId, ctx.groupId), eq(expenses.recurringParentId, rent.expenseId), eq(expenses.occurredOn, dueOn)));
  if (!copy) return rent.shares;
  if (copy.deletedAt) return null;
  const e = await getExpense(ctx, copy.id);
  return (e?.splits ?? []).map((s) => ({ memberId: s.memberId, name: s.name, cents: s.cents }));
}

/** Settlements to the Payer on or after the local day `since`. */
async function paymentsTo(groupId: string, payerId: string, tz: string, since: string): Promise<RentPayment[]> {
  const from = zonedTimeToUtc(tz, { year: Number(since.slice(0, 4)), month: Number(since.slice(5, 7)), day: Number(since.slice(8, 10)), hour: 0, minute: 0, second: 0 });
  const rows = await db
    .select({ fromId: settlements.fromId, toId: settlements.toId, cents: settlements.cents, at: settlements.createdAt })
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), eq(settlements.toId, payerId), gte(settlements.createdAt, from)));
  return rows.map((r) => ({ fromId: r.fromId, toId: r.toId, cents: r.cents, day: dayInZone(tz, r.at) }));
}

/** Each person's rent DM for the next due day (nothing when there's no rent). */
export async function rentDms(ctx: GroupCtx, now = new Date()): Promise<RentDm[]> {
  const rent = await getRent(ctx);
  if (!rent) return [];
  const [tz, people] = await Promise.all([groupTimezone(ctx.groupId), listMembersWithHandles(ctx)]);
  const handles = people.find((p) => p.id === rent.payerId)?.handles ?? {};
  return rentDmsFor(rent, handles, rentWindows(rent.dueDay, tz, now).dueDay);
}

/** Roomie may post for this Group right now: not paused, globally or for the Group. */
export async function mayPost(groupId: string): Promise<boolean> {
  if (roomiePaused()) return false;
  const [g] = await db.select({ pausedAt: groups.pausedAt }).from(groups).where(eq(groups.id, groupId));
  return !!g && !g.pausedAt;
}

/**
 * What happened to one DM: sent; held for 08:00 ("quiet", pending_posts); not sent ("off": they said "stop nudging me",
 * "paused", "not-member"); the Channel can't DM them yet, so core's neutral Start hint went to the group ("hint", never
 * the content) or not this week ("no-hint"); or the send failed.
 */
export type DmOutcome = { memberId: string; outcome: "sent" | "quiet" | "off" | "paused" | "not-member" | "hint" | "no-hint" | "failed" };

/** Send private nudges one by one through core's sendNudge (services/nudges.ts), with nudgeOrHint (services/dm.ts) when the Channel can't DM someone yet. */
export async function sendDms(groupId: string, dms: readonly Pick<RentDm, "memberId" | "text" | "buttons">[], now = new Date()): Promise<DmOutcome[]> {
  const [{ sendNudge }, { nudgeOrHint }] = await Promise.all([import("./nudges"), import("./dm")]);
  const out: DmOutcome[] = [];
  for (const dm of dms) {
    const msg: Outgoing = { text: dm.text, ...(dm.buttons.length ? { buttons: dm.buttons } : {}) };
    try {
      const r = await sendNudge(dm.memberId, msg, now);
      out.push({ memberId: dm.memberId, outcome: r.sent ? "sent" : r.reason });
    } catch (e) {
      if (e instanceof CantMessagePrivatelyError) {
        const r = await nudgeOrHint(dm.memberId, groupId, msg, now).catch(() => "failed" as const);
        out.push({ memberId: dm.memberId, outcome: r === "private" ? "sent" : r === "quiet" ? "no-hint" : r });
      } else {
        console.error(`[money] DM to member ${dm.memberId} failed:`, e instanceof Error ? e.message : e);
        out.push({ memberId: dm.memberId, outcome: "failed" });
      }
    }
  }
  return out;
}

/**
 * The rent DMs, once a month: only on the ahead day in the Bundle's hour, claimed as scheduled_posts "rent.ahead" for
 * the due month first. Called from Money's bundle() (the scheduler is untouched; Home's Today calls bundle() too,
 * which is why the hour is checked here). Returns what happened to each DM (none when it wasn't time).
 */
export async function rentDmJob(ctx: GroupCtx, now = new Date()): Promise<DmOutcome[]> {
  const rent = await getRent(ctx);
  if (!rent) return [];
  const [tz, sched] = await Promise.all([groupTimezone(ctx.groupId), getSchedule(ctx)]);
  const w = rentWindows(rent.dueDay, tz, now);
  if (rent.startsOn > w.dueDay || dayInZone(tz, now) !== w.aheadDay) return [];
  // The Bundle's own hour: a nudge hour inside quiet hours goes out at 08:00 (the scheduler's bundleJob, restockDmJob).
  const hour = sched.nudgeHour === null ? null : daytimeHour(sched.nudgeHour);
  if (!bundleWindow(now, tz, hour).open || !(await mayPost(ctx.groupId))) return [];
  if (!(await claimPost(ctx.groupId, "rent.ahead", w.dueDay.slice(0, 7)))) return [];
  return sendDms(ctx.groupId, await rentDms(ctx, now), now);
}
