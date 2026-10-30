// Receipt photo -> Expense. A vision model on the Neon AI Gateway only transcribes the receipt (names and prices as
// printed); every number after that is computed here (ADR 0007). The printed total is never trusted on its own:
// items + tax + tip is recomputed and a mismatch is flagged so Roomie asks before logging.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { appUrl } from "@/lib/urls";
import { apportion, type SplitRow } from "./split";

export type ReceiptItem = { name: string; cents: number };
export type ParsedReceipt = {
  merchant: string;
  date: string | null; // YYYY-MM-DD when readable
  items: ReceiptItem[];
  taxCents: number;
  tipCents: number;
  /** What the receipt says the total is. */
  printedTotalCents: number | null;
  /** items + tax + tip, computed here. */
  totalCents: number;
  itemsCents: number;
  mismatch: boolean;
  confidence: "high" | "low";
};

/* ---------- the model's answer, validated ---------- */

const price = z.union([z.string(), z.number()]).nullable().optional();
export const RawReceiptSchema = z.object({
  readable: z.boolean().optional(),
  merchant: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  items: z.array(z.object({ name: z.string(), price })).default([]),
  tax: price,
  tip: price,
  total: price,
});
export type RawReceipt = z.infer<typeof RawReceiptSchema>;

/** "12.50", "$12.50", 12.5 -> 1250. Null for anything else. Plain string parsing, no float math. */
export function priceToCents(p: string | number | null | undefined): number | null {
  if (p === null || p === undefined) return null;
  const s = String(p).replace(/[$€£₹,\s]/g, "");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] ? -cents : cents;
}

function toDay(s: string | null | undefined): string | null {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s.trim());
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  return null;
}

/** Validate and recompute: the sum comes from the items, never from the model. */
export function checkReceipt(raw: RawReceipt): ParsedReceipt {
  const items = raw.items
    .map((i) => ({ name: i.name.trim(), cents: priceToCents(i.price) }))
    .filter((i): i is ReceiptItem => !!i.name && i.cents !== null && i.cents > 0);
  const taxCents = Math.max(0, priceToCents(raw.tax) ?? 0);
  const tipCents = Math.max(0, priceToCents(raw.tip) ?? 0);
  const itemsCents = items.reduce((s, i) => s + i.cents, 0);
  const totalCents = itemsCents + taxCents + tipCents;
  const printedTotalCents = priceToCents(raw.total);
  const mismatch = printedTotalCents !== null && printedTotalCents !== totalCents;
  return {
    merchant: raw.merchant?.trim() || "Receipt",
    date: toDay(raw.date),
    items,
    taxCents,
    tipCents,
    printedTotalCents,
    totalCents,
    itemsCents,
    mismatch,
    confidence: raw.readable === false || items.length === 0 || mismatch ? "low" : "high",
  };
}

/* ---------- who had what ---------- */

export type ItemAssignment = { item: string; memberIds: string[] };

/** Find the receipt item an assignment means ("steak" -> "Ribeye steak"). */
export function matchItem(items: ReceiptItem[], query: string, taken: Set<number>): number {
  const q = query.trim().toLowerCase();
  const norm = (s: string) => s.toLowerCase();
  const order = items.map((_, i) => i).filter((i) => !taken.has(i));
  const hit =
    order.find((i) => norm(items[i].name) === q) ??
    order.find((i) => norm(items[i].name).includes(q) || q.includes(norm(items[i].name))) ??
    order.find((i) => q.split(/\s+/).some((w) => w.length > 2 && norm(items[i].name).includes(w)));
  return hit ?? -1;
}

/**
 * Shares from a receipt: each item goes to the people it's assigned to (split evenly), unassigned items are shared by
 * everyone, and tax + tip (or whatever `totalCents` adds on top of the items) are spread in proportion to each
 * person's items. Always sums to exactly `totalCents`.
 */
