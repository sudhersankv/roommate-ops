// The morning Bundle (ADR 0017): Roomie's one post a day at the Group's nudge hour, made of a line per enabled
// Toolkit that has something to say (`bundle()` on the manifest contract), in post order. No lines, no post. Core
// never names a Toolkit; the scheduler claims the post before sending (jobs/scheduler.ts). composeBundle is pure.
import { enabledToolkitEntries } from "./toolkits";
import type { GroupCtx } from "./types";

/** The lines that have something to say, one per line; null when none do (then nothing is posted). */
export function composeBundle(lines: readonly (string | null | undefined)[]): string | null {
  const said = lines.filter((l): l is string => !!l?.trim());
  return said.length ? said.join("\n") : null;
}

/** The Bundle's text for a Group right now, or null. */
export async function groupBundle(ctx: GroupCtx, now = new Date()): Promise<string | null> {
  const toolkits = await enabledToolkitEntries(ctx);
  return composeBundle(await Promise.all(toolkits.map((t) => t.bundle?.(ctx, now) ?? Promise.resolve(null))));
}
