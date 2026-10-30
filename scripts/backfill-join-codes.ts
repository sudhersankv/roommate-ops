// One-off after migration 0011 (ADR 0014): give every Group without a Join code one. Codes are also minted lazily on
// first read (services/joins.ts ensureJoinCode), so this is only for having them all at once (e.g. before posting
// Join links by hand). Safe to run twice. Run: npx tsx scripts/backfill-join-codes.ts
import "../src/lib/env";
import { isNull, sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { ensureJoinCode } from "../src/services/joins";

const missing = await db.select({ id: schema.groups.id }).from(schema.groups).where(isNull(schema.groups.joinCode));
for (const g of missing) await ensureJoinCode(g.id);
const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows;
console.log(`join codes: ${missing.length} Group${missing.length === 1 ? "" : "s"} backfilled; migrations recorded: ${n}`);
await db.$client.end();
