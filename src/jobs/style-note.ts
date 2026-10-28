// Group style, grown in the background (memory.ts explains where it lives). Run from the scheduler tick: once a
// Group has logged STYLE_EVERY chat lines since groups.style_note_at, Haiku rewrites the "## Group style"
// section of working memory from the latest lines, and the agent reads it on its next reply.
import { eq } from "drizzle-orm";
import { Agent } from "@mastra/core/agent";
import { db, schema } from "@/db";
import { smallModel } from "@/lib/llm";
import { readSection, replaceSection, shouldRefreshStyle, STYLE_EVERY } from "@/lib/style-note";
import { linesSince, recentChatter } from "@/services/chatlog";
import { memory, STYLE_HEADING, threadFor, WORKING_MEMORY_TEMPLATE } from "@/mastra/memory";

const styleWriter = new Agent({
  id: "group-style",
  name: "Group style",
  model: smallModel,
  instructions: `You keep a tiny note on how one group chat talks, so their AI groupmate Roomie can sound like them.
Given the current note and recent messages, return ONLY the updated note as exactly these four lines:
- Languages: <languages they write in, most used first>
- Slang and in-jokes: <a few recurring words, nicknames or jokes, or "none yet">
- Tone: <a few words, e.g. "dry, teasing, lots of emoji">
- Confidence (0-1): <how sure you are, rising slowly with evidence; never above the old value + 0.2>
Keep what still holds, change what the messages contradict. No names of private facts, no money amounts.`,
});

export const linesSinceStyleNote = linesSince;

/** Refresh one Group's style if it's due. Returns true when the note was rewritten. */
export async function refreshStyleNote(groupId: string, styleNoteAt: Date | null, now = new Date(), force = false): Promise<boolean> {
  if (!force && !shouldRefreshStyle(await linesSince(groupId, styleNoteAt))) return false;
  const lines = await recentChatter(groupId, 60 * 24 * 30, STYLE_EVERY);
  const { thread, resource } = threadFor(groupId);
  const current = (await memory.getWorkingMemory({ threadId: thread, resourceId: resource })) || WORKING_MEMORY_TEMPLATE;
  const res = await styleWriter.generate(`Current note:\n${readSection(current, STYLE_HEADING)}\n\nRecent messages:\n${lines.join("\n")}`);
  const note = res.text.trim();
  if (note) await memory.updateWorkingMemory({ threadId: thread, resourceId: resource, workingMemory: replaceSection(current, STYLE_HEADING, note) });
  await db.update(schema.groups).set({ styleNoteAt: now }).where(eq(schema.groups.id, groupId));
  return !!note;
}