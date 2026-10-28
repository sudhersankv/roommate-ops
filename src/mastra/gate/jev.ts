// Jev (typesafeai-jev-1-14-0) through the Neon AI Gateway. Not a chat model: a System One decision endpoint that
// returns calibrated probabilities for typed questions. Plain fetch; ~0.3-1.4 s per call.
import { GATE_TOOLKITS, type GateToolkit } from "../context";
import type { Intent, JevAnswers } from "./policy";

export const JEV_TIMEOUT_MS = 2_500;
export const gateModel = () => process.env.GATE_MODEL ?? "typesafeai-jev-1-14-0";

const ROOMIE =
  "Roomie is an assistant member of this group chat that logs shared expenses, keeps a grocery cart, tracks chores, home upkeep and reminders.";

export const QUESTIONS = {
  intent: {
    type: "choice",
    instructions: "What should Roomie do about the latest message?",
    criteria: {
      act: "Roomie should do something with its tools: log an expense, a payment, a chore or a reminder, change the cart, or answer a question about the group's money, cart, chores, upkeep or reminders. Questions Roomie can answer with its tools are act.",
      clarify: "The message is for Roomie or has something worth logging, but a key detail (amount, who, which item, when) is missing or ambiguous, so Roomie should ask one short question first.",
      chat: "Small talk aimed at Roomie (thanks, greetings, a joke) that deserves a brief reply but no action.",
      ignore: "Chatter between the people in the group that doesn't need Roomie.",
    },
  },
  addressed: {
    type: "noul",
    instructions: "Is the latest message directed at Roomie (named, replied to, or clearly asking the assistant)?",
  },
  toolkit: {
    type: "choice",
    instructions: "Which of Roomie's areas does the latest message relate to?",
    criteria: {
      splitting: "Money: shared expenses, who paid, balances, who owes what, paying someone back.",
      groceries: "The shared grocery cart: adding or removing items, shopping, checking out.",
      chores: "Chores: dishes, trash, cleaning, whose turn it is.",
      upkeep: "Home maintenance on a schedule: filters, smoke alarms, gutters, repairs.",
      reminders: "Reminders at a time or date.",
      none: "None of these, or several at once.",
    },
  },
} as const;

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

/** Raw Jev response -> the Gate's answers, or null if anything is missing or malformed. */
export function parseJev(res: JevResponse): JevAnswers | null {
  const intent = res.answers?.intent;
  const addressed = res.answers?.addressed;
  const toolkit = res.answers?.toolkit;
  if (intent?.type !== "choice" || !intent.probabilities) return null;
  if (addressed?.type !== "noul" || typeof addressed.noul !== "number") return null;
  if (toolkit?.type !== "choice" || !(GATE_TOOLKITS as readonly string[]).includes(toolkit.choice)) return null;
  const p = intent.probabilities;
  return {
    intent: Object.fromEntries(INTENTS.map((k) => [k, Number(p[k] ?? 0)])) as Record<Intent, number>,
    addressed: addressed.noul,
    toolkit: { choice: toolkit.choice as GateToolkit, p: Number(toolkit.probabilities?.[toolkit.choice] ?? toolkit.confidence ?? 0) },
  };
}

/** Ask Jev the Gate's questions. Throws on HTTP errors, timeouts and malformed answers (the caller falls back). */
export async function askJev(state: string, timeoutMs = JEV_TIMEOUT_MS): Promise<{ answers: JevAnswers; raw: JevResponse }> {
  const base = (process.env.NEON_AI_GATEWAY_BASE_URL ?? "").replace(/\/+$/, "");
  const token = process.env.NEON_AI_GATEWAY_TOKEN;
  if (!base || !token) throw new Error("NEON_AI_GATEWAY_BASE_URL / NEON_AI_GATEWAY_TOKEN not set");
  const res = await fetch(`${base}/typesafe/v1/systemone`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: gateModel(), state, questions: QUESTIONS }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const raw = (await res.json()) as JevResponse;
  const answers = parseJev(raw);
  if (!answers) throw new Error(`Jev returned unexpected answers: ${JSON.stringify(raw).slice(0, 300)}`);
  return { answers, raw };
}
