// The lease, read (ADR 0016 decision 4): a lease or notice Document's text, kept on documents.text, and ask_lease's
// answer from it. The text is AgentMail's textUrl when it has one, plain bytes for a text file, else the gateway's
// vision model on the file (the askVision call shape: a data URL in the message; a PDF goes as a `file` part). The
// answer is the model's, in strict JSON, citing the clause; code only picks the Document and checks the shape.
// setTextReader / setLeaseAnswerer for tests; MAIL_CLASSIFIER_FAKE=1 (evals) answers from the text by keywords.
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { smallModelText } from "./mail-classifier";
import type { GroupCtx } from "./types";

const { documents } = schema;
const MAX_TEXT = 200_000;

/* ---------- reading a file ---------- */

export type TextSource = { textUrl: string | null; bytes: Buffer; contentType: string | null; filename: string | null };
export type TextReader = (file: TextSource) => Promise<string | null>;

async function gatewayFileText(file: TextSource): Promise<string | null> {
  const base = (process.env.NEON_AI_GATEWAY_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base || !process.env.NEON_AI_GATEWAY_TOKEN) return null;
  const type = file.contentType ?? "application/octet-stream";
  const dataUrl = `data:${type};base64,${file.bytes.toString("base64")}`;
  const part = type.startsWith("image/") ? { type: "image_url", image_url: { url: dataUrl } } : { type: "file", file: { filename: file.filename ?? "document.pdf", file_data: dataUrl } };
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NEON_AI_GATEWAY_TOKEN}` },
    body: JSON.stringify({
      model: process.env.RECEIPT_MODEL ?? process.env.LLM_MODEL ?? "claude-sonnet-5-5",
      // No temperature: claude-sonnet-5-5 on the gateway rejects the parameter.
      max_tokens: 16_000,
      messages: [{ role: "user", content: [{ type: "text", text: "Transcribe this document's text exactly, keeping section and clause numbers and headings. Text only, no commentary." }, part] }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    console.warn(`[lease] reading ${file.filename ?? "a document"}: gateway ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    return null;
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content?.trim() || null;
}

export const defaultTextReader: TextReader = async (file) => {
  if (file.textUrl) {
    const res = await fetch(file.textUrl, { signal: AbortSignal.timeout(60_000) });
    if (res.ok) return (await res.text()).trim() || null;
  }
  if (file.contentType?.startsWith("text/")) return file.bytes.toString("utf8").trim() || null;
  return gatewayFileText(file);
};

let reader: TextReader | null = null;
/** Tests swap the reader; null goes back to the default. */
export function setTextReader(r: TextReader | null) {
  reader = r;
}

export async function extractDocumentText(file: TextSource): Promise<string | null> {
  const text = await (reader ?? defaultTextReader)(file);
  return text ? text.slice(0, MAX_TEXT) : null;
}

/* ---------- answering from it ---------- */

export type LeaseAnswer = { answer: string; clause: string | null; quote: string | null };
export type LeaseAnswerer = (input: { question: string; text: string }) => Promise<LeaseAnswer>;

const AnswerSchema = z.object({
  answer: z.string().trim().min(1),
  clause: z.string().trim().nullish().transform((v) => v || null),
  quote: z.string().trim().nullish().transform((v) => v || null),
});

/** The model's text -> a LeaseAnswer, or null when it isn't the JSON asked for. Pure. */
export function parseLeaseAnswer(text: string): LeaseAnswer | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const r = AnswerSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

const leasePrompt = (question: string, text: string, feedback?: string) =>
  [
    `Answer a roommate's question from their lease. Use only the lease text below. If it doesn't say, the answer is "The lease doesn't say."`,
    `Reply with JSON only, no prose, no code fence: {"answer": one or two plain sentences, "clause": the section or clause it comes from as the lease numbers it (e.g. "Section 14.2, Notice to Vacate") or null, "quote": the few words that say it, copied exactly, or null}`,
    feedback ? `Your last answer wasn't that JSON. Answer again with JSON only.` : "",
    `Question: ${question}`,
    `Lease:`,
    text.slice(0, 150_000),
  ]
    .filter(Boolean)
    .join("\n");

export const gatewayLeaseAnswerer: LeaseAnswerer = async ({ question, text }) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = parseLeaseAnswer(await smallModelText(leasePrompt(question, text, attempt ? "retry" : undefined), { what: "the lease", maxTokens: 500, model: process.env.LLM_MODEL }));
    if (out) return out;
  }
  return { answer: "I couldn't make sense of the lease on that one. Try asking it another way?", clause: null, quote: null };
};

/** Evals: the first paragraph sharing the most words with the question. */
export const keywordLeaseAnswerer: LeaseAnswerer = async ({ question, text }) => {
  const words = question.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const best = paras.map((p) => ({ p, n: words.filter((w) => p.toLowerCase().includes(w)).length })).sort((a, b) => b.n - a.n)[0];
  if (!best?.n) return { answer: "The lease doesn't say.", clause: null, quote: null };
  return { answer: best.p.replace(/\s+/g, " ").slice(0, 300), clause: /^(?:section|clause)?\s*[\d.]+[^\n.]*/i.exec(best.p)?.[0]?.trim() ?? null, quote: null };
};

let answerer: LeaseAnswerer | null = null;
export function setLeaseAnswerer(a: LeaseAnswerer | null) {
  answerer = a;
}

/** The newest filed lease with its text read, or null. */
export async function currentLease(ctx: GroupCtx) {
  const [doc] = await db
    .select({ id: documents.id, title: documents.title, text: documents.text, createdAt: documents.createdAt })
    .from(documents)
    .where(and(eq(documents.groupId, ctx.groupId), eq(documents.kind, "lease"), isNotNull(documents.text), isNotNull(documents.filedAt), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt))
    .limit(1);
  return doc ?? null;
}

export type AskLeaseResult = { found: false; line: string } | ({ found: true; document: string } & LeaseAnswer);

/** "What's the notice period in our lease?": from the stored text, citing the clause; "no lease filed yet" without one. */
export async function askLease(ctx: GroupCtx, input: { question: string }, opts: { address?: string | null } = {}): Promise<AskLeaseResult> {
  const lease = await currentLease(ctx);
  if (!lease?.text) {
    const how = opts.address ? ` Forward the lease PDF to ${opts.address} and I'll read it.` : "";
    return { found: false, line: `No lease filed yet.${how}` };
  }
  const pick = answerer ?? (process.env.MAIL_CLASSIFIER_FAKE === "1" ? keywordLeaseAnswerer : gatewayLeaseAnswerer);
  const a = await pick({ question: input.question.trim(), text: lease.text });
  return { found: true, document: lease.title, ...a };
}
