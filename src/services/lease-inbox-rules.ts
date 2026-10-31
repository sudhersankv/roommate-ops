// Pure Lease Inbox rules (ADR 0016): the work-order state machine and when a notice is urgent (ADR 0017's urgent
// slot). The classifier reads the landlord's reply; these decide what it does.
import { WORK_ORDER_STATUSES, type WorkOrderStatus } from "@/db/enums";
import { addDaysToDay, dayInZone, daysBetweenDays, parseInZone, zonedTimeToUtc } from "@/lib/time";

export { WORK_ORDER_STATUSES, type WorkOrderStatus };

/** scheduledFor is the visit as the landlord gave it: a local "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (Group zone). */
export type WorkOrderState = { status: WorkOrderStatus; scheduledFor: string | null };

/** What a landlord's reply to a work order says, as the classifier reads it. */
export type WorkOrderReply = { kind: "acknowledged" } | { kind: "scheduled"; date: string } | { kind: "done" } | { kind: "other" };

const RANK: Record<WorkOrderStatus, number> = { sent: 0, acknowledged: 1, scheduled: 2, done: 3 };

/**
 * Forward only (skipping steps is fine: "plumber Tuesday" can be the first reply), a new date moves a scheduled
 * visit, done is final. Anything else leaves the work order as it is (`changed: false`).
 */
export function nextStatus(current: WorkOrderState, reply: WorkOrderReply): WorkOrderState & { changed: boolean } {
  const same = { ...current, changed: false };
  if (current.status === "done" || reply.kind === "other") return same;
  if (reply.kind === "scheduled") {
    const date = reply.date.trim();
    if (!date || (current.status === "scheduled" && current.scheduledFor === date)) return same;
    return { status: "scheduled", scheduledFor: date, changed: true };
  }
  if (RANK[reply.kind] <= RANK[current.status]) return same;
  return { status: reply.kind, scheduledFor: current.scheduledFor, changed: true };
}

export const URGENT_WITHIN_MS = 72 * 3600_000;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A notice is urgent when it's still ahead and starts within 72 real hours: the urgent slot is for something about
 * to happen, and one already past is news for the next Bundle. A wall-clock time is read in the Group's zone
 * (lib/time) and must be later than now; a bare date counts from the start of that local day and stays urgent until
 * the day is over (its time is unknown).
 */
export function isUrgent(noticeDate: string, now: Date, timezone: string): boolean {
  const s = noticeDate.trim();
  const d = DATE_ONLY.exec(s);
  if (d) {
    const start = zonedTimeToUtc(timezone, { year: Number(d[1]), month: Number(d[2]), day: Number(d[3]), hour: 0, minute: 0, second: 0 });
    return s >= dayInZone(timezone, now) && start.getTime() - now.getTime() <= URGENT_WITHIN_MS;
  }
  const at = parseInZone(s, timezone);
  if (Number.isNaN(at.getTime())) return false;
  return at > now && at.getTime() - now.getTime() <= URGENT_WITHIN_MS;
}

/* ---------- the Toolkit's lines (pure, lease-inbox-rules.test.ts) ---------- */

export type QuietOrder = { title: string; status: WorkOrderStatus; scheduledFor: string | null; lastActivityAt: Date };

export const FOLLOW_UP_DAYS = 5;

const visitTime = (when: string) => {
  const t = /T(\d{2}):(\d{2})/.exec(when);
  if (!t) return "";
  const h = Number(t[1]);
  return ` (${h % 12 || 12}${t[2] === "00" ? "" : `:${t[2]}`}${h < 12 ? "am" : "pm"})`;
};

/**
 * The Lease Inbox's line in the morning Bundle: a visit tomorrow (someone be home), and the oldest work order the
 * landlord hasn't answered for 5, 10, 15... local days (the offer to follow up, not every morning). Null when neither.
 */
