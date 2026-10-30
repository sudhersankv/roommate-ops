// Splitwise, the business side (ADR 0004): connect (an Admin's own Splitwise through Composio), import a Splitwise
// group (people + full history), a one-time export, and the live mirror (pushes queued in the outbox, ADR 0009).
// Two-way sync is out of scope. Every amount is integer cents; Splitwise's decimal strings are converted at the edge.
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ExpenseCategory } from "@/db/enums";
import { splitwiseAvailability, splitwiseClient, SplitwiseNotConnectedError, type SplitwiseAvailability, type SwExpense, type SwExpenseInput, type SwGroup, type SwShare } from "@/integrations/splitwise";
import { dashboardUrl } from "@/lib/urls";
import { recordFor } from "./activity";
import { requireAdmin } from "./authz";
import { guessCategory } from "./categories";
import { insertExpenseRows, listExpenses } from "./money";
import { dueJobs, markDone, markFailed, pendingCount } from "./outbox";
import { dollars, type Ctx, type GroupCtx } from "./types";

const { splitwiseLinks, members, accounts, expenses, expenseExternalRefs, settlements, settlementExternalRefs, groups } = schema;

export { SplitwiseNotConnectedError };
export type SplitwiseLink = typeof splitwiseLinks.$inferSelect;

/** The Composio user for a Member: their Account id (ADR 0004: connections belong to one Member's Account). */
async function composioUserFor(memberId: string): Promise<string> {
  const [m] = await db.select({ accountId: members.accountId }).from(members).where(eq(members.id, memberId));
  return m?.accountId ?? `member-${memberId}`;
}

async function getLink(groupId: string): Promise<SplitwiseLink | undefined> {
  const [l] = await db.select().from(splitwiseLinks).where(eq(splitwiseLinks.groupId, groupId));
  return l;
}

async function linkedUser(groupId: string): Promise<{ link: SplitwiseLink; userId: string }> {
  const link = await getLink(groupId);
  if (!link?.connectedBy) throw new SplitwiseNotConnectedError();
  return { link, userId: await composioUserFor(link.connectedBy) };
}

export type SplitwiseState = {
  availability: SplitwiseAvailability;
  connected: boolean;
  connectedByName: string | null;
  splitwiseGroup: { id: string; name: string } | null;
  mode: "import" | "mirror" | null;
  lastSyncedAt: Date | null;
  pendingPushes: number;
};

export async function splitwiseState(ctx: GroupCtx): Promise<SplitwiseState> {
  const [availability, link, pending] = await Promise.all([splitwiseAvailability(), getLink(ctx.groupId), pendingCount(ctx.groupId)]);
  let connectedByName: string | null = null;
  if (link?.connectedBy) {
    const [m] = await db.select({ name: members.displayName }).from(members).where(eq(members.id, link.connectedBy));
    connectedByName = m?.name ?? null;
  }
  return {
    availability,
    connected: !!link?.connectedBy,
    connectedByName,
    splitwiseGroup: link?.splitwiseGroupId ? { id: link.splitwiseGroupId, name: link.splitwiseGroupName ?? "Splitwise group" } : null,
    mode: link?.mode ?? null,
    lastSyncedAt: link?.lastSyncedAt ?? null,
    pendingPushes: pending,
  };
}

const callbackFor = (groupId: string) => dashboardUrl(`/g/${groupId}/settings/splitwise/callback`) ?? `/g/${groupId}/settings/splitwise/callback`;

/**
 * Admin: start connecting the Admin's own Splitwise. Returns Composio's sign-in URL, or connects straight away when
 * that Account already has a live Splitwise connection (and always with the fake).
 */
export async function connectSplitwise(ctx: Ctx): Promise<{ connected: true } | { connected: false; url: string }> {
  await requireAdmin(ctx);
  const sw = splitwiseClient();
  const userId = await composioUserFor(ctx.memberId);
  if (await sw.isConnected(userId)) return (await finishConnect(ctx), { connected: true });
  const url = await sw.connectUrl(userId, callbackFor(ctx.groupId));
  if (await sw.isConnected(userId)) return (await finishConnect(ctx), { connected: true });
  return { connected: false, url };
}

