// /admin/stats against the Neon dev branch: the queries run and add up. Read-only: writes nothing.
// Run: npx tsx --test src/services/stats.dbtest.ts   (NEVER against production: check .env's DATABASE_URL first)
import "@/lib/env";
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/db";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";
import { loadStats, statsCsv, STATS_WEEKS } from "./stats";

before(() => assertNotProdDb(db, "stats.dbtest"));

test("loadStats reads every table and the numbers hold together", async () => {
  const s = await loadStats({ email: "operator@example.com" });
  assert.equal(s.waitlist.perWeek.length, STATS_WEEKS);
  assert.equal(s.waitlist.byPurpose.reduce((a, c) => a + c.n, 0), s.waitlist.total);
  assert.equal(s.waitlist.bySize.reduce((a, c) => a + c.n, 0), s.waitlist.total);
  assert.equal(s.groups.byChannel.reduce((a, c) => a + c.n, 0), s.groups.total);
  for (const a of s.activity) assert.ok(a.memberLines >= a.activeMembers, `${a.label}: every active Member wrote at least one line`);
  for (const r of s.runs) assert.match(r.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(statsCsv(s), /^section,metric,period,value\n/);
  console.log(`[stats] waitlist ${s.waitlist.total}, groups ${s.groups.total}, this week ${JSON.stringify(s.activity.at(-1))}`);
});
