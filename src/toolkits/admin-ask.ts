// "Did the Admin ask for this?" (audit H6). Tools already check WHO acts (services/authz.ts requireAdmin); this checks
// that the Admin's own current message asks for the action, so an instruction planted in the chat, a receipt or
// working memory can't run an admin tool when the Admin only said "roomie hi". Pure, no DB (admin-ask.test.ts).
//
// The rule, per tool (its manifest's adminOnly entry): the message names the action (spec.action) and, when there is
// one, the target (a word of spec.target's value). A tool with `fields` (settings) instead needs every field the call
// would change to be asked for: its own words in the message, or for some fields the value itself ("Chicago"). Otherwise
// the tool doesn't run and Roomie asks spec.ask. Within 10 minutes the Admin's "yes" plus the action or the target
// passes, for exactly the call Roomie asked about (the registry binds the confirmation to the input).
import type { AdminAsk, AdminField } from "./types";

export const CONFIRM_TTL_MS = 10 * 60 * 1000;
export const YES = /\b(yes|yep|yeah|yup|sure|ok(ay)?|confirm(ed)?|do it|go ahead)\b/i;

export type AdminAskResult = { ok: true } | { ok: false; ask: string };

/** Never evidence for a value: it's in every message addressed to Roomie. */
const NOT_EVIDENCE = new Set(["roomie"]);
const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !NOT_EVIDENCE.has(w.toLowerCase()));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `word` appears in `text` as a whole word, any case. */
const hasWord = (text: string, word: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(word)}($|[^\\p{L}\\p{N}])`, "iu").test(text);

/** Every string (and number) value in a tool input. */
function leaves(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) return v.flatMap(leaves);
  if (v && typeof v === "object") return Object.values(v).flatMap(leaves);
  return [];
}

export function targetValues(spec: AdminAsk, input: unknown): string[] {
  if (!spec.target) return [];
  return leaves((input as Record<string, unknown> | null)?.[spec.target]);
}

/** Whether the message names any word of any target value ("promote eve" names "Eve Smith"). */
export const namesTarget = (text: string, values: string[]) => values.some((v) => words(v).some((w) => hasWord(text, w)));

const matches = (text: string, source: string) => {
  try {
    return new RegExp(source, "iu").test(text.replace(/\s+/g, " ")); // one line, so ".*" spans the message
  } catch {
    return false;
  }
};

export const namesAction = (text: string, spec: AdminAsk) => matches(text, spec.action);

/** The fields a call would change (set, and not an empty object). */
function changedFields(input: unknown): [string, unknown][] {
  if (!input || typeof input !== "object") return [];
  return Object.entries(input as Record<string, unknown>).filter(([, v]) => v !== undefined && !(v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length));
}

const fieldAsked = (field: AdminField | undefined, value: unknown, text: string) => !!field && (matches(text, field.words) || (!!field.byValue && namesTarget(text, leaves(value))));

/**
 * Whether `latest` (the Admin's own words in this message) asks for this tool call. `confirming`: Roomie asked about
 * this very call in the last 10 minutes, so "yes" plus the action or the target is enough.
 */
export function checkAdminAsk(spec: AdminAsk, input: unknown, latest: string, confirming = false): AdminAskResult {
  const yes = confirming && YES.test(latest);
  if (spec.fields) {
    const changed = changedFields(input);
    const unasked = changed.filter(([k, v]) => !fieldAsked(spec.fields![k], v, latest));
    const asked = changed.length ? !unasked.length : namesAction(latest, spec);
    if (asked) return { ok: true };
    if (yes && (namesAction(latest, spec) || changed.some(([k, v]) => fieldAsked(spec.fields![k], v, latest)))) return { ok: true };
    const shown = (unasked.length ? unasked : changed).map(([k]) => k).join(", ");
    return { ok: false, ask: spec.ask.replaceAll("{target}", shown || "that") };
  }
  const values = targetValues(spec, input);
  const action = namesAction(latest, spec);
  const target = spec.target ? namesTarget(latest, values) : true;
  if (action && target) return { ok: true };
  if (yes && (action || (!!spec.target && target))) return { ok: true };
  const shown = values.filter((v) => v.trim()).slice(0, 3).join(", ");
  return { ok: false, ask: spec.ask.replaceAll("{target}", shown || "that") };
}
