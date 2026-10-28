// Started once from instrumentation.ts (one long-running process; DISABLE_SCHEDULER=1 skips it).
// Every 60 s: due reminders, the weekly Group Report (Sun 18:00 in the Group's time zone) and a 9 AM upkeep nudge,
// all through deliver() (the Channel registry), plus the Group style refresh (jobs/style-note.ts, posts nothing),
// recurring Expenses, Splitwise mirror pushes and the daily chat retention sweep (jobs/retention.ts). The tick never
// rejects: every job is wrapped.
import { deliver } from "@/channels";
import { groupsWithChat } from "@/services/groups";
import { runRetention } from "./retention";
import { refreshStyleNote } from "./style-note";
import { dueReminders, markSent, type Reminder } from "@/services/reminders";
import { dueMaintenance } from "@/services/upkeep";
import { runRecurring } from "@/services/recurring";
import { runSplitwiseOutbox } from "@/services/splitwise";
import { formatGroupReport, groupReport, localParts, shouldPostUpkeepNudge, shouldPostWeeklyReport } from "@/services/report";

const TICK_MS = 60_000;
const MAX_SEND_ATTEMPTS = 3;

/* ---------- in-memory state (one process, so globalThis is enough; survives Next HMR) ---------- */

type State = {
  weeklyPostedAt: Map<string, Date>; // groupId -> last weekly report
  upkeepPostedDay: Map<string, string>; // groupId -> "YYYY-MM-DD" (Group time zone) of last nudge
  reminderFailures: Map<string, number>; // reminderId -> failed send attempts
  retentionDay?: string; // UTC day of the last retention sweep
  recurringHour?: string; // UTC hour of the last recurring-expense check
};
function state(): State {
  const g = globalThis as { __roomieSchedulerState?: State };
  return (g.__roomieSchedulerState ??= {
    weeklyPostedAt: new Map(),
    upkeepPostedDay: new Map(),
    reminderFailures: new Map(),
  });
}

/* ---------- reminder lines (pure, deterministic by reminder id) ---------- */

const REMINDER_LINES = [
  "⏰ {text}. You're up, {who}",
  "⏰ Hey {who}: {text} 👀",
  "⏰ Reminder for {who}: {text}",
  "⏰ {who}, quick one: {text} ✨",
  "⏰ {text}. Just saying, {who}",
];

/** Small stable string hash so the same reminder always gets the same line. */
export function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function reminderLine(r: Pick<Reminder, "id" | "text" | "memberName">): string {
  const who = r.memberName ?? "everyone";
  return REMINDER_LINES[hashId(r.id) % REMINDER_LINES.length].replaceAll("{text}", r.text).replaceAll("{who}", who);
}

/* ---------- helpers ---------- */

async function safeSend(groupId: string, text: string, what: string): Promise<boolean> {
  try {
    await deliver(groupId, { text });
    return true;
  } catch (e) {
    console.error(`scheduler: ${what} send failed for group ${groupId}`, e);
    return false;
  }
}

/* ---------- the jobs ---------- */

async function sendDueReminders(now: Date) {
  const s = state();
  let due: Reminder[];
  try {
    due = await dueReminders(now);
  } catch (e) {
    console.error("scheduler: dueReminders failed", e);
    return;
  }
  for (const r of due) {
    const failures = s.reminderFailures.get(r.id) ?? 0;
    if (failures >= MAX_SEND_ATTEMPTS) continue; // gave up; stays unsent so a restart may retry
    const ok = await safeSend(r.groupId, reminderLine(r), "reminder");
    if (!ok) {
      s.reminderFailures.set(r.id, failures + 1);
      if (failures + 1 >= MAX_SEND_ATTEMPTS) console.error(`scheduler: giving up on reminder ${r.id} after ${MAX_SEND_ATTEMPTS} attempts`);
      continue;
    }
    s.reminderFailures.delete(r.id);
    try {
      await markSent(r.id);
    } catch (e) {
      console.error(`scheduler: markSent failed for reminder ${r.id}`, e);
    }
  }
}

