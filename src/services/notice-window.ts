// Pure rules for a notice's window (#63, spec #57 "Notice windows"): the classifier keeps a notice's start and end
// (local wall-clock in the Group's zone, read with parseInZone) and a short `what` ("water"); this module turns them
// into the night-before Reminder ("Reminder: water's off tomorrow, 9 to 11. Shower tonight.") and the answer to "is
// the water back on?" ("Yep, since 11:00."). No DB, no clock of its own: the caller passes `now` and the zone.
import { addDaysToDay, dayInZone, parseInZone, zonedParts, zonedTimeToUtc } from "@/lib/time";

/** What the classifier keeps about a notice (mail_messages.facts). Times are local "YYYY-MM-DDTHH:mm". */
export type NoticeFacts = {
  start?: string;
  end?: string;
  /** The thing itself, a few words, lower case: "water", "power", "elevator", "smoke detector inspection". */
  what?: string;
  /** A shut-off or outage (the thing is off or out for the window), as opposed to a visit or an event. */
  off?: boolean;
};

export type Notice = NoticeFacts & { summary: string; receivedAt: Date };

const HAS_TIME = /T\d{1,2}:\d{2}/;
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A local wall-clock with a time -> the instant, else null (a bare date has no window). */
export function windowInstant(local: string | undefined, tz: string): Date | null {
  if (!local || !HAS_TIME.test(local)) return null;
  const d = parseInZone(local, tz);
  return Number.isNaN(d.getTime()) ? null : d;
}

type Clock = { hour: number; minute: number };
const clockOf = (d: Date, tz: string): Clock => {
  const p = zonedParts(tz, d);
  return { hour: p.hour, minute: p.minute };
};

/** "9", "9:30", "noon", "midnight" (no AM / PM). */
function bareClock(c: Clock): string {
  if (c.minute === 0 && c.hour === 12) return "noon";
  if (c.minute === 0 && c.hour === 0) return "midnight";
  const h = c.hour % 12 || 12;
  return c.minute ? `${h}:${String(c.minute).padStart(2, "0")}` : `${h}`;
}
const isNamed = (c: Clock) => c.minute === 0 && (c.hour === 12 || c.hour === 0);
const meridiem = (c: Clock) => (c.hour < 12 ? "AM" : "PM");
const withMeridiem = (c: Clock) => (isNamed(c) ? bareClock(c) : `${bareClock(c)} ${meridiem(c)}`);

/**
 * A time people read in a status line: "11:00" in the morning, "1:30 PM" after noon, "noon". The morning goes without
 * "AM" (the video's "since 11:00"); an afternoon time says PM so 7:00 can't be read as the morning.
 */
export function clockText(d: Date, tz: string): string {
  const c = clockOf(d, tz);
  if (isNamed(c)) return bareClock(c);
  const h = c.hour % 12 || 12;
  const t = `${h}:${String(c.minute).padStart(2, "0")}`;
  return c.hour < 12 ? t : `${t} PM`;
}

/** "today", "tomorrow", "Tue" within the week, else "Nov 3": the day of `d` as seen from `now`. */
export function dayWord(d: Date, now: Date, tz: string): string {
  const day = dayInZone(tz, d);
  const today = dayInZone(tz, now);
  if (day === today) return "today";
  if (day === addDaysToDay(today, 1)) return "tomorrow";
  const p = zonedParts(tz, d);
  const ahead = day > today && day <= addDaysToDay(today, 6);
  const behind = day < today && day >= addDaysToDay(today, -6);
  return ahead || behind ? WEEKDAYS_SHORT[p.weekday] : `${MONTHS_SHORT[p.month - 1]} ${p.day}`;
}

/**
 * The window as people say it: "9 to 11" (both in the morning), "1 to 3 PM", "11 AM to 1 PM", "9 to noon", "from 9"
 * (no end), "10 PM to Wed 6 AM" (ends another day). Null without a start time. With `am`, a morning says so ("9 to 11
 * AM", "from 9 AM"): the chat line for a notice days ahead, where "9" alone could be the evening.
 */
