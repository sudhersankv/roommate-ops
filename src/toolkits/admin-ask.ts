// "Did the Admin ask for this?" (audit H6). Tools already check WHO acts (services/authz.ts requireAdmin); this checks
// that the Admin's own current message asks for the action, so an instruction planted in the chat, a receipt or
// working memory can't run an admin tool when the Admin only said "roomie hi". Pure, no DB (admin-ask.test.ts).
//
// The rule, per tool (its manifest's adminOnly entry): the message names the action (spec.action) and, when there is
// one, the target (a word of spec.target's value). A tool with `fields` (settings) instead needs every field the call
// would change to be asked for: its own words in the message, or for some fields the value itself ("Chicago"). Otherwise
// the tool doesn't run and Roomie asks spec.ask, a plain question (or a Yes/No poll, registry.ts). Within 10 minutes the
// Admin's plain "yes" (or "yes" plus the action) passes, for exactly the call Roomie asked about (the registry binds the
// confirmation to the input). A value counts by meaning too: "ist" asks for Asia/Kolkata, "rupees" for INR. The action and the target have to
// be in the same clause, and a negation earlier in the clause ("don't under any circumstances approve Priya") or on the
// target ("approve Priya, not Sam") means it wasn't asked for.
import { resolveTimeZone } from "@/lib/time";
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

/** A negation anywhere in a clause: "don't under any circumstances approve Priya". */
const NEG = /\b(?:don'?t|do not|dont|never|not|no|nope|won'?t|shouldn'?t|can'?t|cannot)\b/iu;

/** The message's clauses: split at punctuation and at "and" / "but" / "then", so one ask can't lend its verb to another. */
const clausesOf = (text: string) =>
  text
    .split(/[.,;:!?\n]+|\s(?:and|but|then)\s/iu)
    .map((c) => c.trim())
    .filter(Boolean);

/**
 * The first match of `source` in `clause` that isn't negated: no negation earlier in the clause. Phrases that are
 * negations themselves ("don't approve", decline_member's words) start at the negation, so they still count; a
 * whole-clause pattern (lookaheads, zero-length) counts only in a clause with no negation at all.
 */
function affirmedMatch(clause: string, source: string): RegExpExecArray | null {
  let re: RegExp;
  try {
    re = new RegExp(source, "giu");
  } catch {
    return null;
  }
  for (let m = re.exec(clause); m; m = re.exec(clause)) {
    if (m[0] === "") return NEG.test(clause) ? null : m;
    // Nothing negated before it, nor inside it past its first word ("let Priya not in").
    if (!NEG.test(clause.slice(0, m.index)) && !NEG.test(m[0].replace(/^\S+\s*/u, ""))) return m;
  }
  return null;
}

/** Whether some clause of the message asks for it (an un-negated match of `source`). */
const matches = (text: string, source: string) => clausesOf(text).some((c) => affirmedMatch(c, source) !== null);

export const namesAction = (text: string, spec: AdminAsk) => matches(text, spec.action);

/**
 * The action and the target in the same clause, neither negated: "approve Priya" names approving Priya; "approve
 * Priya, not Sam" and "approve Priya and decline Sam" don't name approving Sam.
 */
function asksFor(text: string, spec: AdminAsk, values: string[]): boolean {
  return clausesOf(text).some((c) => {
    const m = affirmedMatch(c, spec.action);
    if (!m) return false;
    if (!spec.target) return true;
    const rest = `${c.slice(0, m.index)} ${c.slice(m.index + m[0].length)}`;
    return !NEG.test(rest) && namesTarget(c, values);
  });
}

/** The fields a call would change (set, and not an empty object). */
function changedFields(input: unknown): [string, unknown][] {
  if (!input || typeof input !== "object") return [];
  return Object.entries(input as Record<string, unknown>).filter(([, v]) => v !== undefined && !(v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length));
}

/** Everyday names for currencies: "rupees" asks for INR as much as "INR" does. */
const CURRENCY_NAMES: Record<string, string[]> = {
  INR: ["rupee", "rupees", "rs", "₹"],
  USD: ["dollar", "dollars", "bucks", "$"],
  EUR: ["euro", "euros", "€"],
  GBP: ["pound", "pounds", "quid", "£"],
  IDR: ["rupiah", "rp"],
  JPY: ["yen", "¥"],
  AUD: ["aussie dollars"],
  CAD: ["canadian dollars"],
};

/**
 * Whether a clause names the value by what it means rather than how it's spelled: a time zone by any name
 * resolveTimeZone knows ("ist", "india time", "kolkata" for Asia/Kolkata), a currency by its everyday name.
 */
function namesByMeaning(field: AdminField, value: unknown, clause: string): boolean {
  if (typeof value !== "string") return false;
  if (field.byMeaning === "timezone") {
    const w = clause.toLowerCase().split(/[^\p{L}\p{N}/_]+/u).filter(Boolean);
    const spans = w.flatMap((_, i) => [w[i], `${w[i]} ${w[i + 1] ?? ""}`.trim(), `${w[i]} ${w[i + 1] ?? ""} ${w[i + 2] ?? ""}`.trim()]);
    return spans.some((x) => x.length >= 2 && resolveTimeZone(x) === value);
  }
  if (field.byMeaning === "currency") return (CURRENCY_NAMES[value.toUpperCase()] ?? []).some((n) => (/\w/.test(n) ? hasWord(clause, n) : clause.includes(n)));
  return false;
}

