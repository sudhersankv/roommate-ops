// Group style, grown in the background (memory.ts explains where it lives). Run from the scheduler tick: once a
// household has logged STYLE_EVERY chat lines since households.style_note_at, Haiku rewrites the "## Group style"
// section of working memory from the latest lines, and the agent reads it on its next reply.
import { and, count, eq, gt } from "drizzle-orm";
import { Agent } from "@mastra/core/agent";
import { db, schema } from "@/db";
import { smallModel } from "@/lib/llm";
import { readSection, replaceSection, shouldRefreshStyle, STYLE_EVERY } from "@/lib/style-note";
import { recentChatter } from "@/services/chatlog";
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

export async function linesSinceStyleNote(householdId: string, since: Date | null): Promise<number> {
  const where = since ? and(eq(schema.chatLog.householdId, householdId), gt(schema.chatLog.createdAt, since)) : eq(schema.chatLog.householdId, householdId);
  const [row] = await db.select({ n: count() }).from(schema.chatLog).where(where);
  return Number(row?.n ?? 0);
}

/** Refresh one household's Group style if it's due. Returns true when the note was rewritten. */
export async function refreshStyleNote(householdId: string, styleNoteAt: Date | null, now = new Date(), force = false): Promise<boolean> {
  if (!force && !shouldRefreshStyle(await linesSinceStyleNote(householdId, styleNoteAt))) return false;
  const lines = await recentChatter(householdId, 60 * 24 * 30, STYLE_EVERY);
  const { thread, resource } = threadFor(householdId);
  const current = (await memory.getWorkingMemory({ threadId: thread, resourceId: resource })) || WORKING_MEMORY_TEMPLATE;
  const res = await styleWriter.generate(`Current note:\n${readSection(current, STYLE_HEADING)}\n\nRecent messages:\n${lines.join("\n")}`);
  const note = res.text.trim();
  if (note) await memory.updateWorkingMemory({ threadId: thread, resourceId: resource, workingMemory: replaceSection(current, STYLE_HEADING, note) });
  await db.update(schema.households).set({ styleNoteAt: now }).where(eq(schema.households.id, householdId));
  return !!note;
}