/** Admin, after Composio's redirect: check the connection really is live and remember who made it. */
export async function finishConnect(ctx: Ctx): Promise<{ splitwiseUser: string }> {
  await requireAdmin(ctx);
  const sw = splitwiseClient();
  const userId = await composioUserFor(ctx.memberId);
  if (!(await sw.isConnected(userId))) throw new SplitwiseNotConnectedError("Splitwise didn't finish connecting. Try Connect again.");
  const me = await sw.currentUser(userId);
  await db
    .insert(splitwiseLinks)
    .values({ groupId: ctx.groupId, connectedBy: ctx.memberId })
    .onConflictDoUpdate({ target: splitwiseLinks.groupId, set: { connectedBy: ctx.memberId } });
  await recordFor(ctx, "splitwise.connected", "connected Splitwise", { table: "groups", id: ctx.groupId });
  return { splitwiseUser: `${me.firstName} ${me.lastName}`.trim() };
}

export async function disconnectSplitwise(ctx: Ctx): Promise<void> {
  await requireAdmin(ctx);
  await db.delete(splitwiseLinks).where(eq(splitwiseLinks.groupId, ctx.groupId));
  await recordFor(ctx, "splitwise.disconnected", "disconnected Splitwise", { table: "groups", id: ctx.groupId });
}

/** Admin: the connected Splitwise account's groups. */
export async function listSplitwiseGroups(ctx: Ctx): Promise<{ id: string; name: string; memberNames: string[] }[]> {
  await requireAdmin(ctx);
  const { userId } = await linkedUser(ctx.groupId);
  return (await splitwiseClient().groups(userId)).map((g) => ({ id: g.id, name: g.name, memberNames: g.members.map((m) => `${m.firstName} ${m.lastName}`.trim()) }));
}

/* ---------- people ---------- */

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim() || "Splitwise friend";

/**
 * Match Splitwise people to Members: by email (the Member's Account), then by name (full, then first). With
 * `createMissing`, anyone left over becomes a Pending member named after them (an Admin approves them as usual).
 */
async function matchPeople(groupId: string, sw: SwGroup, createMissing: boolean): Promise<{ map: Record<string, string>; created: string[]; unmatched: string[] }> {
  const ours = await db
    .select({ id: members.id, name: members.displayName, status: members.status, email: accounts.email })
    .from(members)
    .leftJoin(accounts, eq(members.accountId, accounts.id))
    .where(eq(members.groupId, groupId));
  const live = ours.filter((m) => m.status !== "removed");
  const map: Record<string, string> = {}; // our member id -> splitwise user id
  const used = new Set<string>();
  const created: string[] = [];
  const unmatched: string[] = [];
  const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  for (const u of sw.members) {
    const pick = (pred: (m: (typeof live)[number]) => boolean) => live.find((m) => !used.has(m.id) && pred(m));
    const hit =
      (u.email ? pick((m) => lc(m.email) === lc(u.email)) : undefined) ??
      pick((m) => lc(m.name) === lc(fullName(u))) ??
      (u.firstName ? pick((m) => lc(m.name) === lc(u.firstName) || lc(m.name).split(/\s+/)[0] === lc(u.firstName)) : undefined);
    if (hit) {
      used.add(hit.id);
      map[hit.id] = u.id;
    } else if (createMissing) {
      const [m] = await db.insert(members).values({ groupId, displayName: fullName(u), status: "pending" }).returning();
      map[m.id] = u.id;
      used.add(m.id);
      created.push(m.displayName);
    } else unmatched.push(fullName(u));
  }
  return { map, created, unmatched };
}

async function linkGroup(ctx: Ctx, splitwiseGroupId: string, createMissing: boolean) {
  const { userId } = await linkedUser(ctx.groupId);
  const sw = await splitwiseClient().group(userId, splitwiseGroupId);
  const people = await matchPeople(ctx.groupId, sw, createMissing);
  await db.update(splitwiseLinks).set({ splitwiseGroupId: sw.id, splitwiseGroupName: sw.name, memberMap: people.map }).where(eq(splitwiseLinks.groupId, ctx.groupId));
  return { userId, sw, ...people };
}

/* ---------- import ---------- */

const CATEGORY_MAP: [RegExp, ExpenseCategory][] = [
  [/dining|restaurant|food and drink|liquor/i, "food"],
  [/grocer/i, "groceries"],
  [/rent|mortgage/i, "rent"],
  [/electric|heat|gas\/|water|tv|phone|internet|utilit|trash/i, "utilities"],
  [/taxi|bus|train|car|fuel|gas\/fuel|parking|bicycle|transport/i, "transport"],
  [/movie|game|music|sport|entertainment/i, "entertainment"],
  [/household|furniture|cleaning|maintenance|electronics|home|pets|services/i, "household"],
  [/hotel|plane|travel/i, "travel"],
  [/medical|health|insurance/i, "health"],
];
const mapCategory = (e: SwExpense): ExpenseCategory => (e.category && CATEGORY_MAP.find(([re]) => re.test(e.category!))?.[1]) || guessCategory(e.description);

