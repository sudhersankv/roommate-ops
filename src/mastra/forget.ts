// Memory cleanup for "forget me" and "delete group data" (ADR 0006). Kept apart from memory.ts's config so services
// can import it lazily.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { dropMemberLines, readSection, replaceSection } from "@/lib/style-note";
import { memory, threadFor } from "./memory";

const MEMBER_NOTES = "## Member notes";

/** Roomie's input lines look like "[Name] text" or "[voice note from Name] text" (pipeline.ts). */
export const isLineFrom = (text: string, name: string) => {
  const t = text.trimStart().toLowerCase();
  const n = name.toLowerCase();
  return t.startsWith(`[${n}]`) || t.startsWith(`[voice note from ${n}]`);
};

const textOf = (m: { content: unknown }) => {
  const c = m.content as { parts?: { type: string; text?: string }[]; content?: string } | string;
  if (typeof c === "string") return c;
  return c?.parts?.filter((p) => p.type === "text").map((p) => p.text ?? "").join(" ") || c?.content || "";
};

/** Deletes one Member's messages from the Group's memory thread and their Member notes line. Returns how many. */
export async function forgetMemberInMemory(groupId: string, name: string): Promise<number> {
  const { thread, resource } = threadFor(groupId);
  const existing = await memory.getThreadById({ threadId: thread });
  let deleted = 0;
  if (existing) {
    const { messages } = await memory.recall({ threadId: thread, resourceId: resource, perPage: false });
    const ids = messages.filter((m) => m.role === "user" && isLineFrom(textOf(m), name)).map((m) => m.id);
    if (ids.length) await memory.deleteMessages(ids);
    deleted = ids.length;
  }
  const wm = await memory.getWorkingMemory({ threadId: thread, resourceId: resource }).catch(() => null);
  if (wm) {
    const notes = readSection(wm, MEMBER_NOTES);
    const kept = dropMemberLines(notes, name);
    if (kept !== notes) await memory.updateWorkingMemory({ threadId: thread, resourceId: resource, workingMemory: replaceSection(wm, MEMBER_NOTES, kept) });
  }
  return deleted;
}

/** Drops the Group's whole memory: thread, messages, embeddings and working memory. */
export async function forgetGroupInMemory(groupId: string): Promise<void> {
  const { thread, resource } = threadFor(groupId);
  await memory.deleteThread(thread).catch(() => {});
  await db.execute(sql`delete from mastra_resources where id = ${resource}`).catch(() => {});
}
