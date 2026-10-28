// P4 · Sudhersan. Started once from instrumentation.ts (one long-running process; DISABLE_SCHEDULER=1 skips it).
// Every 60 s: due reminders, the weekly Group Report (Sun 18:00 Chicago) and a 9 AM upkeep nudge, all through deliver().
// The tick never rejects: every send is wrapped.
import { isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { deliver } from "@/channels";
import { dueReminders, markSent, type Reminder } from "@/services/reminders";
import { dueMaintenance } from "@/services/upkeep";
import { formatGroupReport, groupReport, localParts, shouldPostUpkeepNudge, shouldPostWeeklyReport } from "@/services/report";

const TICK_MS = 60_000;
const MAX_SEND_ATTEMPTS = 3;

/* ---------- in-memory state (one process, so globalThis is enough; survives Next HMR) ---------- */

type State = {
  weeklyPostedAt: Map<string, Date>; // householdId -> last weekly report
  upkeepPostedDay: Map<string, string>; // householdId -> "YYYY-MM-DD" (Chicago) of last nudge
  reminderFailures: Map<string, number>; // reminderId -> failed send attempts
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

/** Households that have a chat linked (the only ones Roomie can post to unprompted). */
export async function householdsWithChat(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: schema.households.id, name: schema.households.name })
    .from(schema.households)
    .where(isNotNull(schema.households.chatId));
}

async function safeSend(householdId: string, text: string, what: string): Promise<boolean> {
  try {
    await deliver(householdId, { text });
    return true;
  } catch (e) {
    console.error(`scheduler: ${what} send failed for household ${householdId}`, e);
    return false;
  }
}

/* ---------- the three jobs ---------- */

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
    const ok = await safeSend(r.householdId, reminderLine(r), "reminder");
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

/** Post the Group Report to a household's chat now. Returns the text. */
export async function postWeeklyReport(householdId: string, houseName?: string): Promise<string> {
  const text = formatGroupReport(await groupReport({ householdId }), { houseName });
  if (await safeSend(householdId, text, "weekly report")) state().weeklyPostedAt.set(householdId, new Date());
  return text;
}

/** Post one line about overdue upkeep, if any. Returns the line or null when nothing is overdue. */
export async function postUpkeepNudge(householdId: string, now = new Date()): Promise<string | null> {
  const overdue = (await dueMaintenance({ householdId })).filter((m) => m.status === "overdue");
  if (overdue.length === 0) return null;
  const text = `🔧 Overdue: ${overdue.map((m) => m.item).join(", ")}. Anyone free today?`;
  if (await safeSend(householdId, text, "upkeep nudge")) state().upkeepPostedDay.set(householdId, localParts(now).day);
  return text;
}

async function runHouseholdJobs(now: Date) {
  const s = state();
  let houses: { id: string; name: string }[];
  try {
    houses = await householdsWithChat();
  } catch (e) {
    console.error("scheduler: householdsWithChat failed", e);
    return;
  }
  for (const h of houses) {
    try {
      if (shouldPostWeeklyReport(now, s.weeklyPostedAt.get(h.id) ?? null)) await postWeeklyReport(h.id, h.name);
    } catch (e) {
      console.error(`scheduler: weekly report failed for ${h.name}`, e);
    }
    try {
      if (shouldPostUpkeepNudge(now, s.upkeepPostedDay.get(h.id) ?? null)) {
        // Mark the day even when nothing is overdue so we don't re-query every minute of the 9 o'clock hour.
        s.upkeepPostedDay.set(h.id, localParts(now).day);
        await postUpkeepNudge(h.id, now);
      }
    } catch (e) {
      console.error(`scheduler: upkeep nudge failed for ${h.name}`, e);
    }
  }
}

/** One scheduler pass. Never rejects. */
export async function tick(now = new Date()): Promise<void> {
  try {
    await sendDueReminders(now);
    await runHouseholdJobs(now);
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