export function windowText(facts: Pick<NoticeFacts, "start" | "end">, tz: string, opts: { am?: boolean } = {}): string | null {
  const start = windowInstant(facts.start, tz);
  if (!start) return null;
  const s = clockOf(start, tz);
  const end = windowInstant(facts.end, tz);
  if (!end || end <= start) return `from ${s.hour < 12 && !opts.am ? bareClock(s) : withMeridiem(s)}`;
  const e = clockOf(end, tz);
  if (dayInZone(tz, end) !== dayInZone(tz, start)) return `${withMeridiem(s)} to ${WEEKDAYS_SHORT[zonedParts(tz, end).weekday]} ${withMeridiem(e)}`;
  if (s.hour < 12 && (e.hour < 12 || isNamed(e))) return `${bareClock(s)} to ${opts.am ? withMeridiem(e) : bareClock(e)}`;
  if (s.hour >= 12 && e.hour >= 12 && !isNamed(s)) return `${bareClock(s)} to ${withMeridiem(e)}`;
  return `${withMeridiem(s)} to ${withMeridiem(e)}`;
}

/** One short tip for the night before, only for the shut-offs where there's an obvious one. */
const TIPS: readonly [RegExp, string][] = [
  [/\bwater\b/, "Shower tonight."],
  [/\b(?:power|electric\w*)\b/, "Charge your phone tonight."],
  [/\belevators?\b/, "Plan on the stairs."],
];
export function noticeTip(facts: Pick<NoticeFacts, "what" | "off">): string | null {
  if (!facts.off || !facts.what) return null;
  const what = facts.what.toLowerCase();
  return TIPS.find(([re]) => re.test(what))?.[1] ?? null;
}

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (what: string) => /s$/i.test(what) && !/(?:ss|gas)$/i.test(what);
/** "water's off", "the elevators are off", "pest control". */
function whatPhrase(facts: NoticeFacts): string {
  const what = facts.what!.trim().toLowerCase();
  return facts.off ? `${what}${plural(what) ? " are" : "'s"} off` : what;
}

/**
 * The night-before Reminder's text: "Reminder: water's off tomorrow, 9 to 11. Shower tonight.", "Reminder: smoke
 * detector inspection tomorrow, 9 to noon." Without a `what` it's the old "Tomorrow: <summary>".
 */
export function noticeReminderText(facts: NoticeFacts, summary: string, tz: string): string {
  if (!facts.what?.trim()) return `Tomorrow: ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`;
  const window = windowText(facts, tz);
  const when = window ? (window.startsWith("from ") ? ` ${window}` : `, ${window}`) : "";
  const tip = noticeTip(facts);
  return `Reminder: ${whatPhrase(facts)} tomorrow${when}.${tip ? ` ${tip}` : ""}`;
}

/**
 * What a notice's chat line says after the sender (#74): built from its facts when it has a thing and a day ("water's
 * off Tue, 9 to 11 AM.", "smoke detector inspection tomorrow, 9 to noon.", "pest control Nov 12."), else the
 * classifier's summary as it is. `date` is the notice's day when the facts have no start (mail_messages.notice_date).
 */
export function noticeLineText(n: { facts: NoticeFacts | null; date?: string | null; summary: string }, now: Date, tz: string): string {
  const facts = n.facts ?? {};
  const day = /^(\d{4}-\d{2}-\d{2})/.exec((facts.start ?? n.date ?? "").trim())?.[1];
  if (!facts.what?.trim() || !day) return n.summary;
  const at = parseInZone(`${day}T12:00`, tz);
  if (Number.isNaN(at.getTime())) return n.summary;
  const window = windowText(facts, tz, { am: true });
  const when = window ? (window.startsWith("from ") ? ` ${window}` : `, ${window}`) : "";
  return `${whatPhrase(facts)} ${dayWord(at, now, tz)}${when}.`;
}

/** The notice's Reminder: 20:00 local the evening before its day (a start, else its date). */
export const REMINDER_HOUR = 20;
export function eveningBefore(noticeDate: string, timezone: string): Date | null {
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(noticeDate.trim())?.[1];
  if (!day) return null;
  const [y, m, d] = addDaysToDay(day, -1).split("-").map(Number);
  return zonedTimeToUtc(timezone, { year: y, month: m, day: d, hour: REMINDER_HOUR, minute: 0, second: 0 });
}

