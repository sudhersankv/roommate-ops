// The Gate: hard triggers + follow-up window (facts from chat_log) + Jev, decided by policy.ts.
// If Jev errors or takes longer than JEV_TIMEOUT_MS the decision falls back to hard triggers only.
import type { ToolkitId } from "@/toolkits/manifests";
import { askJev, JEV_TIMEOUT_MS, jevState } from "./jev";
import { decideGate, type Chattiness, type GateDecision, type JevAnswers } from "./policy";

export * from "./policy";
export { askJev, jevState, JEV_TIMEOUT_MS, questionsFor, toolkitCriteria } from "./jev";

export type GateRun = GateDecision & { jev: JevAnswers | null; jevMs: number; jevError?: string };

export async function runGate(input: {
  latest: string;
  recent: string[];
  members: string[];
  hardTrigger: boolean;
  inWindow: boolean;
  chattiness: Chattiness;
  /** The Group's enabled Toolkits: Jev's toolkit choice is only among these (+ core, none). */
  toolkits?: readonly ToolkitId[];
  /** The Group used up its Jev calls for the day (lib/caps.ts): no call, hard triggers only. */
  skipJev?: boolean;
  /** The message carries a photo: the agent keeps every enabled Toolkit's tools (policy.ts). */
  hasPhoto?: boolean;
}): Promise<GateRun> {
  const started = Date.now();
  let jev: JevAnswers | null = null;
  let jevError: string | undefined;
  if (input.skipJev) jevError = "jev daily cap reached";
  else
    try {
      jev = (await askJev(jevState(input), JEV_TIMEOUT_MS, input.toolkits)).answers;
    } catch (e) {
      jevError = e instanceof Error ? e.message : String(e);
      console.warn(`[gate] Jev unavailable, hard triggers only: ${jevError.slice(0, 160)}`);
    }
  const decision = decideGate({ hardTrigger: input.hardTrigger, inWindow: input.inWindow, jev, chattiness: input.chattiness, hasPhoto: input.hasPhoto });
  return { ...decision, jev, jevMs: Date.now() - started, ...(jevError ? { jevError } : {}) };
}
