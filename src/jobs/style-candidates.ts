// The style job's model contract, pure (no DB, no agent): the prompt asks for JSON only and the answer is parsed with
// zod here. No structured output: the gateway refuses it for newer Anthropic models ("requires forced tool use").
import { z } from "zod";
import type { StyleCandidates, StyleLine } from "@/lib/style-stats";

// Lenient on purpose: a skipped batch is lost (styleNoteAt has moved on), so overlong lists are cut, a share written
// as a percent (45) is read as 0.45, and anything out of range is clamped. Only a reply that isn't JSON is skipped.
const share = z.coerce.number().transform((n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n > 1 ? n / 100 : n)) : 0));
const list = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((xs) => xs.flatMap((x) => { const r = item.safeParse(x); return r.success ? [r.data as z.infer<T>] : []; }).slice(0, max));

export const candidatesSchema = z.object({
  languages: list(z.object({ name: z.string(), share }), 10).default([]),
  codeSwitching: share.catch(0).default(0),
  slang: list(z.string(), 15).default([]),
  tone: list(z.string(), 5).default([]),
  nicknames: list(z.object({ nickname: z.string(), member: z.string() }), 10).default([]),
  insideJokes: list(z.string(), 10).default([]),
});

export const STYLE_INSTRUCTIONS = `You study how one group chat talks so their pet Roomie can slowly sound like them.
Given recent messages ("[Name] text"), propose:
- languages with the share of messages in each (0-1, most used first), and the share of messages mixing languages (e.g. Hinglish, Spanglish)
- slang words and short phrases they repeat, copied exactly (not names, not normal words), at most 15
- a few tone words (at most 5), e.g. dry, teasing, warm
- nicknames: a word people use to address or mention a member that isn't their name, with that member's real name
- running jokes or catchphrases, copied exactly
Only include what is in the messages. Never include private facts, money amounts or addresses.
Reply with JSON only, no prose, no code fence:
{"languages": [{"name": string, "share": number}], "codeSwitching": number, "slang": [string], "tone": [string], "nicknames": [{"nickname": string, "member": string}], "insideJokes": [string]}`;

export const stylePrompt = (lines: StyleLine[]) => lines.map((l) => `[${l.name}] ${l.text}`).join("\n");

/** The model's text -> candidates, or null when it isn't the JSON we asked for. */
export function parseCandidates(text: string): StyleCandidates | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = candidatesSchema.safeParse(data);
  return parsed.success ? (parsed.data as StyleCandidates) : null;
}

export type CandidateReader = (lines: StyleLine[]) => Promise<StyleCandidates | null>;

let skipped = 0;
/**
 * A CandidateReader from a text model call (`generate(prompt)` -> the reply text). A reply that isn't JSON gives
 * null (the batch is skipped): logged the first time and every 10th after, with the count and the reply's start.
 */
export function readerFrom(generate: (prompt: string) => Promise<string>, log: (msg: string) => void = console.warn): CandidateReader {
  return async (lines) => {
    const text = await generate(stylePrompt(lines));
    const out = parseCandidates(text);
    if (!out && skipped++ % 10 === 0) log(`[style] the model's answer wasn't JSON; skipped ${skipped} batch${skipped === 1 ? "" : "es"} so far. It began: ${JSON.stringify(text.slice(0, 120))}`);
    return out;
  };
}
