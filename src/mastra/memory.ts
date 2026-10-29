// Roomie's memory: one thread per Group ("group-<id>", resource = groupId), in the app's Postgres.
//   - message history: the last 30 messages of the thread
//   - semantic recall: pgvector over every message, embedded on the gateway (qwen3-embedding-0-6b, 1024 dims)
//   - working memory, scoped to the resource (the Group): the Group style note and Member notes
// Group style grows in the background, not in the reply path: jobs/style-note.ts asks Haiku to rewrite the Style
// section from the latest ~50 chat lines whenever that many new lines have been logged since its last update. The
// agent itself only edits Member notes (it's told so in its instructions).
import "@/lib/env";
import { Memory } from "@mastra/memory";
import { PgVector, PostgresStore } from "@mastra/pg";
import { EMBED_DIM, gatewayEmbedder } from "@/lib/llm";
import { readSection } from "@/lib/style-note";

export const storage = new PostgresStore({ id: "roomie-storage", connectionString: process.env.DATABASE_URL! });
export const vector = new PgVector({ id: "roomie-vector", connectionString: process.env.DATABASE_URL! });

export const STYLE_HEADING = "## Group style";

export const WORKING_MEMORY_TEMPLATE = `# Group
${STYLE_HEADING}
- Languages:
- Slang and in-jokes:
- Tone:
- Confidence (0-1): 0

## Member notes
- [Name]: diet: ; pays with: ; time zone: ; other:
`;

export const memory = new Memory({
  storage,
  vector,
  embedder: gatewayEmbedder(),
  embeddingDimension: EMBED_DIM,
  options: {
    lastMessages: 30,
    semanticRecall: { topK: 3, messageRange: 1, scope: "resource" },
    workingMemory: { enabled: true, scope: "resource", template: WORKING_MEMORY_TEMPLATE },
    generateTitle: false,
  },
});

export const threadFor = (groupId: string) => ({ thread: `group-${groupId}`, resource: groupId });

/** The Group style section of a Group's working memory ("" when there's none yet). */
export async function groupStyle(groupId: string): Promise<string> {
  const { thread, resource } = threadFor(groupId);
  const wm = await memory.getWorkingMemory({ threadId: thread, resourceId: resource }).catch(() => null);
  return wm ? readSection(wm, STYLE_HEADING) : "";
}
