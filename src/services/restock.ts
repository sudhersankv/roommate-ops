// Restock (#26): what the Group buys and how often, so Roomie can say what's probably low before it runs out. Purchase
// events are derived (the Cart marked bought, receipt lines), never a second ledger; the estimate is pure, in
// restock-math.ts. Mutes ("we don't buy dish soap anymore") live next to the Pantry in the Groceries Toolkit's
// settings (group_toolkits.settings.restockMutes). No prices anywhere.
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizeItem, sameItem } from "@/lib/items";
import { groceries } from "@/toolkits/groceries/manifest";
import { daytimeHour } from "@/lib/quiet-hours";
import { addDaysToDay, dayInZone } from "@/lib/time";
import { record, sourceOf } from "./activity";
import { requireActive } from "./authz";
import { addItems, listOpenItems } from "./cart";
import { listMembers } from "./members";
import { mayPost, sendDms, type DmOutcome } from "./rent";
import { restockCandidates, restockLine, type PurchaseEvent, type RestockCandidate } from "./restock-math";
import { bundleWindow, claimPost, getSchedule, groupTimezone } from "./schedule";
import type { Ctx, GroupCtx } from "./types";

const { purchaseEvents, groupToolkits, expenses } = schema;
/** The Groceries row of group_toolkits holds the mutes, next to the Pantry. */
const GROCERIES = groceries.id;

export type PurchaseSource = "cart" | "receipt";
export type PurchaseInput = { name: string; memberId: string | null; occurredOn: string; source: PurchaseSource; sourceId: string | null };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/** The window the estimate reads: a habit older than a year says little about this week. */
const HISTORY_DAYS = 400;
const MAX_MUTES = 100;

/** Insert purchase events (names normalized), on `exec` so the Cart's "bought" transaction can include them. */
export async function insertPurchases(exec: Exec, groupId: string, items: readonly PurchaseInput[]): Promise<number> {
  const rows = items
    .map((i) => ({ groupId, item: normalizeItem(i.name), memberId: i.memberId, occurredOn: i.occurredOn, source: i.source, sourceId: i.sourceId }))
    .filter((r) => r.item);
  if (rows.length) await exec.insert(purchaseEvents).values(rows);
  return rows.length;
}

export async function recordPurchases(ctx: Ctx, items: readonly PurchaseInput[]): Promise<number> {
  await requireActive(ctx);
  return insertPurchases(db, ctx.groupId, items);
}

/** The Group's local day for `now`. */
export async function localDay(groupId: string, now = new Date()): Promise<string> {
  return dayInZone(await groupTimezone(groupId), now);
}

/**
 * A receipt's lines as purchases (for expense_from_receipt to call once it has logged the Expense): one event per
 * line, personal when one Member claimed it, shared otherwise, on the Expense's day. Once per Expense: a second call
 * writes nothing.
 */
export async function recordReceiptPurchases(ctx: Ctx, expenseId: string, lines: readonly { name: string; claimedBy?: string | null }[]): Promise<number> {
  await requireActive(ctx);
  const [e] = await db.select({ occurredOn: expenses.occurredOn }).from(expenses).where(and(eq(expenses.id, expenseId), eq(expenses.groupId, ctx.groupId)));
  if (!e) throw new Error("That expense isn't here anymore.");
  const done = await db.select({ id: purchaseEvents.id }).from(purchaseEvents).where(and(eq(purchaseEvents.groupId, ctx.groupId), eq(purchaseEvents.sourceId, expenseId))).limit(1);
  if (done.length) return 0;
  return insertPurchases(
    db,
    ctx.groupId,
    lines.map((l) => ({ name: l.name, memberId: l.claimedBy ?? null, occurredOn: e.occurredOn, source: "receipt" as const, sourceId: expenseId })),
  );
}

/** Receipts whose lines are things a Group restocks; a restaurant's "Ribeye steak" (food) isn't one. */
const RESTOCK_CATEGORIES = new Set(["groceries", "household"]);

/**
 * expense_from_receipt's hook, once it has logged the Expense: each line with the Members it went to (receiptSplits'
 * items). Claimed by exactly one Member -> theirs; shared, unclaimed or split between some -> shared. Only grocery and
 * household receipts count. Returns how many events were written.
 */
