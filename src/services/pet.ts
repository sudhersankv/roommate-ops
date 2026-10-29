// Small pet behaviours that must happen once: the day's greeting and the reaction to a win (docs/personality.md).
// "Once" is a claim on pet_moments (primary key group + kind + key); MomentStore lets pet.test.ts check the rules
// with an in-memory store. What gets said comes from lib/personality.ts (no LLM). Delivery stays with the pipeline
// and the Channel adapter, so the rate limits of ADR 0001 apply as to any other message.
import { db, schema } from "@/db";
import type { Chattiness } from "./groups";
import { greetingLine, winLine, type Personality, type Win } from "@/lib/personality";
import { localDay } from "@/lib/dates";
import { localHour } from "@/lib/style-stats";

export type MomentKind = "greeting" | "win";
export type MomentStore = { claim(groupId: string, kind: MomentKind, key: string): Promise<boolean> };

/** Claims in Postgres: true only for the first caller, ever, per (group, kind, key). */
export const dbMoments: MomentStore = {
  async claim(groupId, kind, key) {
    const rows = await db.insert(schema.petMoments).values({ groupId, kind, key }).onConflictDoNothing().returning({ key: schema.petMoments.key });
    return rows.length > 0;
  },
};

/** Same contract in memory (tests, evals that pre-claim). */
export function memoryMoments(): MomentStore & { claimed: Set<string> } {
  const claimed = new Set<string>();
  return {
    claimed,
    async claim(groupId, kind, key) {
      const k = `${groupId}|${kind}|${key}`;
      if (claimed.has(k)) return false;
      claimed.add(k);
      return true;
    },
  };
}

export type GreetFacts = {
  groupId: string;
  chattiness: Chattiness;
  personality: Personality;
  timezone: string;
  /** When Roomie last posted in the Chat (null = never). */
  roomieSpokeAt: Date | null;
  now?: Date;
};

/**
 * The first message of the Group's local day gets one short hello, once: never when Chattiness is quiet, and not
 * when Roomie already posted today (its intro, a reminder). The day is claimed either way, so it's asked once a day.
 * Returns the line, or null.
 */
export async function dayGreeting(store: MomentStore, f: GreetFacts): Promise<string | null> {
  if (f.chattiness === "quiet") return null;
  const now = f.now ?? new Date();
  const day = localDay(now, f.timezone);
  if (!(await store.claim(f.groupId, "greeting", day))) return null;
  if (f.roomieSpokeAt && localDay(f.roomieSpokeAt, f.timezone) === day) return null;
  return greetingLine(f.personality, localHour(now, f.timezone), `${f.groupId}:${day}`);
}

/** Wins not celebrated before, claimed now, as one short line each (the pipeline adds at most one). */
export async function claimWins(store: MomentStore, groupId: string, wins: Win[], personality: Personality): Promise<string[]> {
  const out: string[] = [];
  for (const w of wins) if (await store.claim(groupId, "win", w.key)) out.push(winLine(personality, w));
  return out;
}
