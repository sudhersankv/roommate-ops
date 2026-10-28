// Instacart behind one interface (ADR 0004). Composio's Instacart toolkit is "no auth": one app-level caller, no
// connected account and no auth config, only a working COMPOSIO_API_KEY. The fake returns deterministic
// https://instacart.example/... links for tests, evals and dev-chat (INSTACART_FAKE=1, or dev-chat when the key is
// missing or rejected). Shapes follow Instacart's Developer Platform API (POST /idp/v1/products/recipe and
// /products/products_link); Composio passes them through.
import { composio, composioHealth, isAuthError } from "./composio";
import type { InstacartUnit } from "@/lib/units";

export type InstacartMeasurement = { quantity: number; unit: InstacartUnit };
export type InstacartLineItem = { name: string; displayText?: string; measurements: InstacartMeasurement[] };

export type RecipePageInput = {
  title: string;
  servings: number;
  cookingTimeMinutes?: number | null;
  imageUrl?: string | null;
  instructions: string[];
  ingredients: InstacartLineItem[];
  /** Where "back to Roomie" on the Instacart page goes. */
  linkbackUrl?: string | null;
  /** Lets the shopper untick what they already have. */
  enablePantryItems?: boolean;
};
export type ShoppingListInput = { title: string; lineItems: InstacartLineItem[]; linkbackUrl?: string | null };

export interface InstacartClient {
  readonly kind: "composio" | "fake";
  recipePage(input: RecipePageInput): Promise<{ url: string }>;
  shoppingListPage(input: ShoppingListInput): Promise<{ url: string }>;
}

/** Instacart can't be reached (no key, bad key, Composio down). Roomie says so instead of failing the request. */
export class InstacartUnavailableError extends Error {
  constructor(message = "The Instacart link isn't available yet.") {
    super(message);
    this.name = "InstacartUnavailableError";
  }
}

/* ---------- the wire format (Instacart IDP) ---------- */

type Raw = Record<string, unknown>;

export function recipeArgs(input: RecipePageInput): Raw {
  return {
    title: input.title,
    servings: input.servings,
    ...(input.cookingTimeMinutes ? { cooking_time: input.cookingTimeMinutes } : {}),
    ...(input.imageUrl ? { image_url: input.imageUrl } : {}),
    instructions: input.instructions,
    ingredients: input.ingredients.map((i) => ({
      name: i.name,
      display_text: i.displayText ?? i.name,
      measurements: i.measurements.map((m) => ({ quantity: m.quantity, unit: m.unit })),
    })),
    landing_page_configuration: {
      ...(input.linkbackUrl ? { partner_linkback_url: input.linkbackUrl } : {}),
      enable_pantry_items: input.enablePantryItems ?? true,
    },
  };
}

export function shoppingListArgs(input: ShoppingListInput): Raw {
  return {
    title: input.title,
    link_type: "shopping_list",
    line_items: input.lineItems.map((i) => ({
      name: i.name,
      ...(i.displayText ? { display_text: i.displayText } : {}),
      line_item_measurements: i.measurements.map((m) => ({ quantity: m.quantity, unit: m.unit })),
    })),
    ...(input.linkbackUrl ? { landing_page_configuration: { partner_linkback_url: input.linkbackUrl } } : {}),
  };
}

