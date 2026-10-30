// Roomie's personality for a Group (groups.personality, ADR 0012) and its mood. The model and the rules are pure in
// lib/personality.ts; this file reads and writes them with permissions. Admins change the archetype, name, quirks and
// dials; the Learned style is written only by the style job (jobs/style-note.ts) and reset only by an Admin.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  applyPersonalityPatch,
  emptyLearned,
  moodFrom,
  normalizePersonality,
  validatePersonalityPatch,
  type LearnedStyle,
  type Personality,
  type PersonalityPatch,
  type PetMood,
} from "@/lib/personality";
import { recordFor } from "./activity";
import { requireAdmin } from "./authz";
import { getBalances } from "./money";
import type { Ctx, GroupCtx } from "./types";

const { groups, chatMessages } = schema;

export async function getPersonality(ctx: GroupCtx): Promise<Personality> {
  const [row] = await db.select({ p: groups.personality }).from(groups).where(eq(groups.id, ctx.groupId));
  return normalizePersonality(row?.p);
}

const LABELS: Record<string, string> = { base: "vibe", name: "name", quirks: "quirks", languages: "languages", emoji: "emoji", humor: "humor", formality: "formality" };

/**
 * Admin: change the archetype ("base"), name, quirks, languages or dials. Changing the archetype puts the dials back
 * to its defaults unless they're in the same patch. The Learned style is never touched here.
 */
export async function updatePersonality(ctx: Ctx, patch: PersonalityPatch): Promise<Personality> {
  await requireAdmin(ctx);
  const clean = validatePersonalityPatch(patch);
  const keys = Object.keys(clean);
  if (!keys.length) return getPersonality(ctx);
  const set: Record<string, unknown> = {};
  const drop: string[] = [];
  for (const [k, v] of Object.entries(clean)) {
    if (v === null) drop.push(k);
    else set[k] = v;
  }
  // Top-level keys merged in SQL, so a concurrent Learned style write (jsonb_set on "learned") isn't lost.
  await db
    .update(groups)
    .set({ personality: sql`(${groups.personality} || ${JSON.stringify(set)}::jsonb) - ${`{${drop.join(",")}}`}::text[]` })
    .where(eq(groups.id, ctx.groupId));
  const shown = Object.keys(patch).filter((k) => k in clean);
  await recordFor(ctx, "group.personality", `changed Roomie's ${shown.map((k) => LABELS[k] ?? k).join(", ")}`, { table: "groups", id: ctx.groupId });
  return getPersonality(ctx);
}

/** Pure preview of a patch (the dashboard and tests): what the personality would be. */
export const previewPatch = (p: Personality, patch: PersonalityPatch) => applyPersonalityPatch(p, validatePersonalityPatch(patch));

/** Internal (jobs/style-note.ts): write the Learned style without touching anything the Admin set. */
export async function saveLearned(groupId: string, learned: LearnedStyle): Promise<void> {
  await db
    .update(groups)
    .set({ personality: sql`jsonb_set(${groups.personality}, '{learned}', ${JSON.stringify(learned)}::jsonb, true)` })
    .where(eq(groups.id, groupId));
}

/** Admin: "Reset what you've learned": the Learned style goes back to empty and its note in Roomie's memory too. */
export async function resetLearned(ctx: Ctx): Promise<Personality> {
  await requireAdmin(ctx);
  await saveLearned(ctx.groupId, emptyLearned());
  await db.update(groups).set({ styleNoteAt: new Date() }).where(eq(groups.id, ctx.groupId));
  const { resetStyleInMemory } = await import("@/mastra/forget");
  await resetStyleInMemory(ctx.groupId).catch((e) => console.warn("[personality] memory reset failed", e));
  await recordFor(ctx, "group.personality", "reset what Roomie learned about the group's style", { table: "groups", id: ctx.groupId });
  return getPersonality(ctx);
}

/* ---------- mood ---------- */

export async function lastHumanMessageAt(groupId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: chatMessages.createdAt })
    .from(chatMessages)
    .where(and(eq(chatMessages.groupId, groupId), isNotNull(chatMessages.memberId)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);
  return row?.at ?? null;
}

/**
 * The Group's mood, for the dashboard's dino and one line of the agent's instructions: worried when anyone owes more
 * than $100, sleepy after 5 days without a message, happy when everyone's square, calm otherwise.
 */
export async function groupMood(ctx: GroupCtx, now = new Date()): Promise<{ mood: PetMood; reason: string }> {
  const [balances, lastMessageAt] = await Promise.all([getBalances(ctx), lastHumanMessageAt(ctx.groupId)]);
  const maxOwedCents = Math.max(0, ...balances.map((b) => -b.cents));
  return moodFrom({ maxOwedCents, allSquare: balances.every((b) => b.cents === 0), lastMessageAt, now });
}

/** Everyone's Balance is zero (a "square" win after a Settlement). */
export async function allSquare(ctx: GroupCtx): Promise<boolean> {
  return (await getBalances(ctx)).every((b) => b.cents === 0);
}
