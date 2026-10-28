// Scorers. About 10% of live replies are scored (plan.md "Observability"), judged by Haiku; scores land in
// mastra_scorers and show in Studio. Tool-call accuracy needs an expected tool per case, so it runs in `npm run evals`.
import { createAnswerRelevancyScorer } from "@mastra/evals/scorers/prebuilt";
import { smallModel } from "@/lib/llm";
import { brevityToneScorer } from "./brevity-tone";

export const LIVE_SAMPLE_RATE = 0.1;

export const answerRelevancyScorer = createAnswerRelevancyScorer({ model: smallModel });

export const liveScorers = {
  relevancy: { scorer: answerRelevancyScorer, sampling: { type: "ratio" as const, rate: LIVE_SAMPLE_RATE } },
  brevityTone: { scorer: brevityToneScorer, sampling: { type: "ratio" as const, rate: LIVE_SAMPLE_RATE } },
};

export { brevityToneScorer };