export type ImportResult = { expenses: number; settlements: number; skipped: { duplicate: number; deleted: number; otherCurrency: number; unreadable: number }; newMembers: string[]; splitwiseGroup: string };

/**
 * Admin: link a Splitwise group and import its people and full history. Splitwise's owed_share becomes exact Shares
 * and paid_share the Payers; "payments" become Settlements. Already-imported ids are skipped, so it's safe to re-run.
 */
export async function importSplitwiseGroup(ctx: Ctx, input: { splitwiseGroupId: string }): Promise<ImportResult> {
  await requireAdmin(ctx);
  const { userId, sw, map, created } = await linkGroup(ctx, input.splitwiseGroupId, true);
  const bySw = new Map(Object.entries(map).map(([ours, theirs]) => [theirs, ours]));
  const [group] = await db.select().from(groups).where(eq(groups.id, ctx.groupId));
  const history = await splitwiseClient().expenses(userId, sw.id);
  const live = history.filter((e) => !e.deleted);

  // An empty Group takes the Splitwise group's currency when it's all one currency.
  const hasExpenses = (await db.select({ id: expenses.id }).from(expenses).where(eq(expenses.groupId, ctx.groupId)).limit(1)).length > 0;
  const currencies = new Set(live.map((e) => e.currency));
  let currency = group.currency;
  if (!hasExpenses && currencies.size === 1 && !currencies.has(currency)) {
    currency = [...currencies][0];
    await db.update(groups).set({ currency }).where(eq(groups.id, ctx.groupId));
  }

  const result: ImportResult = { expenses: 0, settlements: 0, skipped: { duplicate: 0, deleted: history.length - live.length, otherCurrency: 0, unreadable: 0 }, newMembers: created, splitwiseGroup: sw.name };
  // Already in this Group (deleted ones too, so a deleted import stays deleted).
  const [knownE, knownS] = await Promise.all([
    db
      .select({ id: expenseExternalRefs.externalId })
      .from(expenseExternalRefs)
      .innerJoin(expenses, eq(expenses.id, expenseExternalRefs.expenseId))
      .where(and(eq(expenseExternalRefs.provider, "splitwise"), eq(expenses.groupId, ctx.groupId))),
    db
      .select({ id: settlementExternalRefs.externalId })
      .from(settlementExternalRefs)
      .innerJoin(settlements, eq(settlements.id, settlementExternalRefs.settlementId))
      .where(and(eq(settlementExternalRefs.provider, "splitwise"), eq(settlements.groupId, ctx.groupId))),
  ]);
  const known = new Set([...knownE, ...knownS].map((r) => r.id));

  for (const e of [...live].reverse()) {
    if (known.has(e.id)) {
      result.skipped.duplicate++;
      continue;
    }
    if (e.currency !== currency) {
      result.skipped.otherCurrency++;
      continue;
    }
    const mapped = e.users.map((u) => ({ ...u, memberId: bySw.get(u.userId) }));
    if (mapped.some((u) => !u.memberId) || e.costCents <= 0) {
      result.skipped.unreadable++;
      continue;
    }
    const payers = mapped.filter((u) => u.paidCents > 0).map((u) => ({ memberId: u.memberId!, cents: u.paidCents })).sort((a, b) => b.cents - a.cents);
    const rows = mapped.filter((u) => u.owedCents > 0).map((u) => ({ memberId: u.memberId!, cents: u.owedCents }));
    const sum = (xs: { cents: number }[]) => xs.reduce((s, x) => s + x.cents, 0);
    if (!payers.length || !rows.length || sum(payers) !== e.costCents || sum(rows) !== e.costCents) {
      result.skipped.unreadable++;
      continue;
    }
    if (e.payment) {
      if (payers.length !== 1 || rows.length !== 1 || payers[0].memberId === rows[0].memberId) {
        result.skipped.unreadable++;
        continue;
      }
      await db.transaction(async (tx) => {
        const [s] = await tx.insert(settlements).values({ groupId: ctx.groupId, fromId: payers[0].memberId, toId: rows[0].memberId, cents: e.costCents, ...(e.createdAt ? { createdAt: e.createdAt } : {}) }).returning();
        await tx.insert(settlementExternalRefs).values({ settlementId: s.id, provider: "splitwise", externalId: e.id });
      });
      result.settlements++;
      continue;
    }
    await db.transaction(async (tx) => {
      const id = await insertExpenseRows(
        ctx.groupId,
        ctx.memberId,
        { cents: e.costCents, description: e.description, method: "exact", payers, rows, category: mapCategory(e), note: e.notes, occurredOn: e.date, recurring: null, receiptUrl: null, source: "splitwise", ...(e.createdAt ? { createdAt: e.createdAt } : {}) },
        tx,
      );
      await tx.insert(expenseExternalRefs).values({ expenseId: id!, provider: "splitwise", externalId: e.id });
    });
    result.expenses++;
  }

  const link = await getLink(ctx.groupId);
  await db.update(splitwiseLinks).set({ mode: link?.mode === "mirror" ? "mirror" : "import", lastSyncedAt: new Date() }).where(eq(splitwiseLinks.groupId, ctx.groupId));
  const extra = [result.settlements ? `${result.settlements} payment${result.settlements === 1 ? "" : "s"}` : "", created.length ? `added ${created.join(", ")} as pending` : ""].filter(Boolean).join("; ");
  await recordFor(ctx, "splitwise.imported", `imported ${result.expenses} expense${result.expenses === 1 ? "" : "s"} from Splitwise (${sw.name})${extra ? `; ${extra}` : ""}`, { table: "groups", id: ctx.groupId });
  return result;
}

