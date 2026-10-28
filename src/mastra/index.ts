// The Mastra instance: the roomie agent, Postgres storage (memory, traces, scores) and observability.
// Used by the pipeline, the API routes and `npm run mastra:dev` (Studio).
import { loadEnv } from "@/lib/env";
import { Mastra } from "@mastra/core/mastra";
import { ConsoleLogger } from "@mastra/core/logger";
import { SpanType } from "@mastra/core/observability";
import { MastraPlatformExporter, MastraStorageExporter, Observability, SensitiveDataFilter } from "@mastra/observability";
import { roomie } from "./agents/roomie";
import { storage } from "./memory";
import { answerRelevancyScorer, brevityToneScorer } from "./scorers";

loadEnv(); // already ran through lib/llm.ts; explicit so bundlers keep it

const platformExport = !!(process.env.MASTRA_PLATFORM_ACCESS_TOKEN && process.env.MASTRA_PROJECT_ID);
const g = globalThis as { __roomiePlatformNotice?: boolean };
if (!platformExport && !g.__roomiePlatformNotice) {
  g.__roomiePlatformNotice = true;
  console.info("[mastra] Mastra platform export is off (set MASTRA_PLATFORM_ACCESS_TOKEN and MASTRA_PROJECT_ID). Traces go to Postgres only.");
}

export const mastra = new Mastra({
  agents: { roomie },
  storage,
  scorers: { relevancy: answerRelevancyScorer, brevityTone: brevityToneScorer },
  logger: new ConsoleLogger({ name: "Roomie", level: "info" }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "roomie",
        exporters: [...(platformExport ? [new MastraPlatformExporter()] : []), new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
        excludeSpanTypes: [SpanType.MODEL_CHUNK], // one row per streamed chunk otherwise
        requestContextKeys: ["householdId", "actorId", "toolkit"],
      },
    },
  }),
});