/** products_link_url wherever Composio put it (top level, data, response_data). */
export function linkFrom(data: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (d: unknown): string | null => {
    if (!d || typeof d !== "object" || seen.has(d)) return null;
    seen.add(d);
    const r = d as Raw;
    const url = r.products_link_url ?? r.productsLinkUrl;
    if (typeof url === "string" && /^https:\/\//i.test(url)) return url;
    for (const v of Object.values(r)) {
      const hit = walk(v);
      if (hit) return hit;
    }
    return null;
  };
  return walk(data);
}

/* ---------- Composio ---------- */

/** The Composio user id Instacart calls run as. The toolkit is app-level, so it's the same for every Group. */
export const INSTACART_USER_ID = () => process.env.COMPOSIO_INSTACART_USER_ID?.trim() || "roomie-app";

export class ComposioInstacart implements InstacartClient {
  readonly kind = "composio" as const;

  private async run(slug: string, args: Raw): Promise<string> {
    const c = composio();
    if (!c) throw new InstacartUnavailableError("The Instacart link isn't available yet: COMPOSIO_API_KEY is missing.");
    const version = process.env.COMPOSIO_INSTACART_VERSION?.trim();
    try {
      const res = await c.tools.execute(slug, { userId: INSTACART_USER_ID(), arguments: args, ...(version ? { version } : { dangerouslySkipVersionCheck: true }) });
      if (!res.successful) {
        if (isAuthError({ message: res.error ?? "" })) throw new InstacartUnavailableError();
        throw new Error(`Instacart said no: ${String(res.error ?? "unknown error").slice(0, 200)}`);
      }
      const url = linkFrom(res.data);
      if (!url) throw new Error("Instacart didn't send back a link.");
      return url;
    } catch (e) {
      if (e instanceof InstacartUnavailableError) throw e;
      if (isAuthError(e)) throw new InstacartUnavailableError("The Instacart link isn't available yet: Composio rejected our API key.");
      throw e;
    }
  }

  async recipePage(input: RecipePageInput) {
    return { url: await this.run("INSTACART_CREATE_RECIPE_PAGE", recipeArgs(input)) };
  }

  async shoppingListPage(input: ShoppingListInput) {
    return { url: await this.run("INSTACART_CREATE_SHOPPING_LIST_PAGE", shoppingListArgs(input)) };
  }
}

/* ---------- the fake ---------- */

const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
};

export class FakeInstacart implements InstacartClient {
  readonly kind = "fake" as const;
  calls: { slug: string; args: Raw }[] = [];

  async recipePage(input: RecipePageInput) {
    const args = recipeArgs(input);
    this.calls.push({ slug: "INSTACART_CREATE_RECIPE_PAGE", args });
    return { url: `https://instacart.example/recipes/${hash(JSON.stringify(args))}` };
  }

  async shoppingListPage(input: ShoppingListInput) {
    const args = shoppingListArgs(input);
    this.calls.push({ slug: "INSTACART_CREATE_SHOPPING_LIST_PAGE", args });
    return { url: `https://instacart.example/lists/${hash(JSON.stringify(args))}` };
  }
}

/* ---------- which one ---------- */

let override: InstacartClient | null = null;
let fake: FakeInstacart | null = null;
let real: ComposioInstacart | null = null;

export const fakeInstacart = () => (fake ??= new FakeInstacart());

/** Tests inject a client; INSTACART_FAKE=1 picks the fake; otherwise Composio. */
export function setInstacartClient(c: InstacartClient | null) {
  override = c;
}

export function instacartClient(): InstacartClient {
  if (override) return override;
  if (process.env.INSTACART_FAKE === "1") return fakeInstacart();
  return (real ??= new ComposioInstacart());
}

export type InstacartAvailability = { ready: boolean; kind: "composio" | "fake"; hint?: string };

/** Whether the dashboard's "Get Instacart link" can work. The fake makes links nobody can open, so it's "not ready". */
export async function instacartAvailability(): Promise<InstacartAvailability> {
  const c = instacartClient();
  if (c.kind === "fake") return { ready: false, kind: "fake", hint: "Instacart is on the stand-in (INSTACART_FAKE=1), so there's no real link to open." };
  const health = await composioHealth();
  if (health === "ok") return { ready: true, kind: "composio" };
  if (health === "missing-key") return { ready: false, kind: "composio", hint: "The Instacart link needs COMPOSIO_API_KEY on the server." };
  if (health === "invalid-key") return { ready: false, kind: "composio", hint: "Composio rejected COMPOSIO_API_KEY, so the Instacart link is off until the key is fixed." };
  return { ready: false, kind: "composio", hint: "Composio isn't answering right now. Try again in a bit." };
}

let warned = false;
/** dev-chat and scripts: fall back to the fake (once, loudly) when Composio can't work. */
export async function useFakeInstacartIfUnavailable(log = console.log): Promise<void> {
  if (process.env.INSTACART_FAKE === "1") return;
  const health = await composioHealth();
  if (health === "ok") return;
  process.env.INSTACART_FAKE = "1";
  if (!warned) log(`(Instacart: COMPOSIO_API_KEY is ${health === "missing-key" ? "missing" : health === "invalid-key" ? "invalid" : "unreachable"}; using the fake, links go to instacart.example)`);
  warned = true;
}
