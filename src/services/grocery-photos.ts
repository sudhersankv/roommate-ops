// A photo for Groceries: a recipe, a shopping list or a shelf -> the things to buy, as written. The vision model only
// transcribes (askVision, the same call receipts use); zod validates. Receipts are recognized so Roomie can send them
// to Splitting instead. Reading never touches the Cart: the tool asks first, then addPhotoToCart adds.
import { z } from "zod";
import type { RecipeIngredient } from "@/db/schema";
import { measurementOrEach, parseAmount } from "@/lib/units";
import { addAsSaid } from "./cart";
import { listMembers } from "./members";
import { askVision, imageDataUrl } from "./receipts";
import { addRecipeToCart, saveRecipe } from "./recipes";
import type { Ctx } from "./types";

export type PhotoKind = "recipe" | "list" | "receipt" | "other";
export type PhotoItem = { name: string; qty: string | null };
export type GroceryPhoto = { kind: PhotoKind; title: string | null; servings: number | null; items: PhotoItem[]; steps: string[] };

export const RawPhotoSchema = z.object({
  kind: z.enum(["recipe", "list", "pantry", "receipt", "other"]).catch("other"),
  title: z.string().max(120).nullable().optional(),
  servings: z.coerce.number().int().positive().max(100).nullable().optional().catch(null),
  items: z.array(z.object({ name: z.string(), qty: z.union([z.string(), z.number()]).nullable().optional() })).max(80).default([]),
  steps: z.array(z.string()).max(40).default([]),
});

export const PHOTO_PROMPT = `Someone sent this photo to their household's group chat. It may be a recipe, a shopping list (handwritten or typed), a fridge or pantry shelf, a receipt, or something else. Transcribe what's there; don't add anything.
Reply with JSON only, no prose:
{"kind": "recipe"|"list"|"pantry"|"receipt"|"other", "title": string|null, "servings": number|null, "items": [{"name": string, "qty": string|null}], "steps": [string]}
- items: the things to buy, one per line as written. name: what you'd search for in a store, lower case, without the amount ("eggs", "olive oil"). qty: the amount exactly as written ("2 cups", "12", "1 lb") or null.
- recipe: its ingredients are the items; steps are its steps (short); title and servings if printed.
- pantry: what you can clearly see on the shelf, as items.
- receipt: a store or restaurant receipt with prices. Return kind "receipt" and no items.
- other: anything else, no items.`;

/** The model's text -> a validated photo. Item names cleaned, duplicates kept (the Cart decides). */
export function parsePhotoJson(text: string): GroceryPhoto {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Couldn't make sense of that photo. Try a sharper one?");
  }
  const parsed = RawPhotoSchema.safeParse(data);
  if (!parsed.success) throw new Error("Couldn't make sense of that photo. Try a sharper one?");
  const raw = parsed.data;
  const items = raw.items
    .map((i) => ({ name: i.name.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80), qty: i.qty === null || i.qty === undefined || String(i.qty).trim() === "" ? null : String(i.qty).trim().slice(0, 40) }))
    .filter((i) => i.name);
  const kind: PhotoKind = raw.kind === "pantry" ? "list" : raw.kind;
  return {
    kind,
    title: raw.title?.trim() || null,
    servings: raw.servings ?? null,
    items: kind === "receipt" || kind === "other" ? [] : items,
    steps: kind === "recipe" ? raw.steps.map((s) => s.trim()).filter(Boolean) : [],
  };
}

export interface PhotoReader {
  /** The model's raw text answer for the photo. */
  read(image: { dataUrl: string }): Promise<string>;
}

export const gatewayPhotoReader: PhotoReader = { read: ({ dataUrl }) => askVision(PHOTO_PROMPT, dataUrl, { what: "photo", maxTokens: 2000 }) };

export const SAMPLE_LIST_JSON = JSON.stringify({
  kind: "list",
  title: null,
  servings: null,
  items: [
    { name: "eggs", qty: "12" },
    { name: "milk", qty: "1 gallon" },
    { name: "bread", qty: null },
    { name: "bananas", qty: "6" },
    { name: "rice", qty: "2 lb" },
  ],
  steps: [],
});

/**
 * The fake (RECEIPT_FAKE=1, the evals): a photo whose bytes say "receipt" is a receipt, anything else the sample
 * list above, so a scenario picks what the photo is by what it saves.
 */
