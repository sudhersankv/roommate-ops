// The Group's place (#78): one saved pin, "this is our place". It makes "near us" look-ups local. Kept on core's
// group_toolkits row (settings.place), next to the report's day and hour, so it needs no column of its own.
// Any active Member may set it (it's where the group lives, not a permission); it's an Activity row like any change.
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { groupToolkits } from "@/db/schema";
import { cleanPin, pinLabel, type Pin } from "@/lib/place";
import { requireActive } from "./authz";
import { recordFor } from "./activity";
import type { Ctx, GroupCtx } from "./types";

export type GroupPlace = Pin & { savedBy?: string; savedAt?: string };

const CORE = "core";

/** The saved place, or null (none yet, or a stored value that no longer reads as a pin). */
export async function getPlace(ctx: GroupCtx): Promise<GroupPlace | null> {
  const [row] = await db
    .select({ settings: groupToolkits.settings })
    .from(groupToolkits)
    .where(and(eq(groupToolkits.groupId, ctx.groupId), eq(groupToolkits.toolkit, CORE)));
  const raw = (row?.settings as { place?: Record<string, unknown> } | undefined)?.place;
  const pin = cleanPin(raw);
  if (!pin) return null;
  return { ...pin, ...(typeof raw?.savedBy === "string" ? { savedBy: raw.savedBy } : {}), ...(typeof raw?.savedAt === "string" ? { savedAt: raw.savedAt } : {}) };
}

export class BadPinError extends Error {
  name = "BadPinError";
  constructor() {
    super("That pin didn't come through with a location. Share it again?");
  }
}

/** "this is our place" on a shared pin: saves it (replacing any earlier one). Returns the place and what it replaced. */
export async function savePlace(ctx: Ctx, input: { lat?: unknown; lng?: unknown; name?: unknown; address?: unknown }): Promise<{ place: GroupPlace; replaced: Pin | null }> {
  await requireActive(ctx);
  const pin = cleanPin(input);
  if (!pin) throw new BadPinError();
  const replaced = await getPlace(ctx);
  const place: GroupPlace = { ...pin, savedBy: ctx.memberId, savedAt: new Date().toISOString() };
  await db
    .insert(groupToolkits)
    .values({ groupId: ctx.groupId, toolkit: CORE, enabled: true, settings: { place } })
    .onConflictDoUpdate({
      target: [groupToolkits.groupId, groupToolkits.toolkit],
      set: { settings: sql`${groupToolkits.settings} || ${JSON.stringify({ place })}::jsonb` },
    });
  await recordFor(ctx, "group.place", `saved the group's place: ${pinLabel(pin)}`, { table: "groups", id: ctx.groupId });
  return { place, replaced };
}
