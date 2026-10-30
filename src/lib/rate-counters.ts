// rate_counters in Postgres behind WindowLimiter.hit (lib/caps.ts). The DB client is imported on first use, so
// importing this file (the pipeline, unit tests) never builds one. When the counter queries fail, the caps keep
// working on this process's own memory instead (a restart forgets those counts), so an outage never means "no caps".
import { MemoryCounters, type CounterStore } from "./window-limit";

const dbOf = () => import("@/db");

/** Where counts go while Postgres can't be reached. */
const fallback = new MemoryCounters();
let warnedAt = 0;
const warn = (key: string, e: unknown) => {
  if (Date.now() - warnedAt < 60_000) return;
  warnedAt = Date.now();
  console.error(`[caps] rate_counters unavailable (${key}); counting in memory for now:`, e instanceof Error ? e.message : e);
};

export const pgCounters: CounterStore = {
  async hit(key, windowStart, max) {
    try {
      // Tries let through in memory during an outage still count once Postgres is back (same key and window).
      const outage = await fallback.count(key, windowStart);
      if (outage >= max) return false;
      const { db } = await dbOf();
      const { sql } = await import("drizzle-orm");
      const res = await db.execute<{ count: number }>(sql`
        insert into rate_counters (key, window_start, count) values (${key}, ${windowStart.toISOString()}, 1)
        on conflict (key, window_start) do update set count = rate_counters.count + 1 where rate_counters.count < ${max - outage}
        returning count`);
      return res.rows.length > 0;
    } catch (e) {
      warn(key, e);
      return fallback.hit(key, windowStart, max);
    }
  },
  async count(key, windowStart) {
    try {
      const { db } = await dbOf();
      const { sql } = await import("drizzle-orm");
      const res = await db.execute<{ count: number }>(sql`select count from rate_counters where key = ${key} and window_start = ${windowStart.toISOString()}`);
      return Number(res.rows[0]?.count ?? 0) + (await fallback.count(key, windowStart));
    } catch (e) {
      warn(key, e);
      return fallback.count(key, windowStart);
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