const fakeReader: PhotoReader = {
  read: async ({ dataUrl }) => {
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64").toString("utf8");
    return /receipt/i.test(bytes) ? JSON.stringify({ kind: "receipt", items: [] }) : SAMPLE_LIST_JSON;
  },
};

let reader: PhotoReader | null = null;
/** Tests swap the reader (null restores the gateway / the RECEIPT_FAKE fake). */
export function setPhotoReader(r: PhotoReader | null) {
  reader = r;
}
const currentReader = () => reader ?? (process.env.RECEIPT_FAKE === "1" ? fakeReader : gatewayPhotoReader);

const cache = new Map<string, GroceryPhoto>();

/** Read a Groceries photo by URL. Cached per URL, so "yes, add them" doesn't read it again. */
export async function readGroceryPhoto(url: string): Promise<GroceryPhoto> {
  const hit = cache.get(url);
  if (hit) return hit;
  const photo = parsePhotoJson(await currentReader().read({ dataUrl: await imageDataUrl(url) }));
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  cache.set(url, photo);
  return photo;
}

/** For tests: forget what was read. */
export const clearPhotoCache = () => cache.clear();

export type PhotoAdded = {
  kind: PhotoKind;
  /** Set for a recipe photo: it was saved as a Recipe. */
  recipe?: string;
  added: string[];
  /** In the Pantry or said to skip. */
  skippedHave: string[];
  alreadyInCart: string[];
  needsClarification: string[];
};

/** A recipe photo's ingredients as Recipe ingredients (amounts read with lib/units; unreadable ones are 1 each). */
export function photoIngredients(items: PhotoItem[]): RecipeIngredient[] {
  return items.map((i) => {
    const m = parseAmount(i.qty) ?? measurementOrEach(1, null);
    return { name: i.name, quantity: m.quantity, unit: m.unit, display_text: i.qty ? `${i.qty} ${i.name}` : i.name };
  });
}

/**
 * They said yes: put what the photo shows in the Cart. A recipe is saved as a Recipe (servings as printed, else the
 * active Members) and its ingredients go in like any Recipe's (shared by default, minus the Pantry and `skip`, minus
 * what's already there). A list goes in as said, for the sender, `forMemberId` or everyone (`shared`).
 */
export async function addPhotoToCart(ctx: Ctx, photo: GroceryPhoto, opts: { shared?: boolean; forMemberId?: string; skip?: string[] } = {}): Promise<PhotoAdded> {
  if (photo.items.length === 0) throw new Error("There's nothing to add from that photo.");
  const skip = (opts.skip ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (photo.kind === "recipe") {
    const servings = photo.servings ?? Math.max(1, (await listMembers(ctx)).length);
    const saved = await saveRecipe(ctx, { title: photo.title ?? "Recipe from a photo", servings, cookingTimeMinutes: null, ingredients: photoIngredients(photo.items), steps: photo.steps, source: "member" });
    const r = await addRecipeToCart(ctx, saved.id, { skip, shared: opts.forMemberId ? false : (opts.shared ?? true) });
    return { kind: "recipe", recipe: saved.title, added: r.added.map((i) => i.name), skippedHave: r.have, alreadyInCart: r.alreadyInCart, needsClarification: [] };
  }
  const wanted = photo.items.filter((i) => !skip.includes(i.name)).map((i) => ({ name: i.name, ...(i.qty ? { qty: i.qty } : {}) }));
  const r = await addAsSaid(ctx, { items: wanted, shared: opts.shared, forMemberId: opts.forMemberId });
  return { kind: photo.kind, added: r.added.map((i) => i.name), skippedHave: photo.items.filter((i) => skip.includes(i.name)).map((i) => i.name), alreadyInCart: [], needsClarification: r.needsClarification };
}

/** "9 items: eggs (12), milk (1 gallon), bread, …" in one line, at most `max` names. */
export function photoSummary(items: PhotoItem[], max = 8): string {
  const shown = items.slice(0, max).map((i) => (i.qty && i.qty !== "1" ? `${i.name} (${i.qty})` : i.name));
  return `${items.length} item${items.length === 1 ? "" : "s"}: ${shown.join(", ")}${items.length > max ? ", …" : ""}`;
}
