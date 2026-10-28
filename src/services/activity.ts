// Activity: the Group's record of who added, changed or deleted what. Services write it; the Money page reads it.
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { GroupCtx } from "./types";

const { activity, members } = schema;

export type ActivityEntry = {
  id: string;
  actorMemberId: string | null; // null = Roomie
  actorName: string;
  kind: string;
  summary: string;
  refTable: string | null;
  refId: string | null;
  createdAt: Date;
};

/** `actorMemberId` null means Roomie did it. `summary` reads after the actor's name ("added Pizza, $24.00"). */
export async function record(
  groupId: string,
  actorMemberId: string | null,
  kind: string,
  summary: string,
  ref?: { table: string; id: string },
): Promise<void> {
  await db.insert(activity).values({ groupId, actorMemberId, kind, summary, refTable: ref?.table ?? null, refId: ref?.id ?? null });
}

export async function listActivity(ctx: GroupCtx, limit = 50): Promise<ActivityEntry[]> {
  const rows = await db
    .select({
      id: activity.id,
      actorMemberId: activity.actorMemberId,
      actorName: members.displayName,
      kind: activity.kind,
      summary: activity.summary,
      refTable: activity.refTable,
      refId: activity.refId,
      createdAt: activity.createdAt,
    })
    .from(activity)
    .leftJoin(members, eq(activity.actorMemberId, members.id))
    .where(eq(activity.groupId, ctx.groupId))
    .orderBy(desc(activity.createdAt), desc(activity.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, actorName: r.actorMemberId ? (r.actorName ?? "Someone") : "Roomie" }));
}
