// The dashboard dock (#46): which two learned Tricks sit next to Home and Ask Roomie, per Member, on every device.
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { MANIFESTS } from "@/toolkits/manifests";
import { NotAllowedError } from "./authz";
import { cleanDock, pickDock, tricksWithPages } from "./dock-rules";
import { enabledToolkits } from "./groups";
import { getMember } from "./members";
import type { Ctx } from "./types";

async function dockable(ctx: Ctx): Promise<string[]> {
  const on = Object.fromEntries((await enabledToolkits(ctx)).map((id) => [id, true]));
  return tricksWithPages(MANIFESTS, on).map((m) => m.id);
}

/**
 * Your own dock: the Tricks in the order given (left, right). Only learned Tricks with a page count; repeats and
 * anything else are dropped, and nothing left is refused. An empty list goes back to the default (the first two by
 * nav order). Only ever the signed-in Member's own row. Returns the dock as it now shows.
 */
export async function setDock(ctx: Ctx, input: { tricks: readonly string[] }): Promise<{ dock: string[] }> {
  const me = await getMember(ctx, ctx.memberId);
  if (!me || me.status === "removed") throw new NotAllowedError("You're not in this group anymore.", "removed");
  const available = await dockable(ctx);
  const saved = cleanDock(available, input.tricks);
  if (input.tricks.length && !saved.length) throw new Error("Roomie hasn't learned that here, so it can't go in the dock.");
  await db
    .update(schema.members)
    .set({ dock: saved.length ? saved : null })
    .where(eq(schema.members.id, me.id));
  return { dock: pickDock(available, saved) };
}