/* ---------- "is the water back on?" ---------- */

export type NoticeState = "before" | "during" | "after";
export type NoticeStatus = { state: NoticeState; line: string; notice: Notice };

const words = (s: string) => new Set((s.toLowerCase().replace(/['’]/g, "").match(/[a-z]+/g) ?? []).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w)));
const STOP = new Set(["the", "is", "it", "back", "on", "off", "still", "yet", "when", "will", "be", "a", "an", "our", "has", "was", "are", "there", "any", "what", "about", "today", "tomorrow", "come", "coming", "going", "working"]);
const ALIASES: Record<string, string[]> = { power: ["electric", "electricity", "light"], electric: ["power"], electricity: ["power"], light: ["power"], lift: ["elevator"], elevator: ["lift"] };

function mentions(n: Notice, about: string): boolean {
  const asked = [...words(about)].filter((w) => !STOP.has(w));
  if (!asked.length) return true;
  const have = words(`${n.what ?? ""} ${n.summary}`);
  return asked.some((w) => have.has(w) || (ALIASES[w] ?? []).some((a) => have.has(a)));
}

/**
 * The answer to "is the water back on?" from the Group's notices (any order). Only notices with a start time count;
 * `about` ("water") narrows them to those that say it. Which one: one going on now, else one that ended within the
 * last day, else the next one ahead, else the one that ended last. Null when none fits.
 *
 * A shut-off: after -> "Yep, since 11:00."; during -> "Not yet, back at 11:00."; before -> "It's still on. Off Tue
 * 9 to 11." Anything else (an inspection): "Inspection: Tue 9 to noon." / "Going on now, until noon." / "Done
 * since noon."
 */
export function noticeStatus(notices: readonly Notice[], now: Date, tz: string, about?: string): NoticeStatus | null {
  const timed = notices
    .filter((n) => !about || mentions(n, about))
    .map((n) => ({ n, start: windowInstant(n.start, tz)!, end: windowInstant(n.end, tz) }))
    .filter((x) => x.start && (!x.end || x.end > x.start));
  if (!timed.length) return null;
  const newestFirst = (a: { n: Notice }, b: { n: Notice }) => b.n.receivedAt.getTime() - a.n.receivedAt.getTime();
  const during = timed.filter((x) => x.start <= now && (!x.end || x.end > now)).sort(newestFirst)[0];
  const ended = timed.filter((x) => x.end && x.end <= now).sort((a, b) => b.end!.getTime() - a.end!.getTime());
  const ahead = timed.filter((x) => x.start > now).sort((a, b) => a.start.getTime() - b.start.getTime());
  const DAY = 24 * 3_600_000;
  const pick = during ?? (ended[0] && now.getTime() - ended[0].end!.getTime() <= DAY ? ended[0] : undefined) ?? ahead[0] ?? ended[0];
  const { n, start, end } = pick;
  const at = (d: Date) => (dayInZone(tz, d) === dayInZone(tz, now) ? clockText(d, tz) : `${dayWord(d, now, tz)} ${clockText(d, tz)}`);
  const what = n.what?.trim() ? capitalized(n.what.trim().toLowerCase()) : null;

  if (pick === during) {
    if (n.off) return { state: "during", notice: n, line: end ? `Not yet, back at ${at(end)}.` : `Not yet. It went off at ${at(start)} and the notice didn't say until when.` };
    return { state: "during", notice: n, line: end ? `Going on now, until ${at(end)}.` : `Going on now, since ${at(start)}.` };
  }
  if (end && end <= now) return { state: "after", notice: n, line: n.off ? `Yep, since ${at(end)}.` : `Done since ${at(end)}.` };
  const window = windowText(n, tz);
  const day = dayWord(start, now, tz);
  const when = window ? `${day} ${window}` : day;
  if (n.off) return { state: "before", notice: n, line: `It's still on. Off ${when}.` };
  return { state: "before", notice: n, line: `${what ?? "The notice"}: ${when}.` };
}
