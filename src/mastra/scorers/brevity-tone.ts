// Roomie's house style as a score: short (1-3 lines unless they asked for more), no bullet lists or headers, and
// the facts the tools returned actually in the reply. Shape is checked in code; tone and facts by a Haiku judge.
import { createScorer } from "@mastra/core/evals";
import { extractToolResults, getAssistantMessageFromRunOutput, getUserMessageFromRunInput } from "@mastra/evals/scorers/utils";
import { z } from "zod";
import { smallModel } from "@/lib/llm";

const MAX_LINES = 3;
const BULLET = /^\s*([-*•]|\d+[.)])\s+/m;
const HEADER = /^\s*#{1,6}\s+\S/m;

/** The deterministic half, exported for the evals runner and tests. */
export function shapeOf(text: string) {
  const lines = text.split("\n").filter((l) => l.trim()).length;
  return { lines, tooLong: lines > MAX_LINES, bullets: BULLET.test(text), headers: HEADER.test(text) };
}

export const brevityToneScorer = createScorer({
  id: "brevity-tone",
  name: "Brevity and tone",
  description: "1-3 lines unless asked for more, no bullet lists or headers, groupmate tone, and the tools' facts are in the reply.",
  type: "agent",
  judge: {
    model: smallModel,
    instructions: "You review replies from Roomie, an AI groupmate in a group chat. You are strict and brief.",
  },
})
  .preprocess(({ run }) => {
    const reply = getAssistantMessageFromRunOutput(run.output) ?? "";
    const results = extractToolResults(run.output).map((r) => ({ tool: r.toolName, result: r.result }));
    return { reply, user: getUserMessageFromRunInput(run.input) ?? "", toolResults: JSON.stringify(results).slice(0, 4000), ...shapeOf(reply) };
  })
  .analyze({
    description: "Judge tone, whether more length was requested, and whether the tool facts made it into the reply",
    outputSchema: z.object({
      askedForMore: z.boolean(),
      groupmateTone: z.boolean(),
      factsPresent: z.boolean(),
      note: z.string(),
    }),
    createPrompt: ({ results }) => {
      const p = results.preprocessStepResult;
      return `Message to Roomie:
${p.user}

Tool results Roomie got (JSON, amounts in cents):
${p.toolResults}

Roomie's reply:
${p.reply}

Answer as JSON:
- askedForMore: did the message ask for a long answer (a recipe, a full breakdown, a list, a plan)?
- groupmateTone: does the reply sound like a friendly, brief friend in a group chat (no help-desk phrases like "Certainly!" or "I'd be happy to")?
- factsPresent: does the reply state the key facts from the tool results exactly (amounts, names, dates)? true if no tool was used.
- note: one short sentence.`;
    },
  })
  .generateScore(({ results }) => {
    const p = results.preprocessStepResult;
    const a = results.analyzeStepResult;
    let score = 1;
    if (p.tooLong && !a.askedForMore) score -= 0.3;
    if (p.bullets || p.headers) score -= 0.2;
    if (!a.groupmateTone) score -= 0.2;
    if (!a.factsPresent) score -= 0.3;
    return Math.max(0, Math.round(score * 100) / 100);
  })
  .generateReason(({ results, score }) => {
    const p = results.preprocessStepResult;
    const a = results.analyzeStepResult;
    return `score ${score}: ${p.lines} lines${p.bullets ? ", bullets" : ""}${p.headers ? ", headers" : ""}; tone ${a.groupmateTone ? "ok" : "off"}; facts ${a.factsPresent ? "present" : "missing"}. ${a.note}`;
  });
