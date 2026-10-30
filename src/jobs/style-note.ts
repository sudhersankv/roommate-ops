// The Learned style, grown in the background (ADR 0012). Run from the scheduler tick: once a Group has logged
// STYLE_EVERY chat lines since groups.style_note_at, Haiku proposes candidates from the new human lines (languages,
// code-switching, slang, tone, nicknames, running jokes) and lib/style-stats.ts counts and merges them in code into
// groups.personality.learned. Confidence comes from how many messages have been seen, never from the model. A short
// mirror goes to working memory's "## Group style" section.
import { eq } from "drizzle-orm";
import { Agent } from "@mastra/core/agent";
import { db, schema } from "@/db";
import { smallModel } from "@/lib/llm";
import { replaceSection, shouldRefreshStyle } from "@/lib/style-note";
import { learnedNote, mergeLearned } from "@/lib/style-stats";
import { humanLinesSince, linesSince } from "@/services/chatlog";
import { getGroup } from "@/services/groups";
import { getPersonality, saveLearned } from "@/services/personality";
import { memory, STYLE_HEADING, threadFor, WORKING_MEMORY_TEMPLATE } from "@/mastra/memory";
import { readerFrom, STYLE_INSTRUCTIONS, type CandidateReader } from "./style-candidates";

export type { CandidateReader } from "./style-candidates";

const styleReader = new Agent({ id: "group-style", name: "Group style", model: smallModel, instructions: STYLE_INSTRUCTIONS });

// A plain text call, parsed with zod (style-candidates.ts): the gateway rejects structured output for newer models.
const modelReader: CandidateReader = readerFrom(async (prompt) => (await styleReader.generate(prompt)).text ?? "");

let reader: CandidateReader = modelReader;
/** Tests and evals: replace the model (null restores it). */
export const setCandidateReader = (r: CandidateReader | null) => void (reader = r ?? modelReader);

export const linesSinceStyleNote = linesSince;

/** Fold one Group's new lines into its Learned style if it's due. Returns true when it changed. */
export async function refreshStyleNote(groupId: string, styleNoteAt: Date | null, now = new Date(), force = false): Promise<boolean> {
  if (!force && !shouldRefreshStyle(await linesSince(groupId, styleNoteAt))) return false;
  const [group, personality, lines] = await Promise.all([getGroup(groupId), getPersonality({ groupId }), humanLinesSince(groupId, styleNoteAt)]);
  await db.update(schema.groups).set({ styleNoteAt: now }).where(eq(schema.groups.id, groupId));
  if (!group || !lines.length) return false;
  const candidates = await reader(lines);
  // Not the JSON we asked for: skip this batch (styleNoteAt has moved on, so the next one is fresh lines).
  if (!candidates) return false;
  const learned = mergeLearned(personality.learned, lines, candidates, group.timezone, now);
  await saveLearned(groupId, learned);
  const { thread, resource } = threadFor(groupId);
  const current = (await memory.getWorkingMemory({ threadId: thread, resourceId: resource }).catch(() => null)) || WORKING_MEMORY_TEMPLATE;
  await memory.updateWorkingMemory({ threadId: thread, resourceId: resource, workingMemory: replaceSection(current, STYLE_HEADING, learnedNote(learned)) });
  return true;
}
