// The Gate: hard triggers + follow-up window (facts from chat_log) + Jev, decided by policy.ts.
// If Jev errors or takes longer than JEV_TIMEOUT_MS the decision falls back to hard triggers only.
import { askJev, jevState } from "./jev";
import { decideGate, type Chattiness, type GateDecision, type JevAnswers } from "./policy";

export * from "./policy";
export { askJev, jevState, JEV_TIMEOUT_MS } from "./jev";

export type GateRun = GateDecision & { jev: JevAnswers | null; jevMs: number; jevError?: string };

export async function runGate(input: {
  latest: string;
  recent: string[];
  members: string[];
  hardTrigger: boolean;
  inWindow: boolean;
  chattiness: Chattiness;
}): Promise<GateRun> {
  const started = Date.now();
  let jev: JevAnswers | null = null;
  let jevError: string | undefined;
  try {
    jev = (await askJev(jevState(input))).answers;
  } catch (e) {
    jevError = e instanceof Error ? e.message : String(e);
    console.warn(`[gate] Jev unavailable, hard triggers only: ${jevError.slice(0, 160)}`);
  }
  const decision = decideGate({ hardTrigger: input.hardTrigger, inWindow: input.inWindow, jev, chattiness: input.chattiness });
  return { ...decision, jev, jevMs: Date.now() - started, ...(jevError ? { jevError } : {}) };
}
