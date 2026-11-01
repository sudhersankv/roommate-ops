// /admin/stats (#83): the numbers to show, for operators only. Counts, never people: no names, emails, phones or
// Group names leave this file. The week math and the CSV are pure (stats.test.ts); loadStats is the thin DB read.
// Weeks are ISO weeks in UTC (Monday to Sunday). Chat lines live 30 days (ADR 0006), so the activity table only goes
// back that far; the agent-run counters (rate_counters) are kept two days, so runs are per day.
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { BETA_GROUP_SIZES, GROUP_PURPOSES } from "@/db/enums";
import { CHANNELS } from "@/db/schema";
import { CATALOG } from "@/toolkits/manifests";
import { NotAllowedError } from "./authz";
import { SOON_CHANNELS, votableTrickIds } from "./trick-votes";

export type Operator = { email: string } | null;
function requireOperator(op: Operator): asserts op is { email: string } {
  if (!op) throw new NotAllowedError("Only the people who run Roomie can see the numbers.", "operator-only");
}

/** How many weeks the per-week tables show, newest last. */
export const STATS_WEEKS = 12;
/** Chat lines are deleted after 30 days, so the activity table shows the weeks that can still have them. */
export const ACTIVITY_WEEKS = 5;
export const NOT_GIVEN = "not given";

const DAY = 24 * 60 * 60 * 1000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The Monday (UTC) of the ISO week `d` is in, as YYYY-MM-DD: the key every per-week row uses. */
export function weekKey(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)));
}

