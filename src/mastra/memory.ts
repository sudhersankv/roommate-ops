// Roomie's memory: one thread per Group ("group-<id>", resource = groupId), in the app's Postgres.
//   - message history: the last 30 messages of the thread
//   - semantic recall: pgvector over every message, embedded on the gateway (qwen3-embedding-0-6b, 1024 dims)
//   - working memory, scoped to the resource (the Group): a mirror of the Group style and the Member notes
// The Learned style grows in the background, not in the reply path: jobs/style-note.ts folds every ~50 new chat lines
// into groups.personality.learned (counts in code, candidates from Haiku) and mirrors a short note into the Style
// section. The agent itself only edits Member notes (it's told so in its instructions).
import "@/lib/env";
import { Memory } from "@mastra/memory";
import { PgVector, PostgresStore } from "@mastra/pg";
import { EMBED_DIM, gatewayEmbedder } from "@/lib/llm";

export const storage = new PostgresStore({ id: "roomie-storage", connectionString: process.env.DATABASE_URL! });
export const vector = new PgVector({ id: "roomie-vector", connectionString: process.env.DATABASE_URL! });

export const STYLE_HEADING = "## Group style";

/** The Group style section before anything is learned (and after "Reset what you've learned"). */
export const EMPTY_STYLE = `- Languages:
- Tone:
- Confidence (0-1): 0
- Slang, nicknames and the rest: in your instructions (LEARNED STYLE), with the rules for using them.`;

// The Learned style itself lives in groups.personality.learned (jobs/style-note.ts); this section only mirrors it.
export const WORKING_MEMORY_TEMPLATE = `# Group
${STYLE_HEADING}
${EMPTY_STYLE}

## Member notes
- [Name]: preferred name: ; diet/allergies: ; pays with: ; time zone: ; cares about: ; birthday: ; other:
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