/* ---------- export and the mirror ---------- */

async function toSplitwise(groupId: string, expenseId: string, link: SplitwiseLink): Promise<SwExpenseInput> {
  const [e] = await listExpenses({ groupId }, 1, { expenseId });
  if (!e) throw new Error("That expense is gone.");
  const [g] = await db.select({ currency: groups.currency }).from(groups).where(eq(groups.id, groupId));
  const users = new Map<string, SwShare>();
  const swId = (memberId: string, name: string) => {
    const id = link.memberMap[memberId];
    if (!id) throw new Error(`${name} isn't in the Splitwise group "${link.splitwiseGroupName}".`);
    return id;
  };
  const at = (memberId: string, name: string) => {
    const id = swId(memberId, name);
    return users.get(id) ?? (users.set(id, { userId: id, paidCents: 0, owedCents: 0 }), users.get(id)!);
  };
  for (const p of e.payers ?? []) at(p.memberId, p.name).paidCents += p.cents;
  for (const s of e.splits ?? []) at(s.memberId, s.name).owedCents += s.cents;
  return { groupId: link.splitwiseGroupId!, description: e.description, costCents: e.cents, currency: g.currency, date: e.occurredOn ?? new Date().toISOString().slice(0, 10), notes: e.note, users: [...users.values()] };
}

async function refOf(expenseId: string): Promise<string | undefined> {
  const [r] = await db.select({ id: expenseExternalRefs.externalId }).from(expenseExternalRefs).where(and(eq(expenseExternalRefs.expenseId, expenseId), eq(expenseExternalRefs.provider, "splitwise")));
  return r?.id;
}

/** Create or update this Expense in Splitwise (or delete it there when it's deleted here). Idempotent by ref. */
export async function pushExpense(groupId: string, expenseId: string): Promise<"created" | "updated" | "deleted" | "nothing"> {
  const { link, userId } = await linkedUser(groupId);
  if (!link.splitwiseGroupId) throw new Error("No Splitwise group is linked yet.");
  const sw = splitwiseClient();
  const [row] = await db.select({ deletedAt: expenses.deletedAt }).from(expenses).where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId)));
  const ref = await refOf(expenseId);
  if (!row || row.deletedAt) {
    if (!ref) return "nothing";
    await sw.deleteExpense(userId, ref);
    await db.delete(expenseExternalRefs).where(and(eq(expenseExternalRefs.expenseId, expenseId), eq(expenseExternalRefs.provider, "splitwise")));
    return "deleted";
  }
  const body = await toSplitwise(groupId, expenseId, link);
  if (ref) {
    await sw.updateExpense(userId, ref, body);
    return "updated";
  }
  const { id } = await sw.createExpense(userId, body);
  await db.insert(expenseExternalRefs).values({ expenseId, provider: "splitwise", externalId: id }).onConflictDoNothing();
  return "created";
}

export type ExportResult = { expenses: number; settlements: number; skipped: { expense: string; why: string }[]; splitwiseGroup: string };

/**
 * Admin: a one-time copy of everything Splitwise doesn't have yet (Expenses and Settlements without a ref) into the
 * linked Splitwise group. Links `splitwiseGroupId` first when given.
 */
