// The Pantry: what the Group always has (salt, oil, rice), so a Recipe's shopping list leaves it out. Kept in the
// Groceries Toolkit's settings (group_toolkits.settings.pantry); any active Member can change it.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { record, sourceOf } from "./activity";
import { requireActive } from "./authz";
import { pantryName } from "./recipe-math";
import type { Ctx, GroupCtx } from "./types";

const { groupToolkits } = schema;
const MAX_ITEMS = 60;

export async function getPantry(ctx: GroupCtx): Promise<string[]> {
  const [row] = await db
    .select({ settings: groupToolkits.settings })
    .from(groupToolkits)
    .where(and(eq(groupToolkits.groupId, ctx.groupId), eq(groupToolkits.toolkit, "groceries")));
  const list = (row?.settings as { pantry?: unknown } | undefined)?.pantry;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}

export const STARTER_PANTRY = ["oil", "pepper", "salt"];

/**
 * Groceries' onEnable: a starter Pantry, only for a Group that never had one (an emptied Pantry stays empty).
 * Not a Member's edit, so no Activity row.
 */
export async function seedPantry(ctx: GroupCtx, items: string[] = STARTER_PANTRY): Promise<void> {
  const [row] = await db
    .select({ settings: groupToolkits.settings })
    .from(groupToolkits)
    .where(and(eq(groupToolkits.groupId, ctx.groupId), eq(groupToolkits.toolkit, "groceries")));
  if (row && (row.settings as { pantry?: unknown }).pantry !== undefined) return;
  const value = { pantry: items.map(pantryName).sort() };
  await db
    .insert(groupToolkits)
    .values({ groupId: ctx.groupId, toolkit: "groceries", enabled: true, settings: value })
    .onConflictDoUpdate({
      target: [groupToolkits.groupId, groupToolkits.toolkit],
      set: { settings: sql`${groupToolkits.settings} || ${JSON.stringify(value)}::jsonb` },
    });
}

/** Add and/or remove Pantry items (names are normalized; duplicates ignored). Returns the new Pantry, A to Z. */
export async function updatePantry(ctx: Ctx, input: { add?: string[]; remove?: string[] }): Promise<string[]> {
  await requireActive(ctx);
  const add = (input.add ?? []).map(pantryName).filter(Boolean);
  const remove = new Set((input.remove ?? []).map(pantryName).filter(Boolean));
  if (add.length === 0 && remove.size === 0) throw new Error("What should go in (or come out of) the pantry?");
  const next = await db.transaction(async (tx) => {
    // Lock the row so two edits at once both stick.
    const [row] = await tx
      .select({ settings: groupToolkits.settings })
      .from(groupToolkits)
      .where(and(eq(groupToolkits.groupId, ctx.groupId), eq(groupToolkits.toolkit, "groceries")))
      .for("update");
    const before = Array.isArray((row?.settings as { pantry?: unknown })?.pantry) ? ((row!.settings as { pantry: string[] }).pantry) : [];
    const list = [...new Set([...before.map(pantryName), ...add])].filter((x) => !remove.has(x)).sort().slice(0, MAX_ITEMS);
    const value = { pantry: list };
    await tx
      .insert(groupToolkits)
      .values({ groupId: ctx.groupId, toolkit: "groceries", enabled: true, settings: value })
      .onConflictDoUpdate({
        target: [groupToolkits.groupId, groupToolkits.toolkit],
        set: { settings: sql`${groupToolkits.settings} || ${JSON.stringify(value)}::jsonb` },
      });
    return list;
  });
  const parts = [add.length ? `added ${add.join(", ")} to` : "", remove.size ? `took ${[...remove].join(", ")} out of` : ""].filter(Boolean);
  await record(ctx.groupId, ctx.memberId, "pantry.changed", `${parts.join(" and ")} the pantry`, undefined, sourceOf(ctx));
  return next;
}
