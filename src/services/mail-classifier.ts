// The Lease Inbox classifier's model contract (ADR 0016 decision 4): the small model reads one email and answers in
// strict JSON (in the text: the gateway refuses structured output for newer Anthropic models, as style-candidates.ts
// notes); zod validates it here, one retry with the error as feedback, then `other`. The model only reads; code
// decides what the class does (lease-inbox.ts classifyInbound). Amounts come back as written ("$2,550.00") and are
// turned into cents here, never by the model (ADR 0007). MAIL_CLASSIFIER_FAKE=1 (evals) reads keywords instead.
import { z } from "zod";
import { parseMoney } from "@/lib/money";
import { formatInZone } from "@/lib/time";
import type { Classification, ClassifyInput, MailClassifier } from "./lease-inbox";

const CLASSES = ["notice", "rent-lease", "work-order", "other"] as const;
const REPLIES = ["acknowledged", "scheduled", "done", "other"] as const;

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const blankToUndefined = (v: unknown) => (v === null || v === "" ? undefined : v);

/** What the model must answer. Loose where it can be (a bad date or amount is dropped), strict on class and summary. */
export const ModelAnswerSchema = z.object({
  class: z.enum(CLASSES),
  date: z.preprocess(blankToUndefined, z.string().regex(LOCAL_DATE).optional().catch(undefined)),
  amount: z.preprocess(blankToUndefined, z.union([z.string(), z.number()]).optional()),
  utility: z.preprocess(blankToUndefined, z.string().max(60).optional()),
  reply: z.preprocess(blankToUndefined, z.enum(REPLIES).optional().catch(undefined)),
  // A notice's window (#63): local wall-clock, both with a time; a bad one is dropped.
  start: z.preprocess(blankToUndefined, z.string().regex(LOCAL_TIME).optional().catch(undefined)),
  end: z.preprocess(blankToUndefined, z.string().regex(LOCAL_TIME).optional().catch(undefined)),
  what: z.preprocess(blankToUndefined, z.string().trim().min(1).max(40).optional().catch(undefined)),
  off: z.preprocess(blankToUndefined, z.boolean().optional().catch(undefined)),
  summary: z.string().trim().min(1).max(200),
});

export class ClassifierFormatError extends Error {
  name = "ClassifierFormatError";
}

const toCents = (amount: string | number | undefined): number | undefined => {
  if (amount === undefined) return undefined;
  const cents = typeof amount === "number" ? Math.round(amount * 100) : parseMoney(amount.replace(/^(?:usd|us\$)\s*/i, ""));
  return cents !== null && Number.isInteger(cents) && cents > 0 ? cents : undefined;
};