export function leaseBundleText(orders: readonly QuietOrder[], tz: string, now: Date): string | null {
  const today = dayInZone(tz, now);
  const tomorrow = addDaysToDay(today, 1);
  const lines: string[] = [];
  const visits = orders.filter((o) => o.status === "scheduled" && o.scheduledFor?.slice(0, 10) === tomorrow);
  for (const v of visits.slice(0, 2)) lines.push(`🔧 The landlord's coming tomorrow${visitTime(v.scheduledFor!)} about ${v.title}. Someone be home?`);
  const quiet = orders
    .filter((o) => (o.status === "sent" || o.status === "acknowledged") && !visits.includes(o))
    .map((o) => ({ o, days: daysBetweenDays(dayInZone(tz, o.lastActivityAt), today) }))
    .filter(({ days }) => days >= FOLLOW_UP_DAYS && days % FOLLOW_UP_DAYS === 0)
    .sort((a, b) => b.days - a.days)[0];
  if (quiet) lines.push(`📭 Nothing from the landlord about ${quiet.o.title} in ${quiet.days} days. Want me to follow up?`);
  return lines.length ? lines.join(" ") : null;
}

/** The weekly report's part: "Lease inbox: 1 notice, 2 other emails". Null for a quiet week. */
export function leaseReportText(notices: number, others: number): string | null {
  if (!notices && !others) return null;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return `Lease inbox: ${[notices ? n(notices, "notice", "notices") : null, others ? n(others, "other email", "other emails") : null].filter(Boolean).join(", ")}`;
}

/**
 * A Member's own words confirm a send Roomie asked about ("yes", "send it", "go ahead"), and don't take it back
 * ("no", "don't send", "wait"). sendToLandlord reads it on the Member's latest message, and only to release a send it
 * held for that Member and that exact draft.
 */
export function saysYes(latest: string | undefined | null): boolean {
  if (!latest) return false;
  const text = latest.toLowerCase().replace(/\broomie\b[,:]?/g, " ");
  if (/\b(?:no|nope|don'?t|do not|wait|hold on|stop|cancel|never mind)\b/.test(text)) return false;
  return /\b(?:yes|yep|yeah|yup|sure|ok(?:ay)?|send it|go ahead|do it|confirm(?:ed)?|that'?s right|correct)\b/.test(text);
}

/** Words that say nothing about which work order: "what's up with the sink?" is about "sink". */
const FILLER = new Set([
  "the", "what", "whats", "with", "up", "is", "how", "about", "going", "on", "my", "our", "status", "they", "them", "their",
  "there", "that", "this", "these", "those", "news", "update", "updates", "landlord", "work", "order", "orders", "happening",
  "happened", "when", "where", "coming", "still", "from", "have", "been", "does", "doing", "anything", "someone", "fixed",
  "fixing", "repair", "please", "roomie", "hear", "heard", "back",
]);

/** The words of a question that could name a work order: 4+ letters, not filler. */
export function topicWords(text: string): string[] {
  return [...new Set((text.toLowerCase().replace(/['’]/g, "").match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 4 && !FILLER.has(w)))];
}

const sameWord = (a: string, b: string) => a === b || a === `${b}s` || b === `${a}s`;

export type OrderPick<T> = { order: T } | { choices: T[] } | null;

/**
 * "What's up with the sink?": which work order (newest first in `orders`). One open order: that one, whatever was
 * said. Otherwise the one whose title has a word of the question as a whole word (one open match beats a closed one);
 * several or none with more than one open: the open ones, to ask which. No open orders and no words: the newest.
 */
export function pickWorkOrder<T extends { title: string; status: string }>(orders: readonly T[], what: string | undefined): OrderPick<T> {
  const open = orders.filter((o) => o.status !== "done");
  if (open.length === 1) return { order: open[0] };
  const words = topicWords(what ?? "");
  const hits = words.length ? orders.filter((o) => topicWords(o.title).some((t) => words.some((w) => sameWord(w, t)))) : [];
  const openHits = hits.filter((o) => o.status !== "done");
  if (openHits.length === 1) return { order: openHits[0] };
  if (hits.length === 1) return { order: hits[0] };
  if (open.length > 1) return { choices: open };
  if (hits.length) return { order: hits[0] };
  return words.length || !orders.length ? null : { order: orders[0] };
}

/** Which kind of Document an email's attachment is (ADR 0018): a lease by its name, else by the email's class. */
export function attachmentKind(mailClass: string | null, utility: string | null, filename: string | null): "lease" | "notice" | "bill" | "email" {
  if (filename && /\blease\b|\brenewal\b/i.test(filename.replace(/[_-]+/g, " "))) return "lease";
  if (mailClass === "notice") return "notice";
  if (mailClass === "rent-lease") return "lease";
  if (utility || (filename && /\b(?:bill|invoice|statement)\b/i.test(filename.replace(/[_-]+/g, " ")))) return "bill";
  return "email";
}
