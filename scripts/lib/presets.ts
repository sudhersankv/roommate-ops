// Studio request-context presets for the dev Group: one per Member (Pending ones included), plus a Gate-narrowed
// and an unprompted variant. Written to .mastra-presets.json (gitignored: the ids are per database).
import { writeFileSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "../../src/db";
import { listGroupMembers } from "../../src/services/members";
import type { RoomieContext } from "../../src/mastra/context";

export const PRESETS_FILE = ".mastra-presets.json";

/** The Group Studio should use: SEED_GROUP_ID, else "Apt 4B", else the oldest. */
async function devGroup() {
  const id = process.env.SEED_GROUP_ID;
  if (id) return (await db.select().from(schema.groups).where(eq(schema.groups.id, id)))[0];
  const [named] = await db.select().from(schema.groups).where(eq(schema.groups.name, "Apt 4B")).orderBy(asc(schema.groups.createdAt)).limit(1);
  return named ?? (await db.select().from(schema.groups).orderBy(asc(schema.groups.createdAt)).limit(1))[0];
}

export async function writeStudioPresets(): Promise<Record<string, RoomieContext> | null> {
  const group = await devGroup();
  const presets: Record<string, RoomieContext> = {};
  if (group) {
    const people = await listGroupMembers({ groupId: group.id });
    const as = (m: (typeof people)[number]): RoomieContext => ({ groupId: group.id, memberId: m.id, memberName: m.displayName, role: m.role, status: m.status, source: "chat" });
    for (const m of people) presets[`${group.name} as ${m.displayName}${m.status === "pending" ? " (pending)" : ""}`] = as(m);
    const first = people.find((m) => m.status === "active");
    if (first) {
      presets[`${group.name}: Gate picked groceries`] = { ...as(first), toolkit: "groceries" };
      presets[`${group.name}: unprompted (ask before logging)`] = { ...as(first), gate: { decision: "act", unprompted: true } };
    }
  }
  writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2) + "\n");
  return group ? presets : null;
}