export function receiptSplits(
  receipt: Pick<ParsedReceipt, "items" | "totalCents">,
  assignments: ItemAssignment[],
  everyone: string[],
  payerId?: string,
  totalCents = receipt.totalCents,
): { rows: SplitRow[]; items: { name: string; cents: number; memberIds: string[] }[] } {
  const taken = new Set<number>();
  const who = new Map<number, string[]>();
  for (const a of assignments) {
    const i = matchItem(receipt.items, a.item, taken);
    if (i === -1) throw new Error(`No item like "${a.item}" on the receipt. Items: ${receipt.items.map((x) => x.name).join(", ")}.`);
    taken.add(i);
    who.set(i, a.memberIds.length ? a.memberIds : everyone);
  }
  const items = receipt.items.map((item, i) => ({ name: item.name, cents: item.cents, memberIds: [...new Set(who.get(i) ?? everyone)] }));
  // Each person's exact part of the items, as an integer weight: item cents x L / (people on the item), with L a
  // common multiple of the group sizes. One largest-remainder pass over the whole total keeps it fair and exact.
  const L = items.reduce((l, it) => lcm(l, it.memberIds.length), 1);
  const weight = new Map<string, number>();
  for (const it of items) for (const id of it.memberIds) weight.set(id, (weight.get(id) ?? 0) + (it.cents * L) / it.memberIds.length);
  const rows = apportion(totalCents, [...weight].map(([memberId, w]) => ({ memberId, weight: w })), { payerIds: payerId ? [payerId] : [] });
  return { rows: rows.filter((r) => r.cents > 0), items };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;

/* ---------- the vision call ---------- */

export interface ReceiptReader {
  read(image: { dataUrl: string }): Promise<RawReceipt>;
}

const PROMPT = `You are reading a photo of a receipt. Transcribe it; don't add anything up yourself.
Reply with JSON only, no prose:
{"readable": true|false, "merchant": string|null, "date": "YYYY-MM-DD"|null, "items": [{"name": string, "price": "12.50"}], "tax": "1.23"|null, "tip": "4.00"|null, "total": "17.73"|null}
Prices exactly as printed (strings, no currency symbol). One entry per line item (quantity x price lines: use the line total). Leave out subtotal, discounts you can't attribute, and payment lines.`;

/**
 * One photo + a prompt to the vision model on the gateway (`RECEIPT_MODEL ?? LLM_MODEL`); the model's text answer.
 * Receipts and the Groceries photo reader (grocery-photos.ts) both go through here. `what` names the photo in errors.
 */
export async function askVision(prompt: string, dataUrl: string, opts: { what: string; maxTokens?: number }): Promise<string> {
  const base = (process.env.NEON_AI_GATEWAY_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base || !process.env.NEON_AI_GATEWAY_TOKEN) throw new Error(`The AI Gateway isn't configured, so I can't read ${opts.what}s.`);
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NEON_AI_GATEWAY_TOKEN}` },
    body: JSON.stringify({
      model: process.env.RECEIPT_MODEL ?? process.env.LLM_MODEL ?? "claude-sonnet-5-5",
      // No temperature: claude-sonnet-5-5 on the gateway rejects the parameter.
      max_tokens: opts.maxTokens ?? 1500,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    console.warn(`[vision] ${opts.what}: gateway ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    throw new Error(`Couldn't read the ${opts.what} (gateway ${res.status}).`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

export const gatewayReceiptReader: ReceiptReader = {
  async read({ dataUrl }) {
    return parseModelJson(await askVision(PROMPT, dataUrl, { what: "receipt" }));
  },
};

export function parseModelJson(text: string): RawReceipt {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Couldn't make sense of that receipt. Try a sharper photo?");
  }
  const parsed = RawReceiptSchema.safeParse(data);
  if (!parsed.success) throw new Error("Couldn't make sense of that receipt. Try a sharper photo?");
  return parsed.data;
}

/** Tests and evals swap the reader (RECEIPT_FAKE=1 gives the sample receipt below without a model call). */
let reader: ReceiptReader | null = null;
export function setReceiptReader(r: ReceiptReader | null) {
  reader = r;
}

export const SAMPLE_RECEIPT: RawReceipt = {
  readable: true,
  merchant: "Luigi's Trattoria",
  date: "2026-10-27",
  items: [
    { name: "Ribeye steak", price: "38.00" },
    { name: "Margherita pizza", price: "18.50" },
    { name: "Caesar salad", price: "12.00" },
    { name: "Bottle house wine", price: "29.00" },
    { name: "Tiramisu", price: "9.50" },
  ],
  tax: "10.97",
  tip: "20.00",
  total: "137.97",
};
const fakeReader: ReceiptReader = { read: async () => SAMPLE_RECEIPT };
const currentReader = () => reader ?? (process.env.RECEIPT_FAKE === "1" ? fakeReader : gatewayReceiptReader);

/* ---------- images ---------- */

const UPLOADS = path.join(process.cwd(), "public", "uploads");
const MAX_BYTES = 8 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic" };

/**
 * Save an uploaded photo under public/uploads/<folder>/ (folder may be nested, "tg/-100123") and return its URL
 * (absolute when APP_URL is set). `baseName` keeps a Channel's file id, so the same photo is stored once.
 */
export async function saveUpload(folder: string, bytes: Buffer, mime: string, baseName?: string): Promise<{ file: string; path: string; url: string }> {
  if (!EXT[mime]) throw new Error("That isn't a photo I can read (JPEG, PNG, WebP or GIF).");
  if (bytes.length > MAX_BYTES) throw new Error("That photo is over 8 MB.");
  const safe = folder.split("/").map((s) => s.replace(/[^a-z0-9-]/gi, "")).filter(Boolean).join("/");
  const name = `${baseName?.replace(/[^a-z0-9_-]/gi, "") || randomUUID()}.${EXT[mime]}`;
  await mkdir(path.join(UPLOADS, safe), { recursive: true });
  const file = path.join(UPLOADS, safe, name);
  await writeFile(file, bytes);
  const rel = `/uploads/${safe}/${name}`;
  return { file, path: rel, url: `${appUrl()}${rel}` };
}

const mimeOf = (p: string) => Object.entries(EXT).find(([, e]) => p.toLowerCase().endsWith(`.${e}`) || (e === "jpg" && p.toLowerCase().endsWith(".jpeg")))?.[0] ?? "image/jpeg";

const UPLOAD_PATH = /\/uploads\/((?:[a-z0-9-]+\/)*[a-z0-9-]+)\/([a-z0-9_-]+\.[a-z]+)$/i;

/** One of our own uploads (`/uploads/...`, or under APP_URL): what the Channels and the dashboard store. */
export function isOwnUpload(url: string): boolean {
  const base = appUrl();
  return UPLOAD_PATH.test(url) && (url.startsWith("/uploads/") || (!!base && url.startsWith(`${base}/uploads/`)));
}

/**
 * Our own uploads are read from disk (the gateway can't reach localhost); with `ownOnly` nothing else is read.
 * Otherwise an https image is fetched here: no redirects, and the size is checked before the body is read.
 */
export async function imageDataUrl(url: string, opts: { ownOnly?: boolean } = {}): Promise<string> {
  const local = UPLOAD_PATH.exec(url);
  if (local && isOwnUpload(url)) {
    const bytes = await readFile(path.join(UPLOADS, local[1], local[2]));
    return `data:${mimeOf(local[2])};base64,${bytes.toString("base64")}`;
  }
  if (opts.ownOnly || !/^https:\/\//i.test(url)) throw new Error("I can only read photos sent in the chat or uploaded on the dashboard.");
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
  const type = res.headers.get("content-type")?.split(";")[0] ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new Error("Couldn't download that photo.");
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("That photo is over 8 MB.");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("That photo is over 8 MB.");
  return `data:${type};base64,${bytes.toString("base64")}`;
}

const cache = new Map<string, ParsedReceipt>();

/** Read a receipt photo (by URL, or bytes from an upload). Results are cached per URL, so confirming doesn't re-read. */
export async function parseReceipt(input: { url: string } | { bytes: Buffer; mime: string }): Promise<ParsedReceipt> {
  const key = "url" in input ? input.url : null;
  if (key && cache.has(key)) return cache.get(key)!;
  const dataUrl = "url" in input ? await imageDataUrl(input.url) : `data:${input.mime};base64,${input.bytes.toString("base64")}`;
  const parsed = checkReceipt(await currentReader().read({ dataUrl }));
  if (parsed.items.length === 0) throw new Error("I couldn't find any items on that receipt. Try a sharper photo?");
  if (key) {
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    cache.set(key, parsed);
  }
  return parsed;
}
