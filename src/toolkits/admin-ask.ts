// "Did the Admin ask for this?" (audit H6). Tools already check WHO acts (services/authz.ts requireAdmin); this checks
// that the Admin's own current message asks for the action, so an instruction planted in the chat, a receipt or
// working memory can't run an admin tool when the Admin only said "roomie hi". Pure, no DB (admin-ask.test.ts).
//
// The rule, per tool (its manifest's adminOnly entry): the message names the action (spec.action) and the target
// (one word of spec.target's value), or for needs: "either", one of the two. Otherwise the tool doesn't run and Roomie
// asks spec.ask. The Admin's next message within 10 minutes that says yes plus the action or the target passes.
import type { AdminAsk } from "./types";

export const CONFIRM_TTL_MS = 10 * 60 * 1000;
export const YES = /\b(yes|yep|yeah|yup|sure|ok(ay)?|confirm(ed)?|do it|go ahead)\b/i;

export type AdminAskResult = { ok: true } | { ok: false; ask: string };

const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `word` appears in `text` as a whole word, any case. */
const hasWord = (text: string, word: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(word)}($|[^\\p{L}\\p{N}])`, "iu").test(text);

/** Every string (and number) value in a tool input, for target "*". */
function leaves(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) return v.flatMap(leaves);
  if (v && typeof v === "object") return Object.values(v).flatMap(leaves);
  return [];
}

export function targetValues(spec: AdminAsk, input: unknown): string[] {
  if (!spec.target) return [];
  if (spec.target === "*") return leaves(input);
  const v = (input as Record<string, unknown> | null)?.[spec.target];
  return leaves(v);
}

/** Whether the message names any word of any target value ("promote eve" names "Eve Smith"). */
export const namesTarget = (text: string, values: string[]) => values.some((v) => words(v).some((w) => hasWord(text, w)));

export function namesAction(text: string, spec: AdminAsk): boolean {
  try {
    return new RegExp(spec.action, "iu").test(text);
  } catch {
    return false;
  }
}

/**
 * Whether `latest` (the Admin's own words in this message) asks for this tool call. `confirming`: Roomie asked about
 * this tool in the last 10 minutes, so "yes" plus the action or the target is enough.
 */
export function checkAdminAsk(spec: AdminAsk, input: unknown, latest: string, confirming = false): AdminAskResult {
  const values = targetValues(spec, input);
  const action = namesAction(latest, spec);
  const target = spec.target ? namesTarget(latest, values) : true;
  const ok = spec.needs === "either" ? action || (!!spec.target && target) : action && target;
  if (ok) return { ok: true };
  if (confirming && YES.test(latest) && (action || (!!spec.target && target))) return { ok: true };
  const shown = values.filter((v) => v.trim()).slice(0, 3).join(", ");
  return { ok: false, ask: spec.ask.replaceAll("{target}", shown || "that") };
}