/** "2026-W44": the ISO week label (the week's Thursday decides the year). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // that week's Thursday
  const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type Week = { key: string; label: string };

/** The last `n` ISO weeks up to and including now's, oldest first. */
export function lastWeeks(now: Date, n: number): Week[] {
  const monday = new Date(`${weekKey(now)}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(monday.getTime() - (n - 1 - i) * 7 * DAY);
    return { key: ymd(d), label: isoWeek(d) };
  });
}

export type StatsInput = {
  betas: { createdAt: Date; purpose: string | null; groupSize: string | null }[];
  votes: { trickId: string; n: number }[];
  groups: { createdAt: Date; channel: string | null }[];
  /** chat_messages per week (week = weekKey): Members' lines, Roomie's lines, distinct Groups and Members who wrote. */
  chat: { week: string; memberLines: number; roomieLines: number; activeGroups: number; activeMembers: number }[];
  /** Agent runs per UTC day (the Groups' daily cap counters), day = YYYY-MM-DD. */
  runs: { day: string; n: number }[];
};

export type Count = { key: string; n: number };
export type Stats = {
  generatedAt: string;
  waitlist: { total: number; perWeek: (Week & { n: number })[]; byPurpose: Count[]; bySize: Count[] };
  votes: { id: string; name: string; n: number }[];
  groups: { total: number; channels: string[]; byChannel: Count[]; perWeek: (Week & { total: number; byChannel: Record<string, number> })[] };
  activity: (Week & { activeGroups: number; activeMembers: number; memberLines: number; roomieLines: number })[];
  runs: { day: string; n: number }[];
};

/** Counts per key in a fixed order (the enum's, then "not given", then anything unexpected), zeros included. */
function tally(values: (string | null)[], order: readonly string[]): Count[] {
  const counts = new Map<string, number>([...order, NOT_GIVEN].map((k) => [k, 0]));
  for (const v of values) {
    const k = v ?? NOT_GIVEN;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([key, n]) => ({ key, n }));
}

const voteName = (id: string) => SOON_CHANNELS.find((c) => c.id === id)?.name ?? CATALOG.find((m) => m.id === id)?.name ?? id;

/** Everything on /admin/stats from the raw counts. Pure. */
export function summarizeStats(input: StatsInput, now: Date, weeks = STATS_WEEKS, votable: string[] = votableTrickIds()): Stats {
  const range = lastWeeks(now, weeks);
  const perWeek = (dates: Date[]) => {
    const by = new Map<string, number>();
    for (const d of dates) by.set(weekKey(d), (by.get(weekKey(d)) ?? 0) + 1);
    return range.map((w) => ({ ...w, n: by.get(w.key) ?? 0 }));
  };

  const voteCounts = new Map<string, number>(votable.map((id) => [id, 0]));
  for (const v of input.votes) voteCounts.set(v.trickId, (voteCounts.get(v.trickId) ?? 0) + Number(v.n));
  const votes = [...voteCounts]
    .map(([id, n]) => ({ id, name: voteName(id), n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  const channelOf = (c: string | null) => c ?? NOT_GIVEN;
  const extra = input.groups.map((g) => channelOf(g.channel)).filter((c) => !(CHANNELS as readonly string[]).includes(c));
  const channels = [...CHANNELS, ...new Set(extra)];
  const byChannel = channels.map((key) => ({ key, n: input.groups.filter((g) => channelOf(g.channel) === key).length }));
  const groupWeeks = range.map((w) => {
    const these = input.groups.filter((g) => weekKey(g.createdAt) === w.key);
    return { ...w, total: these.length, byChannel: Object.fromEntries(channels.map((c) => [c, these.filter((g) => channelOf(g.channel) === c).length])) };
  });

  const chat = new Map(input.chat.map((c) => [c.week, c]));
  const activity = range.slice(-ACTIVITY_WEEKS).map((w) => {
    const c = chat.get(w.key);
    return { ...w, activeGroups: Number(c?.activeGroups ?? 0), activeMembers: Number(c?.activeMembers ?? 0), memberLines: Number(c?.memberLines ?? 0), roomieLines: Number(c?.roomieLines ?? 0) };
  });

  return {
    generatedAt: now.toISOString(),
    waitlist: {
      total: input.betas.length,
      perWeek: perWeek(input.betas.map((b) => b.createdAt)),
      byPurpose: tally(input.betas.map((b) => b.purpose), GROUP_PURPOSES),
      bySize: tally(input.betas.map((b) => b.groupSize), BETA_GROUP_SIZES),
    },
    votes,
    groups: { total: input.groups.length, channels, byChannel, perWeek: groupWeeks },
    activity,
    runs: [...input.runs].map((r) => ({ day: r.day, n: Number(r.n) })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One long table: section, metric, period, value. Counts only. Pure. */
export function statsCsv(s: Stats): string {
  const rows: (string | number)[][] = [["section", "metric", "period", "value"]];
  rows.push(["waitlist", "total", "all time", s.waitlist.total]);
  for (const w of s.waitlist.perWeek) rows.push(["waitlist", "sign-ups", w.label, w.n]);
  for (const c of s.waitlist.byPurpose) rows.push(["waitlist", `purpose: ${c.key}`, "all time", c.n]);
  for (const c of s.waitlist.bySize) rows.push(["waitlist", `size: ${c.key}`, "all time", c.n]);
  for (const v of s.votes) rows.push(["votes", v.name, "all time", v.n]);
  rows.push(["groups", "total", "all time", s.groups.total]);
  for (const c of s.groups.byChannel) rows.push(["groups", `channel: ${c.key}`, "all time", c.n]);
  for (const w of s.groups.perWeek) for (const c of s.groups.channels) rows.push(["groups", `added: ${c}`, w.label, w.byChannel[c] ?? 0]);
  for (const a of s.activity) {
    rows.push(["activity", "active groups", a.label, a.activeGroups]);
    rows.push(["activity", "active members", a.label, a.activeMembers]);
    rows.push(["activity", "member chat lines", a.label, a.memberLines]);
    rows.push(["activity", "roomie chat lines", a.label, a.roomieLines]);
  }
  for (const r of s.runs) rows.push(["activity", "agent runs", r.day, r.n]);
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}

/** The raw counts from the DB. Selects no personal column (no names, emails, phones, notes or texts). */
async function readInput(now: Date): Promise<StatsInput> {
  const since = new Date(now.getTime() - (ACTIVITY_WEEKS * 7 + 7) * DAY);
  const [betas, votes, groups, chat, runs] = await Promise.all([
    db.select({ createdAt: schema.betaRequests.createdAt, purpose: schema.betaRequests.purpose, groupSize: schema.betaRequests.groupSize }).from(schema.betaRequests),
    db.select({ trickId: schema.trickVotes.trickId, n: sql<number>`count(*)::int` }).from(schema.trickVotes).groupBy(schema.trickVotes.trickId),
    db
      .select({ createdAt: schema.groups.createdAt, channel: schema.chats.channel })
      .from(schema.groups)
      .leftJoin(schema.chats, sql`${schema.chats.groupId} = ${schema.groups.id}`),
    db.execute<StatsInput["chat"][number]>(sql`
      select to_char(date_trunc('week', created_at at time zone 'UTC'), 'YYYY-MM-DD') as week,
             (count(*) filter (where member_id is not null))::int as "memberLines",
             (count(*) filter (where member_id is null))::int as "roomieLines",
             (count(distinct group_id) filter (where member_id is not null))::int as "activeGroups",
             (count(distinct member_id))::int as "activeMembers"
      from chat_messages where created_at >= ${since.toISOString()}
      group by 1`),
    db.execute<{ day: string; n: number }>(sql`
      select to_char(window_start at time zone 'UTC', 'YYYY-MM-DD') as day, sum(count)::int as n
      from rate_counters where key like 'group:%:day'
      group by 1`),
  ]);
  return { betas, votes, groups, chat: chat.rows, runs: runs.rows };
}

/** /admin/stats and its CSV. Operators only. */
export async function loadStats(op: Operator, now = new Date()): Promise<Stats> {
  requireOperator(op);
  return summarizeStats(await readInput(now), now);
}
