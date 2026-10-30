// The style job's model contract, pure (no DB, no agent): the prompt asks for JSON only and the answer is parsed with
// zod here. No structured output: the gateway refuses it for newer Anthropic models ("requires forced tool use").
import { z } from "zod";
import type { StyleCandidates, StyleLine } from "@/lib/style-stats";

export const candidatesSchema = z.object({
  languages: z.array(z.object({ name: z.string(), share: z.number().min(0).max(1) })).default([]),
  codeSwitching: z.number().min(0).max(1).default(0),
  slang: z.array(z.string()).max(15).default([]),
  tone: z.array(z.string()).max(5).default([]),
  nicknames: z.array(z.object({ nickname: z.string(), member: z.string() })).max(10).default([]),
  insideJokes: z.array(z.string()).max(10).default([]),
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

let warned = false;
/**
 * A CandidateReader from a text model call (`generate(prompt)` -> the reply text). A reply that doesn't parse gives
 * null (the batch is skipped) and is logged once per process.
 */
export function readerFrom(generate: (prompt: string) => Promise<string>): CandidateReader {
  return async (lines) => {
    const out = parseCandidates(await generate(stylePrompt(lines)));
    if (!out && !warned) {
      warned = true;
      console.warn("[style] the model's answer wasn't the JSON asked for; skipping this batch");
    }
    return out;
  };
}
