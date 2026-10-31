// Started once from instrumentation.ts (one long-running process; DISABLE_SCHEDULER=1 skips it).
// Every 60 s: due reminders (the whole Group's in the Chat, a Member's privately), the posts and DMs quiet hours held
// back (pending_posts, services/urgent.ts), then per Group the morning Bundle
// and the weekly Group Report at their local hours (services/schedule.ts), the enabled Toolkits' tick() (their own
// timed DMs, e.g. chore nudges at a chore's usual hour), the Group style refresh
// (jobs/style-note.ts, posts nothing), recurring Expenses, Splitwise mirror pushes and the daily chat retention sweep.
// Posts Roomie makes on its own are claimed in scheduled_posts first, so each goes out once per day / week even across
// restarts (ADR 0001: at most one Bundle per Group per day, nothing when no Toolkit has anything to say). The tick
// never rejects. ROOMIE_PAUSED=1 skips the whole tick; a paused Group (groups.paused_at) gets no reminders or posts
// until resumed.
import { deliver } from "@/channels";
import { nudgeOrHint } from "@/services/dm";
import { expirePolls } from "@/services/polls";
import { groupBundle } from "@/services/bundle";
import { logMessage } from "@/services/chatlog";
import { groupsWithChat } from "@/services/groups";
import { claimReminder, dueReminders, releaseReminder, reminderLine, scheduleNext, type Reminder } from "@/services/reminders";
import { bundleWindow, claimPost, getSchedule, releasePost, weeklyReportWindow, type PostKind } from "@/services/schedule";
import { runRecurring } from "@/services/recurring";
import { runSplitwiseOutbox } from "@/services/splitwise";
import { enabledToolkitEntries } from "@/services/toolkits";
import { pausedGroupIds } from "@/services/operator-groups";
import { flushPendingPosts } from "@/services/urgent";
import { daytimeHour } from "@/lib/quiet-hours";
import { logPaused, roomiePaused } from "@/lib/kill-switch";
import { pruneRateCounters } from "@/lib/rate-counters";
import { groupReportText } from "./report-text";
import { runRetention } from "./retention";
import { refreshStyleNote } from "./style-note";

const TICK_MS = 60_000;
const MAX_SEND_ATTEMPTS = 3;

/* ---------- in-memory state (one process, so globalThis is enough; survives Next HMR) ---------- */

type State = {
  reminderFailures: Map<string, number>; // reminderId -> failed send attempts
  retentionDay?: string; // UTC day of the last retention sweep
  recurringHour?: string; // UTC hour of the last recurring-expense check
  clampedNudge: Set<string>; // Groups whose quiet-hours nudge hour was already logged
};
function state(): State {
  const g = globalThis as { __roomieSchedulerState?: State };
  const s = (g.__roomieSchedulerState ??= { reminderFailures: new Map(), clampedNudge: new Set() });
  s.clampedNudge ??= new Set();
  return s;
}

type GroupRow = Awaited<ReturnType<typeof groupsWithChat>>[number];

/* ---------- reminders ---------- */

/**
 * One reminder: the whole Group's into the Chat, a Member's privately, never both. When Roomie can't DM that Member
 * yet (they never pressed Start), the Chat gets the neutral Start hint instead, at most weekly (services/dm.ts).
 */
export async function deliverReminder(r: Reminder): Promise<"chat" | "private"> {
  const text = reminderLine(r);
  if (!r.memberId) {
    await deliver(r.groupId, { text });
    return "chat";
  }
  return (await nudgeOrHint(r.memberId, r.groupId, { text })) === "private" ? "private" : "chat";
}

export async function sendDueReminders(now: Date, groupId?: string, paused: ReadonlySet<string> = new Set()): Promise<number> {
  const s = state();
  let due: Reminder[];
  try {
    // A paused Group's reminders wait (unclaimed) until it's resumed.
    due = (await dueReminders(now, groupId)).filter((r) => !paused.has(r.groupId));
  } catch (e) {
    console.error("scheduler: dueReminders failed", e);
    return 0;
  }
  let sent = 0;
  for (const r of due) {
    const failures = s.reminderFailures.get(r.id) ?? 0;
    if (failures >= MAX_SEND_ATTEMPTS) continue; // gave up; stays unsent so a restart may retry
    try {
      if (!(await claimReminder(r.id, now))) continue; // another process has it
    } catch (e) {
      console.error(`scheduler: couldn't claim reminder ${r.id}`, e);
      continue;
    }
    try {
      await deliverReminder(r);
    } catch (e) {
      console.error(`scheduler: reminder ${r.id} send failed`, e);
      await releaseReminder(r.id).catch(() => {});
      s.reminderFailures.set(r.id, failures + 1);
      if (failures + 1 >= MAX_SEND_ATTEMPTS) console.error(`scheduler: giving up on reminder ${r.id} after ${MAX_SEND_ATTEMPTS} attempts`);
      continue;
    }
    s.reminderFailures.delete(r.id);
    sent++;
    try {
      await scheduleNext(r.id, now);
    } catch (e) {
      console.error(`scheduler: couldn't schedule the next "${r.text}" (reminder ${r.id})`, e);
    }
  }
  return sent;
}

