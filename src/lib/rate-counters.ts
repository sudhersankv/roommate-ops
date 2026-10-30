// rate_counters in Postgres behind WindowLimiter.hit (lib/caps.ts). The DB client is imported on first use, so
// importing this file (the pipeline, unit tests) never builds one. A DB error lets the try through: a broken counter
// shouldn't silence Roomie, and the pipeline needs the DB for everything else anyway.
import type { CounterStore } from "./window-limit";

const dbOf = () => import("@/db");

export const pgCounters: CounterStore = {
  async hit(key, windowStart, max) {
    try {
      const { db } = await dbOf();
      const { sql } = await import("drizzle-orm");
      const res = await db.execute<{ count: number }>(sql`
        insert into rate_counters (key, window_start, count) values (${key}, ${windowStart.toISOString()}, 1)
        on conflict (key, window_start) do update set count = rate_counters.count + 1 where rate_counters.count < ${max}
        returning count`);
      return res.rows.length > 0;
    } catch (e) {
      console.warn(`[caps] couldn't count ${key}; letting it through`, e instanceof Error ? e.message : e);
      return true;
    }
  },
  async count(key, windowStart) {
    try {
      const { db } = await dbOf();
      const { sql } = await import("drizzle-orm");
      const res = await db.execute<{ count: number }>(sql`select count from rate_counters where key = ${key} and window_start = ${windowStart.toISOString()}`);
      return Number(res.rows[0]?.count ?? 0);
    } catch {
      return 0;
    }
  },
};

/** Drop windows that ended long ago (the scheduler, once a day). Returns how many rows went. */
export async function pruneRateCounters(now = new Date(), keepMs = 2 * 24 * 60 * 60 * 1000): Promise<number> {
  const { db } = await dbOf();
  const { sql } = await import("drizzle-orm");
  const res = await db.execute(sql`delete from rate_counters where window_start < ${new Date(now.getTime() - keepMs).toISOString()}`);
  return res.rowCount ?? 0;
}

/** Counts for many keys in one window (the /admin/groups "runs today" column). */
export async function countsFor(keys: string[], windowStart: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!keys.length) return out;
  const { db, schema } = await dbOf();
  const { and, eq, inArray } = await import("drizzle-orm");
  const rows = await db
    .select({ key: schema.rateCounters.key, count: schema.rateCounters.count })
    .from(schema.rateCounters)
    .where(and(inArray(schema.rateCounters.key, keys), eq(schema.rateCounters.windowStart, windowStart)));
  for (const r of rows) out.set(r.key, r.count);
  return out;
}
