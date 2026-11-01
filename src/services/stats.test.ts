// /admin/stats without a DB: ISO weeks, the summary, the CSV and the operator check.
// Run: npx tsx --test src/services/stats.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { NotAllowedError } from "./authz";
import { ACTIVITY_WEEKS, isoWeek, lastWeeks, loadStats, NOT_GIVEN, statsCsv, summarizeStats, weekKey, type StatsInput } from "./stats";

const d = (s: string) => new Date(s);
const NOW = d("2026-11-01T15:00:00Z"); // a Sunday: ISO week 2026-W44 (Mon Oct 26 - Sun Nov 1)
const empty: StatsInput = { betas: [], votes: [], groups: [], chat: [], runs: [] };

test("ISO weeks: Monday starts the week, the Thursday decides the year", () => {
  assert.equal(weekKey(d("2026-11-01T23:59:00Z")), "2026-10-26");
  assert.equal(weekKey(d("2026-10-26T00:00:00Z")), "2026-10-26");
  assert.equal(weekKey(d("2026-11-02T00:00:00Z")), "2026-11-02");
  assert.equal(isoWeek(d("2026-11-01T12:00:00Z")), "2026-W44");
  assert.equal(isoWeek(d("2026-01-01T12:00:00Z")), "2026-W01"); // a Thursday
  assert.equal(isoWeek(d("2027-01-01T12:00:00Z")), "2026-W53"); // a Friday: still 2026's last week
  assert.equal(isoWeek(d("2024-12-30T12:00:00Z")), "2025-W01"); // a Monday that belongs to 2025
  assert.equal(isoWeek(d("2021-01-03T12:00:00Z")), "2020-W53");
});

test("lastWeeks: oldest first, ending with this week", () => {
  const w = lastWeeks(NOW, 3);
  assert.deepEqual(w.map((x) => x.key), ["2026-10-12", "2026-10-19", "2026-10-26"]);
  assert.deepEqual(w.map((x) => x.label), ["2026-W42", "2026-W43", "2026-W44"]);
});

test("waitlist: total, per week (zeros kept), by purpose and size with 'not given' for the optional fields", () => {
  const s = summarizeStats(
    {
      ...empty,
      betas: [
        { createdAt: d("2026-10-27T10:00:00Z"), purpose: "roommates", groupSize: "3-4" },
        { createdAt: d("2026-10-31T10:00:00Z"), purpose: null, groupSize: null },
        { createdAt: d("2026-10-14T10:00:00Z"), purpose: "roommates", groupSize: "2" },
        { createdAt: d("2025-01-01T10:00:00Z"), purpose: "trip", groupSize: "5-8" }, // outside the weeks shown, still in the total
      ],
    },
    NOW,
    3,
  );
  assert.equal(s.waitlist.total, 4);
  assert.deepEqual(s.waitlist.perWeek.map((w) => w.n), [1, 0, 2]);
  const purpose = Object.fromEntries(s.waitlist.byPurpose.map((c) => [c.key, c.n]));
  assert.equal(purpose.roommates, 2);
  assert.equal(purpose.trip, 1);
  assert.equal(purpose.family, 0, "every purpose is listed, zeros included");
  assert.equal(purpose[NOT_GIVEN], 1);
  assert.equal(s.waitlist.bySize.at(-1)?.key, NOT_GIVEN);
  assert.equal(s.waitlist.bySize.find((c) => c.key === "3-4")?.n, 1);
});

test("votes: every votable id listed with its name, most votes first; stray ids kept", () => {
  const s = summarizeStats({ ...empty, votes: [{ trickId: "b", n: 2 }, { trickId: "channel:discord", n: 7 }, { trickId: "old", n: 1 }] }, NOW, 3, ["a", "b", "channel:discord"]);
  assert.deepEqual(
    s.votes.map((v) => [v.name, v.n]),
    [["Discord", 7], ["b", 2], ["old", 1], ["a", 0]],
  );
});

test("groups: total, per channel, per week per channel; a Group without a Chat is 'not given'", () => {
  const s = summarizeStats(
    {
      ...empty,
      groups: [
        { createdAt: d("2026-10-28T10:00:00Z"), channel: "whatsapp" },
        { createdAt: d("2026-10-29T10:00:00Z"), channel: "telegram" },
        { createdAt: d("2026-10-30T10:00:00Z"), channel: "telegram" },
        { createdAt: d("2026-10-20T10:00:00Z"), channel: null },
      ],
    },
    NOW,
    2,
  );
  assert.equal(s.groups.total, 4);
  const by = Object.fromEntries(s.groups.byChannel.map((c) => [c.key, c.n]));
  assert.deepEqual(by, { whatsapp: 1, telegram: 2, dev: 0, [NOT_GIVEN]: 1 });
  assert.deepEqual(s.groups.perWeek.map((w) => w.total), [1, 3]);
  assert.equal(s.groups.perWeek[1].byChannel.telegram, 2);
  assert.equal(s.groups.perWeek[0].byChannel[NOT_GIVEN], 1);
});

test("activity: the last few weeks only (chat lines live 30 days), zeros where nothing was said", () => {
  const s = summarizeStats(
    { ...empty, chat: [{ week: "2026-10-26", memberLines: 40, roomieLines: 12, activeGroups: 3, activeMembers: 9 }], runs: [{ day: "2026-11-01", n: 5 }, { day: "2026-10-31", n: 8 }] },
    NOW,
  );
  assert.equal(s.activity.length, ACTIVITY_WEEKS);
  assert.deepEqual(s.activity.at(-1), { key: "2026-10-26", label: "2026-W44", activeGroups: 3, activeMembers: 9, memberLines: 40, roomieLines: 12 });
  assert.equal(s.activity[0].memberLines, 0);
  assert.deepEqual(s.runs, [{ day: "2026-10-31", n: 8 }, { day: "2026-11-01", n: 5 }]);
});

test("CSV: one header, counts only, quoted where needed", () => {
  const s = summarizeStats({ ...empty, betas: [{ createdAt: d("2026-10-27T10:00:00Z"), purpose: "roommates", groupSize: "3-4" }], votes: [{ trickId: "x", n: 3 }] }, NOW, 2, ["x"]);
  const csv = statsCsv(s);
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines[0], "section,metric,period,value");
  assert.ok(lines.includes("waitlist,total,all time,1"));
  assert.ok(lines.includes("waitlist,sign-ups,2026-W44,1"));
  assert.ok(lines.includes("waitlist,purpose: roommates,all time,1"));
  assert.ok(lines.includes("votes,x,all time,3"));
  assert.ok(lines.includes("groups,added: whatsapp,2026-W43,0"));
  assert.ok(lines.every((l) => l.split(",").length === 4), "four columns everywhere");
  assert.ok(csv.endsWith("\n"));
});

test("only operators can read the numbers", async () => {
  await assert.rejects(loadStats(null), (e) => e instanceof NotAllowedError && e.code === "operator-only");
});
