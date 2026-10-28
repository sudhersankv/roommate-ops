// Studio request-context presets for the dev household: one per member, plus a Gate-narrowed and an unprompted
// variant. Written to .mastra-presets.json (gitignored: the ids are per database).
import { writeFileSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "../../src/db";
import { listMembers } from "../../src/services/members";
import type { RoomieContext } from "../../src/mastra/context";

export const PRESETS_FILE = ".mastra-presets.json";

/** The household Studio should use: SEED_HOUSEHOLD_ID, else "Apt 4B", else the oldest. */
async function devHousehold() {
  const id = process.env.SEED_HOUSEHOLD_ID;
  if (id) return (await db.select().from(schema.households).where(eq(schema.households.id, id)))[0];
  const [named] = await db.select().from(schema.households).where(eq(schema.households.name, "Apt 4B"));
  return named ?? (await db.select().from(schema.households).orderBy(asc(schema.households.createdAt)).limit(1))[0];
}

export async function writeStudioPresets(): Promise<Record<string, RoomieContext> | null> {
  const house = await devHousehold();
  const presets: Record<string, RoomieContext> = {};
  if (house) {
    const people = await listMembers({ householdId: house.id });
    for (const m of people) presets[`${house.name} as ${m.name}`] = { householdId: house.id, actorId: m.id, actorName: m.name, source: "chat" };
    const first = people[0];
    if (first) {
      const base = { householdId: house.id, actorId: first.id, actorName: first.name, source: "chat" as const };
      presets[`${house.name}: Gate picked groceries`] = { ...base, toolkit: "groceries" };
      presets[`${house.name}: unprompted (ask before logging)`] = { ...base, gate: { decision: "act", unprompted: true } };
    }
  }
  writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2) + "\n");
  return house ? presets : null;
}