export async function exportToSplitwise(ctx: Ctx, input: { splitwiseGroupId?: string } = {}): Promise<ExportResult> {
  await requireAdmin(ctx);
  if (input.splitwiseGroupId) await linkGroup(ctx, input.splitwiseGroupId, false);
  const { link, userId } = await linkedUser(ctx.groupId);
  if (!link.splitwiseGroupId) throw new Error("Pick a Splitwise group to export to first.");
  const result: ExportResult = { expenses: 0, settlements: 0, skipped: [], splitwiseGroup: link.splitwiseGroupName ?? "Splitwise" };

  const todo = await db
    .select({ id: expenses.id, description: expenses.description })
    .from(expenses)
    .leftJoin(expenseExternalRefs, and(eq(expenseExternalRefs.expenseId, expenses.id), eq(expenseExternalRefs.provider, "splitwise")))
    .where(and(eq(expenses.groupId, ctx.groupId), isNull(expenses.deletedAt), isNull(expenseExternalRefs.externalId)));
  for (const e of todo) {
    try {
      if ((await pushExpense(ctx.groupId, e.id)) === "created") result.expenses++;
    } catch (err) {
      result.skipped.push({ expense: e.description, why: err instanceof Error ? err.message : String(err) });
    }
  }

  const [g] = await db.select({ currency: groups.currency }).from(groups).where(eq(groups.id, ctx.groupId));
  const payments = await db
    .select({ id: settlements.id, fromId: settlements.fromId, toId: settlements.toId, cents: settlements.cents, createdAt: settlements.createdAt })
    .from(settlements)
    .leftJoin(settlementExternalRefs, eq(settlementExternalRefs.settlementId, settlements.id))
    .where(and(eq(settlements.groupId, ctx.groupId), isNull(settlementExternalRefs.externalId)));
  for (const s of payments) {
    const from = link.memberMap[s.fromId];
    const to = link.memberMap[s.toId];
    if (!from || !to) {
      result.skipped.push({ expense: `payment of ${dollars(s.cents)}`, why: "someone in it isn't in the Splitwise group" });
      continue;
    }
    const { id } = await splitwiseClient().createExpense(userId, {
      groupId: link.splitwiseGroupId,
      description: "Payment",
      costCents: s.cents,
      currency: g.currency,
      date: s.createdAt.toISOString().slice(0, 10),
      payment: true,
      users: [
        { userId: from, paidCents: s.cents, owedCents: 0 },
        { userId: to, paidCents: 0, owedCents: s.cents },
      ],
    });
    await db.insert(settlementExternalRefs).values({ settlementId: s.id, provider: "splitwise", externalId: id }).onConflictDoNothing();
    result.settlements++;
  }

  await db.update(splitwiseLinks).set({ lastSyncedAt: new Date() }).where(eq(splitwiseLinks.groupId, ctx.groupId));
  await recordFor(ctx, "splitwise.exported", `copied ${result.expenses} expense${result.expenses === 1 ? "" : "s"} to Splitwise (${result.splitwiseGroup})`, { table: "groups", id: ctx.groupId });
  return result;
}

/** Admin: live mirror on (every add/change/delete is pushed to Splitwise in the background) or off. */
export async function setSplitwiseMirror(ctx: Ctx, input: { on: boolean; splitwiseGroupId?: string }): Promise<{ mode: "import" | "mirror" | null }> {
  await requireAdmin(ctx);
  if (input.splitwiseGroupId) await linkGroup(ctx, input.splitwiseGroupId, false);
  const { link } = await linkedUser(ctx.groupId);
  if (input.on && !link.splitwiseGroupId) throw new Error("Pick a Splitwise group to mirror to first.");
  const mode = input.on ? "mirror" : link.mode === "mirror" ? "import" : link.mode;
  await db.update(splitwiseLinks).set({ mode }).where(eq(splitwiseLinks.groupId, ctx.groupId));
  await recordFor(ctx, "splitwise.mirror", input.on ? "turned on the Splitwise mirror" : "turned off the Splitwise mirror", { table: "groups", id: ctx.groupId });
  return { mode };
}

/** Scheduler tick: run due mirror pushes. Failures are retried with backoff (outbox.ts). Never throws. */
export async function runSplitwiseOutbox(now = new Date()): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (const job of await dueJobs(now)) {
    try {
      await pushExpense(job.groupId, job.payload.expenseId);
      await markDone(job.id);
      done++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[splitwise] push ${job.payload.op} ${job.payload.expenseId} failed (attempt ${job.attempts + 1}): ${message}`);
      await markFailed(job, message, now);
    }
  }
  return { done, failed };
}