export async function recordReceiptItems(
  ctx: Ctx,
  expense: { id: string; category: string },
  items: readonly { name: string; memberIds: readonly string[] }[],
  everyone: readonly string[],
): Promise<number> {
  if (!RESTOCK_CATEGORIES.has(expense.category)) return 0;
  const solo = (ids: readonly string[]) => (ids.length === 1 && everyone.length > 1 ? ids[0] : null);
  return recordReceiptPurchases(ctx, expense.id, items.map((i) => ({ name: i.name, claimedBy: solo(i.memberIds) })));
}

async function eventsOf(groupId: string, today: string): Promise<PurchaseEvent[]> {
  return db
    .select({ item: purchaseEvents.item, memberId: purchaseEvents.memberId, occurredOn: purchaseEvents.occurredOn })
    .from(purchaseEvents)
    .where(and(eq(purchaseEvents.groupId, groupId), gte(purchaseEvents.occurredOn, addDaysToDay(today, -HISTORY_DAYS))));
}

/* ---------- mutes ---------- */

export async function getMutes(ctx: GroupCtx): Promise<string[]> {
  const [row] = await db
    .select({ settings: groupToolkits.settings })
    .from(groupToolkits)
    .where(and(eq(groupToolkits.groupId, ctx.groupId), eq(groupToolkits.toolkit, GROCERIES)));
  const list = (row?.settings as { restockMutes?: unknown } | undefined)?.restockMutes;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}

/** Change the mutes under a row lock, so two at once both stick (as the Pantry does). */
async function changeMutes(ctx: Ctx, change: (before: string[]) => string[]): Promise<string[]> {
  await requireActive(ctx);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ settings: groupToolkits.settings })
      .from(groupToolkits)
      .where(and(eq(groupToolkits.groupId, ctx.groupId), eq(groupToolkits.toolkit, GROCERIES)))
      .for("update");
    const raw = (row?.settings as { restockMutes?: unknown } | undefined)?.restockMutes;
    const list = change(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []).slice(0, MAX_MUTES);
    const value = { restockMutes: list };
    await tx
      .insert(groupToolkits)
      .values({ groupId: ctx.groupId, toolkit: GROCERIES, enabled: true, settings: value })
      .onConflictDoUpdate({
        target: [groupToolkits.groupId, groupToolkits.toolkit],
        set: { settings: sql`${groupToolkits.settings} || ${JSON.stringify(value)}::jsonb` },
      });
    return list;
  });
}

/** "We don't buy dish soap anymore": Roomie stops calling it low. Any active Member. Returns the item as stored. */
export async function mute(ctx: Ctx, name: string): Promise<{ item: string; mutes: string[] }> {
  const item = normalizeItem(name);
  if (!item) throw new Error("What should I stop mentioning?");
  const mutes = await changeMutes(ctx, (before) => (before.some((m) => sameItem(m, item)) ? before : [...before, item].sort()));
  await record(ctx.groupId, ctx.memberId, "restock.muted", `asked Roomie to stop mentioning ${item}`, undefined, sourceOf(ctx));
  return { item, mutes };
}

/** "Actually we do buy dish soap": mentioned again. `unmuted: false` when it wasn't muted. */
export async function unmute(ctx: Ctx, name: string): Promise<{ item: string; unmuted: boolean; mutes: string[] }> {
  const item = normalizeItem(name);
  let unmuted = false;
  const mutes = await changeMutes(ctx, (before) => {
    const kept = before.filter((m) => !sameItem(m, item));
    unmuted = kept.length !== before.length;
    return kept;
  });
  if (unmuted) await record(ctx.groupId, ctx.memberId, "restock.unmuted", `asked Roomie to mention ${item} again`, undefined, sourceOf(ctx));
  return { item, unmuted, mutes };
}

/* ---------- what's probably low ---------- */

/** Every probably-low item today, shared and personal, most overdue first. */
export async function candidates(ctx: GroupCtx, now = new Date()): Promise<RestockCandidate[]> {
  const today = await localDay(ctx.groupId, now);
  const [events, open, mutes] = await Promise.all([eventsOf(ctx.groupId, today), listOpenItems(ctx), getMutes(ctx)]);
  return restockCandidates(events, open, mutes, today);
}

/** Groceries' line in the morning Bundle: shared items only ("Probably low: milk, dish soap. Add them?"). */
export async function restockBundleLine(ctx: GroupCtx, now = new Date()): Promise<string | null> {
  return restockLine((await candidates(ctx, now)).filter((c) => c.scope === "shared"));
}

/**
 * Each active Member's own probably-low items, with the line for their DM. Who gets one, and when (quiet hours, the
 * nudges switch), is the core slots' call: this only says what.
 */
