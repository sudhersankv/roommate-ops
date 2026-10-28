// Chat retention (ADR 0006): raw chat lines live 30 days. Run daily from the scheduler tick.
// Roomie's own memory (thread summaries, Group style, Member notes) is not raw chat and stays.
import { deleteOlderThan, RETENTION_DAYS } from "@/services/chatlog";

export async function runRetention(now = new Date()): Promise<number> {
  const n = await deleteOlderThan(RETENTION_DAYS, now);
  if (n) console.log(`retention: deleted ${n} chat lines older than ${RETENTION_DAYS} days`);
  return n;
}