/** The model's text -> a Classification, or a ClassifierFormatError saying what was wrong (fed back on the retry). */
export function parseClassification(text: string): Classification {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new ClassifierFormatError("The answer wasn't a JSON object.");
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new ClassifierFormatError(`The JSON didn't parse: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = ModelAnswerSchema.safeParse(data);
  if (!parsed.success) throw new ClassifierFormatError(parsed.error.issues.map((i) => `${i.path.join(".") || "answer"}: ${i.message}`).join("; "));
  const a = parsed.data;
  const amountCents = toCents(a.amount);
  // An end before its start is no end; a start without a date fills the date in.
  const until = a.start && a.end && a.end > a.start ? a.end : undefined;
  const date = a.date ?? a.start;
  return {
    class: a.class,
    summary: a.summary.replace(/\s+/g, " "),
    ...(date ? { date } : {}),
    ...(a.start ? { start: a.start } : {}),
    ...(until ? { end: until } : {}),
    ...(a.what ? { what: a.what.toLowerCase().replace(/\s+/g, " ") } : {}),
    ...(a.off !== undefined ? { off: a.off } : {}),
    ...(amountCents !== undefined ? { amountCents } : {}),
    ...(a.utility?.trim() ? { utility: a.utility.trim() } : {}),
    ...(a.reply ? { reply: a.reply } : {}),
  };
}

/** Never "nothing": a broken answer files the email quietly as other, marked uncertain so nothing about it reaches the chat. */
export const FALLBACK = (input: Pick<ClassifyInput, "subject">): Classification => ({ class: "other", summary: input.subject.trim() || "an email", uncertain: true });

export function classifierPrompt(input: ClassifyInput, feedback?: string): string {
  const today = formatInZone(input.now, input.timezone, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return [
    `You sort email that a landlord or leasing office sent to a shared apartment's inbox. Today is ${today} (time zone ${input.timezone}).`,
    input.workOrderTitle ? `This email is in the thread of a repair request the residents sent: "${input.workOrderTitle}".` : `It isn't a reply to a repair request.`,
    `Classes:`,
    `- notice: something dated that will happen at the apartment or building (inspection, water or power shut-off, maintenance window, pest control, fire alarm test).`,
    `- rent-lease: the rent amount changes, a renewal offer, lease terms, fees.`,
    `- work-order: a reply about the repair request above (only when there is one).`,
    `- other: everything else (newsletters, events, promotions, digests, receipts, a utility bill).`,
    `Reply with JSON only, no prose, no code fence:`,
    `{"class": "notice" | "rent-lease" | "work-order" | "other", "date": "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (local time, only if the email gives the day it happens or the visit's day), "amount": the money amount exactly as written (the new rent, or a bill's amount due), "utility": the utility's name for a utility bill (electric, gas, water, internet), "reply": for work-order only, "acknowledged" | "scheduled" | "done" | "other", "start": for a notice with a time window, when it starts, "YYYY-MM-DDTHH:mm" local, "end": when it ends, same format, "what": for a notice, the thing in 1-3 words, lower case ("water", "power", "elevator", "smoke detector inspection", "pest control"), "off": true when the notice says that thing will be off or out (a shut-off or outage), false for a visit or work, "summary": one short line for the group chat, lower case start, no greeting (e.g. "water's off Tue, 9 to 11 AM" or "smoke detector inspection Tuesday Nov 3, 9am-noon")}`,
    `Leave out keys you don't know. Never guess a date, a time or an amount.`,
    feedback ? `Your last answer was rejected: ${feedback}. Answer again with JSON only.` : "",
    ``,
    `From: ${input.from}`,
    `Subject: ${input.subject}`,
    ``,
    input.text.slice(0, 12_000),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** One small-model call on the gateway's chat completions (the askVision / recipes call shape, text only). */
export async function smallModelText(prompt: string, opts: { what: string; maxTokens?: number; model?: string }): Promise<string> {
  const base = (process.env.NEON_AI_GATEWAY_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base || !process.env.NEON_AI_GATEWAY_TOKEN) throw new Error(`The AI Gateway isn't configured, so I can't read ${opts.what}.`);
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NEON_AI_GATEWAY_TOKEN}` },
    body: JSON.stringify({
      model: opts.model ?? process.env.SMALL_MODEL ?? "claude-haiku-5-5",
      max_tokens: opts.maxTokens ?? 400,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    console.warn(`[mail] ${opts.what}: gateway ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    throw new Error(`Couldn't read ${opts.what} (gateway ${res.status}).`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

/** The model call with one retry (the error goes back to it); a second bad answer, or no answer, is `other`. */
export async function classifyWith(generate: (prompt: string) => Promise<string>, input: ClassifyInput): Promise<Classification> {
  let feedback: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      text = await generate(classifierPrompt(input, feedback));
    } catch (e) {
      console.warn(`[mail] classifier call failed: ${e instanceof Error ? e.message : String(e)}`);
      return FALLBACK(input);
    }
    try {
      const c = parseClassification(text);
      // A work-order reply needs a work order; without one it's just other mail.
      return c.class === "work-order" && !input.workOrderTitle ? { ...c, class: "other" } : c;
    } catch (e) {
      if (!(e instanceof ClassifierFormatError)) throw e;
      feedback = e.message;
    }
  }
  console.warn(`[mail] the classifier's answer wasn't usable twice (${feedback}); filed as other`);
  return FALLBACK(input);
}

const MERIDIEM = String.raw`(a\.?m\.?|p\.?m\.?)`;
const CLOCK = String.raw`(\d{1,2})(?::(\d{2}))?\s*${MERIDIEM}?`;
const WINDOW = new RegExp(String.raw`\b${CLOCK}\s*(?:-|–|—|to|and|until|till)\s*(?:${CLOCK}|(noon))`, "i");
const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
const to24 = (h: number, mer: string | undefined) => (mer ? (/^p/i.test(mer) ? (h % 12) + 12 : h % 12) : h);

/**
 * The fake's window on a known day: "between 9:00 AM and 11:00 AM", "9am-11am", "9 to 11 AM", "9am to noon". A
 * start without its own AM / PM takes the end's (unless that puts it after the end). Null without one.
 */
export function windowFromText(text: string, day: string): { start: string; end: string } | null {
  // "11-03" (a date) has no AM / PM: skip to a real window.
  const m = [...text.matchAll(new RegExp(WINDOW.source, "gi"))].find((x) => x[3] || x[6] || x[7]);
  if (!m) return null;
  const [, sh, sm, smer, eh, em, emer, noon] = m;
  const endH = noon ? 12 : to24(Number(eh), emer ?? smer);
  const endM = noon ? 0 : Number(em ?? 0);
  let startH = to24(Number(sh), smer ?? emer);
  if (!smer && startH * 60 + Number(sm ?? 0) > endH * 60 + endM) startH = Number(sh) % 12;
  if (startH > 23 || endH > 23) return null;
  return { start: `${day}T${hhmm(startH, Number(sm ?? 0))}`, end: `${day}T${hhmm(endH, endM)}` };
}

/** The fake's `what` and `off`: a shut-off of water / power / gas / the elevator, else the kind of visit. */
export function noticeWhatFromText(text: string): { what?: string; off?: boolean } {
  const off = /\b(?:shut-?off|shut off|turned off|will be (?:off|out|unavailable|out of service)|outage|interruption)\b/i.test(text);
  const thing = /\b(hot water|water|power|electricity|gas|elevators?)\b/i.exec(text)?.[1]?.toLowerCase();
  if (thing && off) return { what: thing === "electricity" ? "power" : thing, off: true };
  // The most specific kind the email names anywhere (the subject may only say "inspection").
  const visit = ["smoke detector inspection", "pest control", "inspection", "maintenance", "painting"].find((k) => new RegExp(String.raw`\b${k}\b`, "i").test(text));
  return visit ? { what: visit, off: false } : {};
}

/** Evals (MAIL_CLASSIFIER_FAKE=1): keywords, no model. */
export const keywordClassifier: MailClassifier = {
  async classify(input) {
    const text = `${input.subject}\n${input.text}`;
    const amount = /\$\s?\d[\d,]*(?:\.\d{2})?/.exec(text)?.[0];
    const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text)?.[1];
    const summary = input.subject.replace(/^(?:fwd?|re):\s*/i, "").trim() || "an email";
    if (input.workOrderTitle) {
      const reply = /\b(?:done|fixed|repaired|completed)\b/i.test(text) ? "done" : /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|schedul\w*|come by|visit)\b/i.test(text) ? "scheduled" : "acknowledged";
      return { class: "work-order", summary, reply, ...(iso ? { date: iso } : {}) };
    }
    if (/\b(?:rent|renewal|lease)\b/i.test(text)) return { class: "rent-lease", summary, ...(amount ? { amountCents: parseMoney(amount)! } : {}) };
    if (/\b(?:inspection|shut-?off|maintenance|pest|water will be|power will be)\b/i.test(text)) {
      const window = iso ? windowFromText(text, iso) : null;
      return { class: "notice", summary, ...(iso ? { date: window?.start ?? iso } : {}), ...(window ?? {}), ...noticeWhatFromText(text) };
    }
    const utility = /\b(electric|gas|water|internet)\b.*\bbill\b/i.exec(text)?.[1]?.toLowerCase();
    return { class: "other", summary, ...(utility ? { utility } : {}), ...(utility && amount ? { amountCents: parseMoney(amount)! } : {}) };
  },
};

export const smallModelClassifier: MailClassifier = {
  classify: (input) => classifyWith((prompt) => smallModelText(prompt, { what: "that email" }), input),
};
