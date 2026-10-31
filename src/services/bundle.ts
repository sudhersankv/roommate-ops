// The morning Bundle (ADR 0017): Roomie's one post a day at the Group's nudge hour, made of a line per enabled
// Toolkit that has something to say (`bundle()` on the manifest contract), in post order, then core's own line (the
// whole-group Reminders due today). No lines, no post. Core never names a Toolkit; the scheduler claims the post
// before sending (jobs/scheduler.ts). composeBundle and coreBundleLine are pure.
import { dayInZone, formatInZone } from "@/lib/time";
import { getGroup } from "./groups";
import { listReminders, type Reminder } from "./reminders";
import { DEFAULT_TIMEZONE } from "./schedule";
import { enabledToolkitEntries } from "./toolkits";
import type { GroupCtx } from "./types";

/** The lines that have something to say, one per line; null when none do (then nothing is posted). */
export function composeBundle(lines: readonly (string | null | undefined)[]): string | null {
  const said = lines.filter((l): l is string => !!l?.trim());
  return said.length ? said.join("\n") : null;
}

/** Core's line: the whole-group Reminders still to go off today (local), at most three; null when there are none. */
export function coreBundleLine(upcoming: readonly Pick<Reminder, "text" | "dueAt" | "memberId">[], tz: string, now: Date): string | null {
  const today = dayInZone(tz, now);
  const due = upcoming.filter((r) => !r.memberId && r.dueAt.getTime() >= now.getTime() && dayInZone(tz, r.dueAt) === today);
  if (!due.length) return null;
  const list = due.slice(0, 3).map((r) => `${r.text.trim().replace(/[.!]+$/, "")} (${formatInZone(r.dueAt, tz, { hour: "numeric", minute: "2-digit" }).replace(":00", "")})`);
  return `⏰ Today: ${list.join(", ")}${due.length > 3 ? `, +${due.length - 3} more` : ""}.`;
}

/** The Bundle's text for a Group right now, or null. */
export async function groupBundle(ctx: GroupCtx, now = new Date()): Promise<string | null> {
  const [toolkits, group, upcoming] = await Promise.all([enabledToolkitEntries(ctx), getGroup(ctx.groupId), listReminders(ctx, { groupOnly: true })]);
  const lines = await Promise.all(toolkits.map((t) => t.bundle?.(ctx, now) ?? Promise.resolve(null)));
  return composeBundle([...lines, coreBundleLine(upcoming, group?.timezone ?? DEFAULT_TIMEZONE, now)]);
}