/** Post the Group Report to a Group's Chat now. Returns the text. */
export async function postWeeklyReport(groupId: string, groupName?: string, tz?: string): Promise<string> {
  const text = formatGroupReport(await groupReport({ groupId }), { groupName, tz });
  if (await safeSend(groupId, text, "weekly report")) state().weeklyPostedAt.set(groupId, new Date());
  return text;
}

/** Post one line about overdue upkeep, if any. Returns the line or null when nothing is overdue. */
export async function postUpkeepNudge(groupId: string, now = new Date(), tz?: string): Promise<string | null> {
  const overdue = (await dueMaintenance({ groupId })).filter((m) => m.status === "overdue");
  if (overdue.length === 0) return null;
  const text = `🔧 Overdue: ${overdue.map((m) => m.item).join(", ")}. Anyone free today?`;
  if (await safeSend(groupId, text, "upkeep nudge")) state().upkeepPostedDay.set(groupId, localParts(now, tz).day);
  return text;
}

async function runGroupJobs(now: Date) {
  const s = state();
  let all: Awaited<ReturnType<typeof groupsWithChat>>;
  try {
    all = await groupsWithChat();
  } catch (e) {
    console.error("scheduler: groupsWithChat failed", e);
    return;
  }
  for (const g of all) {
    try {
      if (shouldPostWeeklyReport(now, s.weeklyPostedAt.get(g.id) ?? null, g.timezone)) await postWeeklyReport(g.id, g.name, g.timezone);
    } catch (e) {
      console.error(`scheduler: weekly report failed for ${g.name}`, e);
    }
    try {
      if (shouldPostUpkeepNudge(now, s.upkeepPostedDay.get(g.id) ?? null, g.timezone)) {
        // Mark the day even when nothing is overdue so we don't re-query every minute of the 9 o'clock hour.
        s.upkeepPostedDay.set(g.id, localParts(now, g.timezone).day);
        await postUpkeepNudge(g.id, now, g.timezone);
      }
    } catch (e) {
      console.error(`scheduler: upkeep nudge failed for ${g.name}`, e);
    }
    try {
      await refreshStyleNote(g.id, g.styleNoteAt, now);
    } catch (e) {
      console.error(`scheduler: group style refresh failed for ${g.name}`, e);
    }
  }
}

/** Once a day (first tick of each UTC day): drop chat lines older than 30 days. */
async function dailyRetention(now: Date) {
  const s = state();
  const day = now.toISOString().slice(0, 10);
  if (s.retentionDay === day) return;
  s.retentionDay = day;
  try {
    await runRetention(now);
  } catch (e) {
    console.error("scheduler: retention failed", e);
  }
}

/**
 * Recurring Expenses: a daily job, checked once an hour so each Group gets its copy on its own local day. Copies are
 * unique per period (services/recurring.ts), so a restart or a second process can't double them.
 */
async function recurringExpenses(now: Date) {
  const s = state();
  const hour = now.toISOString().slice(0, 13);
  if (s.recurringHour === hour) return;
  s.recurringHour = hour;
  try {
    const made = await runRecurring(now);
    if (made) console.log(`scheduler: ${made} recurring expense${made === 1 ? "" : "s"} added`);
  } catch (e) {
    console.error("scheduler: recurring expenses failed", e);
  }
}

/** Splitwise mirror pushes from the outbox (ADR 0009); failures are retried with backoff on later ticks. */
async function splitwiseOutbox(now: Date) {
  try {
    await runSplitwiseOutbox(now);
  } catch (e) {
    console.error("scheduler: splitwise outbox failed", e);
  }
}

/** One scheduler pass. Never rejects. */
export async function tick(now = new Date()): Promise<void> {
  try {
    await sendDueReminders(now);
    await runGroupJobs(now);
    await recurringExpenses(now);
    await splitwiseOutbox(now);
    await dailyRetention(now);
  } catch (e) {
    console.error("scheduler: tick failed", e);
  }
}

export function startScheduler() {
  const g = globalThis as { __roomieScheduler?: NodeJS.Timeout };
  if (g.__roomieScheduler) return;
  g.__roomieScheduler = setInterval(() => tick().catch((e) => console.error("scheduler", e)), TICK_MS);
  console.log("scheduler started");
}