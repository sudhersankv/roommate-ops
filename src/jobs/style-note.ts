// The Learned style, grown in the background (ADR 0012). Run from the scheduler tick: once a Group has logged
// STYLE_EVERY chat lines since groups.style_note_at, Haiku proposes candidates from the new human lines (languages,
// code-switching, slang, tone, nicknames, running jokes) and lib/style-stats.ts counts and merges them in code into
// groups.personality.learned. Confidence comes from how many messages have been seen, never from the model. A short
// mirror goes to working memory's "## Group style" section.
import { eq } from "drizzle-orm";
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { db, schema } from "@/db";
import { smallModel } from "@/lib/llm";
import { replaceSection, shouldRefreshStyle } from "@/lib/style-note";
import { learnedNote, mergeLearned, type StyleCandidates, type StyleLine } from "@/lib/style-stats";
import { humanLinesSince, linesSince } from "@/services/chatlog";
import { getGroup } from "@/services/groups";
import { getPersonality, saveLearned } from "@/services/personality";
import { memory, STYLE_HEADING, threadFor, WORKING_MEMORY_TEMPLATE } from "@/mastra/memory";

const candidatesSchema = z.object({
  languages: z.array(z.object({ name: z.string(), share: z.number().min(0).max(1) })).describe("Languages, share of messages 0-1, most used first"),
  codeSwitching: z.number().min(0).max(1).describe("Share of messages that mix two languages"),
  slang: z.array(z.string()).max(15).describe("Recurring slang words or short phrases, exactly as written"),
  tone: z.array(z.string()).max(5).describe("A few tone words, e.g. dry, teasing, warm"),
  nicknames: z.array(z.object({ nickname: z.string(), member: z.string() })).max(10).describe("A nickname people use for a member, and that member's name"),
  insideJokes: z.array(z.string()).max(10).describe("Short running jokes or catchphrases, exactly as written"),
});

const styleReader = new Agent({
  id: "group-style",
  name: "Group style",
  model: smallModel,
  instructions: `You study how one group chat talks so their pet Roomie can slowly sound like them.
Given recent messages ("[Name] text"), propose:
- languages with the share of messages in each, and the share of messages mixing languages (e.g. Hinglish, Spanglish)
- slang words and short phrases they repeat, copied exactly (not names, not normal words)
- a few tone words
- nicknames: a word people use to address or mention a member that isn't their name, with that member's real name
- running jokes or catchphrases, copied exactly
Only include what is in the messages. Never include private facts, money amounts or addresses.`,
});

export type CandidateReader = (lines: StyleLine[]) => Promise<StyleCandidates>;

const modelReader: CandidateReader = async (lines) => {
  const res = await styleReader.generate(lines.map((l) => `[${l.name}] ${l.text}`).join("\n"), { structuredOutput: { schema: candidatesSchema } });
  return res.object as StyleCandidates;
};

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
  const learned = mergeLearned(personality.learned, lines, candidates, group.timezone, now);
  await saveLearned(groupId, learned);
  const { thread, resource } = threadFor(groupId);
  const current = (await memory.getWorkingMemory({ threadId: thread, resourceId: resource }).catch(() => null)) || WORKING_MEMORY_TEMPLATE;
  await memory.updateWorkingMemory({ threadId: thread, resourceId: resource, workingMemory: replaceSection(current, STYLE_HEADING, learnedNote(learned)) });
  return true;
}
