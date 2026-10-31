// One-off (#26): purchase events for the Cart items bought before Restock existed. Run: npx tsx scripts/backfill-purchases.ts
// Refuses the production branch (prod-guard). Idempotent: an item that already has an event (source_id = the
// cart_items id) is skipped, so running it twice writes nothing more.
//
// cart_items has no updated_at, so the day it was bought is, in order: the Expense day of the paid Checkout that
// snapshotted it; else the Expense day of the Group's first "marked the Cart bought" after the item was added; else
// the day it was added. Personal = whoever added it, unless it was shared.
import "../src/lib/env";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "../src/db";
import { dayInZone } from "../src/lib/time";
import { insertPurchases, recordedSources, type PurchaseInput } from "../src/services/restock";
import { assertNotProdDb } from "./lib/prod-guard";

const { cartItems, cartCheckouts, activity, expenses, groups } = schema;

export type BackfillCounts = { groups: number; purchased: number; written: number; skipped: number };

export async function backfillPurchases(opts: { groupId?: string } = {}): Promise<BackfillCounts> {
  await assertNotProdDb(db, "backfill-purchases");
  const counts: BackfillCounts = { groups: 0, purchased: 0, written: 0, skipped: 0 };
  const groupRows = await db.select({ id: groups.id, tz: groups.timezone }).from(groups).where(opts.groupId ? eq(groups.id, opts.groupId) : undefined);
  for (const g of groupRows) {
    const items = await db.select().from(cartItems).where(and(eq(cartItems.groupId, g.id), eq(cartItems.status, "purchased"))).orderBy(asc(cartItems.createdAt));
    if (!items.length) continue;
    counts.groups++;
    counts.purchased += items.length;
    const done = await recordedSources(g.id, items.map((i) => i.id));

    const expenseDay = new Map(
      (await db.select({ id: expenses.id, day: expenses.occurredOn }).from(expenses).where(eq(expenses.groupId, g.id))).map((e) => [e.id, e.day]),
    );
    const byCheckout = new Map<string, string>();
    for (const c of await db.select().from(cartCheckouts).where(and(eq(cartCheckouts.groupId, g.id), isNotNull(cartCheckouts.paidAt)))) {
      const day = (c.expenseId && expenseDay.get(c.expenseId)) || dayInZone(g.tz, c.paidAt!);
      for (const s of c.itemsSnapshot) if (!byCheckout.has(s.id)) byCheckout.set(s.id, day);
    }
    const bought = await db
      .select({ at: activity.createdAt, refId: activity.refId })
      .from(activity)
      .where(and(eq(activity.groupId, g.id), eq(activity.kind, "cart.purchased")))
      .orderBy(asc(activity.createdAt));

    const rows: PurchaseInput[] = [];
    for (const i of items) {
      if (done.has(i.id)) {
        counts.skipped++;
        continue;
      }
      const after = bought.find((b) => b.at >= i.createdAt);
      const day = byCheckout.get(i.id) ?? (after ? ((after.refId && expenseDay.get(after.refId)) || dayInZone(g.tz, after.at)) : dayInZone(g.tz, i.createdAt));
      rows.push({ name: i.name, memberId: i.shared ? null : i.addedBy, occurredOn: day, source: "cart", sourceId: i.id });
    }
    counts.written += await insertPurchases(db, g.id, rows);
  }
  return counts;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/backfill-purchases.ts")) {
  const counts = await backfillPurchases();
  console.log(`backfill-purchases: ${counts.groups} groups, ${counts.purchased} purchased items, ${counts.written} events written, ${counts.skipped} already there`);
  await db.$client.end();
}