export async function personalCandidates(ctx: GroupCtx, now = new Date()): Promise<{ memberId: string; candidates: RestockCandidate[]; line: string }[]> {
  const [all, people] = await Promise.all([candidates(ctx, now), listMembers(ctx)]);
  return people
    .filter((p) => p.status === "active")
    .map((p) => ({ memberId: p.id, candidates: all.filter((c) => c.scope === p.id) }))
    .filter((p) => p.candidates.length > 0)
    .map((p) => ({ ...p, line: restockLine(p.candidates, 4, { yours: true })! }));
}

/**
 * The personal restock DMs ("Probably low: your oat milk. Add it?"), in the Bundle's hour only (Groceries' bundle()
 * calls this, and Home's Today calls bundle() too), claimed once per local day per Member as scheduled_posts
 * "restock.dm" with period "<day>:<memberId>". Through core's sendNudge: quiet hours, "stop nudging me" and a paused
 * Group apply; no DM path -> the neutral Start hint (rent.ts sendDms). A "yes" in the DM is restock_add_listed "mine".
 */
export async function restockDmJob(ctx: GroupCtx, now = new Date()): Promise<DmOutcome[]> {
  const [tz, sched] = await Promise.all([groupTimezone(ctx.groupId), getSchedule(ctx)]);
  const hour = sched.nudgeHour === null ? null : daytimeHour(sched.nudgeHour);
  if (!bundleWindow(now, tz, hour).open || !(await mayPost(ctx.groupId))) return [];
  const day = dayInZone(tz, now);
  const out: DmOutcome[] = [];
  for (const p of await personalCandidates(ctx, now)) {
    if (!(await claimPost(ctx.groupId, "restock.dm", `${day}:${p.memberId}`))) continue;
    out.push(...(await sendDms(ctx.groupId, [{ memberId: p.memberId, text: p.line, buttons: [] }], now)));
  }
  return out;
}

/**
 * What a Member may hear is probably low: shared items, plus their own with `mine` (in a DM or on their dashboard,
 * never in the group chat: the group isn't told what one person eats). Already open in the Cart is never listed.
 */
export async function lowFor(ctx: Ctx, opts: { mine?: boolean; now?: Date } = {}): Promise<RestockCandidate[]> {
  return (await candidates(ctx, opts.now)).filter((c) => c.scope === "shared" || (opts.mine && c.scope === ctx.memberId));
}

/** At Checkout: the probably-low items not in the Cart (shared; the asker's own too with `mine`). */
export async function checkoutSuggestions(ctx: Ctx, opts: { mine?: boolean; now?: Date } = {}): Promise<string[]> {
  return (await lowFor(ctx, opts)).map((c) => c.item);
}

/**
 * "Yes" after a restock line: today's candidates of that scope go in the Cart (shared ones as shared, "mine" for the
 * asker), or only the ones named in `only` ("just the milk"). Returns what went in.
 */
export async function restockAddListed(ctx: Ctx, scope: "shared" | "mine", opts: { only?: string[]; now?: Date } = {}): Promise<string[]> {
  await requireActive(ctx);
  const listed = (await candidates(ctx, opts.now)).filter((c) => (scope === "shared" ? c.scope === "shared" : c.scope === ctx.memberId));
  const picked = opts.only?.length ? listed.filter((c) => opts.only!.some((o) => sameItem(o, c.item))) : listed;
  if (!picked.length) return [];
  await addItems(ctx, { items: picked.map((c) => ({ name: c.item })), shared: scope === "shared" });
  return picked.map((c) => c.item);
}

/** The Cart page's "Probably low" section for the signed-in Member: shared items and their own. */
export async function probablyLowView(session: Ctx, now = new Date()): Promise<{ item: string; lastBought: string; scope: "shared" | "mine" }[]> {
  return (await lowFor(session, { mine: true, now }))
    .map((c) => ({ item: c.item, lastBought: c.lastBought, scope: c.scope === "shared" ? ("shared" as const) : ("mine" as const) }));
}

/** Purchase events already written for these sources (the backfill skips them). */
export async function recordedSources(groupId: string, sourceIds: string[]): Promise<Set<string>> {
  if (!sourceIds.length) return new Set();
  const rows = await db
    .select({ id: purchaseEvents.sourceId })
    .from(purchaseEvents)
    .where(and(eq(purchaseEvents.groupId, groupId), inArray(purchaseEvents.sourceId, sourceIds)));
  return new Set(rows.map((r) => r.id!).filter(Boolean));
}