const fieldAsked = (field: AdminField | undefined, value: unknown, text: string) =>
  !!field &&
  (matches(text, field.words) ||
    clausesOf(text).some((c) => !NEG.test(c) && ((!!field.byValue && namesTarget(c, leaves(value))) || namesByMeaning(field, value, c))));

/** How a settings field reads in Roomie's question. */
const FIELD_LABEL: Record<string, string> = {
  timezone: "time zone",
  reportDay: "report day",
  reportHour: "report hour",
  choresNudgeHour: "morning post hour",
  simplifyDebts: "debt simplifying",
  toolkits: "Tricks",
};
const valueText = (v: unknown): string => (Array.isArray(v) ? v.map(valueText).join(", ") : typeof v === "boolean" ? (v ? "on" : "off") : v === null ? "off" : String(v));

/** "currency to INR and time zone to Asia/Kolkata": the whole change, so a yes knows what it agrees to. */
function describeChanges(changed: [string, unknown][]): string {
  const parts = changed.map(([k, v]) => `${FIELD_LABEL[k] ?? k} to ${valueText(v)}`);
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** Words a plain confirmation is made of: "roomie, yes", "yep do it", "ok go ahead", "yes please". */
const PLAIN_YES = new Set(["yes", "yep", "yeah", "yup", "ya", "yea", "sure", "ok", "okay", "k", "confirm", "confirmed", "do", "it", "go", "ahead", "please", "pls", "thanks", "thx", "thank", "you", "sounds", "good", "great", "perfect", "cool", "fine", "alright", "absolutely", "of", "course", "that", "thing", "roomie", "haan", "ha"]);

/** A reply that is only a yes (and maybe the target's own name): "roomie, yes", "yes please", "yep, Eve". */
function plainYes(latest: string, targets: string[]): boolean {
  if (!YES.test(latest) && !/\b(?:haan|ya|yea)\b/i.test(latest)) return false;
  const targetWords = new Set(targets.flatMap((t) => words(t).map((w) => w.toLowerCase())));
  const rest = latest.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !PLAIN_YES.has(w) && !targetWords.has(w));
  return rest.length === 0;
}

/** A clause with a negation names the field ("not the currency", "don't touch the report"): it's excluded. */
const fieldExcluded = (field: AdminField | undefined, value: unknown, text: string) =>
  !!field &&
  clausesOf(text).some((c) => {
    if (!NEG.test(c)) return false;
    try {
      if (new RegExp(field.words, "iu").test(c)) return true;
    } catch {
      /* a bad pattern names nothing */
    }
    return namesTarget(c, leaves(value));
  });

/**
 * Whether `latest` (the Admin's own words in this message) asks for this tool call. `confirming`: Roomie asked about
 * this very call in the last 10 minutes, so "yes" plus the action or the target is enough.
 */
export function checkAdminAsk(spec: AdminAsk, input: unknown, latest: string, confirming = false): AdminAskResult {
  // Roomie just asked about exactly this call: a plain yes is the answer (live test #10). Anything more than a yes
  // ("yes decline Priya", "yes but not the currency") goes through the full rules below.
  if (confirming && plainYes(latest, spec.fields ? [] : targetValues(spec, input))) return { ok: true };
  const yes = confirming && YES.test(latest);
  if (spec.fields) {
    const changed = changedFields(input);
    const excluded = changed.filter(([k, v]) => fieldExcluded(spec.fields![k], v, latest));
    if (excluded.length) return { ok: false, ask: spec.ask.replaceAll("{target}", excluded.map(([k]) => k).join(", ")) };
    const unasked = changed.filter(([k, v]) => !fieldAsked(spec.fields![k], v, latest));
    const asked = changed.length ? !unasked.length : namesAction(latest, spec);
    if (asked) return { ok: true };
    // Confirming a settings call: "yes, change the settings" (the question named every field), or yes plus words for
    // every field the call changes. "yes currency" doesn't also confirm the report hour.
    if (yes && (namesAction(latest, spec) || (changed.length > 0 && changed.every(([k]) => !!spec.fields![k] && matches(latest, spec.fields![k].words))))) return { ok: true };
    // A plain yes confirms the whole call, so the question shows all of it, with the values.
    return { ok: false, ask: spec.ask.replaceAll("{target}", describeChanges(changed) || "settings") };
  }
  const values = targetValues(spec, input);
  if (asksFor(latest, spec, values)) return { ok: true };
  // Confirming needs "yes" and this tool's own (un-negated) action: "yes decline Priya" never confirms approving her.
  if (yes && namesAction(latest, spec)) return { ok: true };
  const shown = values.filter((v) => v.trim()).slice(0, 3).join(", ");
  return { ok: false, ask: spec.ask.replaceAll("{target}", shown || "that") };
}
