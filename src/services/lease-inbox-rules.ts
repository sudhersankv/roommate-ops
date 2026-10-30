// Pure Lease Inbox rules (ADR 0016): the work-order state machine and when a notice is urgent (ADR 0017's urgent
// slot). The classifier reads the landlord's reply; these decide what it does.
import { WORK_ORDER_STATUSES, type WorkOrderStatus } from "@/db/enums";
import { dayInZone, parseInZone, zonedTimeToUtc } from "@/lib/time";

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
