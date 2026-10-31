// Quiet hours (ADR 0017): 22:00 to 08:00 in the Group's time zone, no unprompted posts and no DMs that aren't a reply.
// Fixed for now (a setting later). Pure, Intl only (quiet-hours.test.ts covers DST).
import { zonedParts, zonedTimeToUtc } from "./time";

export const QUIET_START = 22;
export const QUIET_END = 8;

/** Is this local hour (0-23) inside quiet hours? */
export const quietHour = (hour: number) => hour >= QUIET_START || hour < QUIET_END;

export function inQuietHours(now: Date, tz: string): boolean {
  return quietHour(zonedParts(tz, now).hour);
}

/** `now` when it's daytime; inside quiet hours, the next 08:00 local (tonight's 23:00 -> tomorrow 08:00). */
export function nextAllowed(now: Date, tz: string): Date {
  const p = zonedParts(tz, now);
  if (!quietHour(p.hour)) return now;
  const day = p.hour >= QUIET_START ? p.day + 1 : p.day;
  return zonedTimeToUtc(tz, { year: p.year, month: p.month, day, hour: QUIET_END, minute: 0 });
}

/** A stored nudge hour inside quiet hours goes out at 08:00 instead. */
export const daytimeHour = (hour: number) => (quietHour(hour) ? QUIET_END : hour);
