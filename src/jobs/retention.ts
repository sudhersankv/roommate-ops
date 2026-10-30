// Retention (ADR 0006, audit B4), run daily from the scheduler tick: raw chat lines, traces and live scores, and Roomie's
// memory-thread messages all live 30 days. Working memory (Group style, Member notes) isn't raw chat and stays.
import { deleteOlderThan, RETENTION_DAYS } from "@/services/chatlog";

export type RetentionCounts = { chatLines: number; spans: number; scores: number; memoryMessages: number };

export async function runRetention(now = new Date()): Promise<RetentionCounts> {
  const chatLines = await deleteOlderThan(RETENTION_DAYS, now);
  const { deleteOldMemory, deleteOldTraces, MEMORY_RETENTION_DAYS, TRACE_RETENTION_DAYS } = await import("@/mastra/forget");
  const { spans, scores } = await deleteOldTraces(now, TRACE_RETENTION_DAYS);
  const memoryMessages = await deleteOldMemory(now, MEMORY_RETENTION_DAYS);
  const counts = { chatLines, spans, scores, memoryMessages };
  if (chatLines || spans || scores || memoryMessages) {
    console.log(`retention: deleted ${chatLines} chat lines, ${spans} trace spans, ${scores} scores, ${memoryMessages} memory messages (older than ${RETENTION_DAYS} days)`);
  }
  return counts;
}
