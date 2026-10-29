// Jev (typesafeai-jev-1-14-0) through the Neon AI Gateway. Not a chat model: a System One decision endpoint that
// returns calibrated probabilities for typed questions. Plain fetch; ~0.3-1.4 s per call.
import { CORE_MANIFEST, MANIFESTS, TOOLKIT_IDS, type ToolkitId } from "@/toolkits/manifests";
import type { ToolkitManifest } from "@/toolkits/types";
import type { GateToolkit } from "../context";
import type { Intent, JevAnswers } from "./policy";

export const JEV_TIMEOUT_MS = 2_500;
export const gateModel = () => process.env.GATE_MODEL ?? "typesafeai-jev-1-14-0";

const ROOMIE =
  "Roomie is an assistant member of this group chat that logs shared expenses, keeps a grocery cart, writes recipes, tracks chores, home upkeep and reminders.";

export const NONE_CRITERION = "None of these, or several at once, such as 'what's due this week' (chores and upkeep), 'how are we doing' or a weekly report.";

/**
 * The `toolkit` question's choices, from the manifests: each enabled Toolkit's gate criterion, core (always), and
 * "none". A disabled Toolkit isn't offered, so Jev can only route among what the Group has on.
 */
export function toolkitCriteria(enabled: readonly string[] = TOOLKIT_IDS): Record<string, string> {
  const on: ToolkitManifest[] = MANIFESTS.filter((m) => enabled.includes(m.id));
  return Object.fromEntries([...on.map((m) => [m.id, m.gate.criterion]), ["core", CORE_MANIFEST.gate.criterion], ["none", NONE_CRITERION]]);
}

/** The Gate's typed questions for a Group with these Toolkits on. */
export function questionsFor(enabled: readonly string[] = TOOLKIT_IDS) {
  return {
    ...BASE_QUESTIONS,
    toolkit: { type: "choice", instructions: "Which of Roomie's areas does the latest message relate to?", criteria: toolkitCriteria(enabled) },
  } as const;
}

const BASE_QUESTIONS = {
  intent: {
    type: "choice",
    instructions: "What should Roomie do about the latest message?",
    criteria: {
      act: "Roomie should do something with its tools: log an expense, a payment, a chore or a reminder, change the cart, write a recipe, or answer a question about the group's money, cart, pantry, chores, upkeep or reminders. Questions Roomie can answer with its tools are act.",
      clarify: "The message is for Roomie or has something worth logging, but a key detail (amount, who, which item, when) is missing or ambiguous, so Roomie should ask one short question first.",
      chat: "Small talk aimed at Roomie (thanks, greetings, a joke) that deserves a brief reply but no action.",
      ignore: "Chatter between the people in the group that doesn't need Roomie.",
    },
  },
  addressed: {
    type: "noul",
    instructions: "Is the latest message directed at Roomie (named, replied to, or clearly asking the assistant)?",
  },
} as const;

/** Every Toolkit on (Studio, scripts). */
export const QUESTIONS = questionsFor();

/** The state Jev judges: who Roomie is, the members, recent chat and the latest message. */
export function jevState(input: { latest: string; recent?: string[]; members?: string[]; inWindow?: boolean }): string {
  return [
    ROOMIE,
    input.members?.length ? `Members: ${input.members.join(", ")}.` : "",
    input.recent?.length ? `Recent chat:\n${input.recent.join("\n")}` : "",
    input.inWindow ? "Roomie spoke in the chat a moment ago." : "",
    `Latest message:\n${input.latest}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

type ChoiceAnswer = { type: "choice"; choice: string; confidence?: number; probabilities?: Record<string, number> };
type NoulAnswer = { type: "noul"; noul: number };
export type JevResponse = { answers?: Record<string, ChoiceAnswer | NoulAnswer | undefined> };

const INTENTS: Intent[] = ["act", "clarify", "chat", "ignore"];

/**
 * Raw Jev response -> the Gate's answers, or null if anything is missing or malformed. A toolkit choice that isn't
 * among the Group's enabled ones (Jev can't, but a stale answer could) becomes "none" with p 0: no narrowing.
 */
export function parseJev(res: JevResponse, enabled: readonly string[] = TOOLKIT_IDS): JevAnswers | null {
  const intent = res.answers?.intent;
  const addressed = res.answers?.addressed;
  const toolkit = res.answers?.toolkit;
  if (intent?.type !== "choice" || !intent.probabilities) return null;
  if (addressed?.type !== "noul" || typeof addressed.noul !== "number") return null;
  if (toolkit?.type !== "choice" || typeof toolkit.choice !== "string") return null;
  const allowed = Object.keys(toolkitCriteria(enabled));
  const known = allowed.includes(toolkit.choice);
  const p = intent.probabilities;
  return {
    intent: Object.fromEntries(INTENTS.map((k) => [k, Number(p[k] ?? 0)])) as Record<Intent, number>,
    addressed: addressed.noul,
    toolkit: known
      ? { choice: toolkit.choice as GateToolkit, p: Number(toolkit.probabilities?.[toolkit.choice] ?? toolkit.confidence ?? 0) }
      : { choice: "none", p: 0 },
  };
}

/** Ask Jev the Gate's questions. Throws on HTTP errors, timeouts and malformed answers (the caller falls back). */
export async function askJev(state: string, timeoutMs = JEV_TIMEOUT_MS, enabled: readonly ToolkitId[] = TOOLKIT_IDS): Promise<{ answers: JevAnswers; raw: JevResponse }> {
  const base = (process.env.NEON_AI_GATEWAY_BASE_URL ?? "").replace(/\/+$/, "");
  const token = process.env.NEON_AI_GATEWAY_TOKEN;
  if (!base || !token) throw new Error("NEON_AI_GATEWAY_BASE_URL / NEON_AI_GATEWAY_TOKEN not set");
  const res = await fetch(`${base}/typesafe/v1/systemone`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: gateModel(), state, questions: questionsFor(enabled) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const raw = (await res.json()) as JevResponse;
  const answers = parseJev(raw, enabled);
  if (!answers) throw new Error(`Jev returned unexpected answers: ${JSON.stringify(raw).slice(0, 300)}`);
  return { answers, raw };
}