/* ---------- posts Roomie makes on its own ---------- */

/** Claim, send, and give the claim back if the send failed (a later tick in the same hour retries). */
async function postOnce(g: GroupRow, kind: PostKind, period: string, text: string): Promise<boolean> {
  if (!(await claimPost(g.id, kind, period))) return false;
  try {
    await deliver(g.id, { text });
    return true;
  } catch (e) {
    await releasePost(g.id, kind, period).catch(() => {});
    throw e;
  }
}

/**
 * The morning Bundle (ADR 0017), in the Group's nudge hour: the enabled Toolkits' lines and core's Reminders line,
 * only when one has something to say. Claimed as "bundle" for the local day. A stored nudge hour inside quiet hours
 * goes out at 08:00 (logged once per Group). Returns the text posted.
 */
export async function bundleJob(g: GroupRow, now: Date): Promise<string | null> {
  const { nudgeHour } = await getSchedule({ groupId: g.id });
  const hour = nudgeHour === null ? null : daytimeHour(nudgeHour);
  if (hour !== nudgeHour && !state().clampedNudge.has(g.id)) {
    state().clampedNudge.add(g.id);
    console.warn(`scheduler: ${g.name}'s nudge hour ${nudgeHour}:00 is inside quiet hours; the Bundle goes out at ${hour}:00`);
  }
  const w = bundleWindow(now, g.timezone, hour);
  if (!w.open) return null;
  const text = await groupBundle({ groupId: g.id }, now);
  if (!text) return null;
  if (!(await postOnce(g, "bundle", w.period, text))) return null;
  // The Bundle and the weekly report are logged as Roomie's line (urgent posts aren't): they ask things ("Add them?"), and
  // the follow-up window it opens is how a "yes" reaches the agent, with the Bundle in its earlier chat.
  await logMessage(g.id, null, text).catch((e) => console.warn(`scheduler: couldn't log ${g.name}'s Bundle`, e));
  return text;
}

/** The weekly Group Report, on the Group's report day and hour. Returns the text posted. */
export async function weeklyReportJob(g: GroupRow, now: Date): Promise<string | null> {
  const { reportWeekday, reportHour } = await getSchedule({ groupId: g.id });
  const w = weeklyReportWindow(now, g.timezone, reportWeekday, reportHour);
  if (!w.open) return null;
  const text = await groupReportText(g.id, now);
  if (!(await postOnce(g, "report.weekly", w.period, text))) return null;
  // Logged as Roomie's line like the Bundle: the report can ask something ("Want me to change it?"), and a "yes" right
  // after needs the follow-up window and the report in the recent chat.
  await logMessage(g.id, null, text).catch((e) => console.warn(`scheduler: couldn't log ${g.name}'s report`, e));
  return text;
}

/** Each enabled Toolkit's tick() (its own timed DMs), every pass. One failing doesn't stop the others. */
export async function toolkitTicks(g: GroupRow, now: Date): Promise<void> {
  for (const t of await enabledToolkitEntries({ groupId: g.id })) {
    if (!t.tick) continue;
    await t.tick({ groupId: g.id }, now).catch((e) => console.error(`scheduler: ${t.id} tick failed for ${g.name}`, e));
  }
}

async function runGroupJobs(now: Date, paused: ReadonlySet<string>) {
  let all: GroupRow[];
  try {
    all = await groupsWithChat();
  } catch (e) {
    console.error("scheduler: groupsWithChat failed", e);
    return;
  }
  for (const g of all) {
    if (paused.has(g.id)) continue; // an operator paused it (/admin/groups): no posts of its own
    try {
      await weeklyReportJob(g, now);
    } catch (e) {
      console.error(`scheduler: weekly report failed for ${g.name}`, e);
    }
    try {
      await bundleJob(g, now);
    } catch (e) {
      console.error(`scheduler: bundle failed for ${g.name}`, e);
    }
    try {
      await toolkitTicks(g, now);
    } catch (e) {
      console.error(`scheduler: toolkit ticks failed for ${g.name}`, e);
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
  try {
    await pruneRateCounters(now);
  } catch (e) {
    console.error("scheduler: rate counter prune failed", e);
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
  if (roomiePaused()) {
    logPaused("the scheduler tick");
    return;
  }
  try {
    // Fail closed: when we can't tell which Groups are paused, nothing goes out to any Group this tick.
    const paused = await pausedGroupIds().catch((e) => {
      console.error("scheduler: pausedGroupIds failed; skipping reminders and group posts this tick", e);
      return null;
    });
    if (paused) {
      await sendDueReminders(now, undefined, paused);
      await flushPendingPosts(now, paused).catch((e) => console.error("scheduler: held posts failed", e));
      await runGroupJobs(now, paused);
      await expirePolls(now, paused).catch((e) => console.error("scheduler: poll expiry failed", e));
    }
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
