// The global kill switch (audit H1): ROOMIE_PAUSED=1 and Roomie answers nothing, posts nothing and joins nothing.
// Webhooks still answer 200, so Telegram doesn't replay a backlog when it's switched off again. Per-Group pauses are
// groups.paused_at (/admin/groups).

export const roomiePaused = () => process.env.ROOMIE_PAUSED?.trim() === "1";

const LOG_EVERY_MS = 60_000;

/** One "[paused]" log line per minute at most, whatever is being skipped. */
export function logPaused(what: string, now = Date.now()) {
  const g = globalThis as { __roomiePausedLogAt?: number };
  if (g.__roomiePausedLogAt && now - g.__roomiePausedLogAt < LOG_EVERY_MS) return;
  g.__roomiePausedLogAt = now;
  console.log(`[paused] ROOMIE_PAUSED=1: skipping ${what} (and anything else for a minute)`);
}
