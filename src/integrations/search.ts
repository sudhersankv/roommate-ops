// Look things up (#78) behind one interface. The real client calls Exa's /answer endpoint with fetch (a short answer
// plus the pages it came from); the fake answers from a small fixed table, so tests, evals and dev-chat never reach
// the network. searchClient() is the fake with SEARCH_FAKE=1 or without EXA_API_KEY; searchAvailability() says
// whether look-up is really on (a key, the fake on purpose, or a test's client), so production without a key says
// "not available yet" instead of answering from the fake.
import { z } from "zod";

export type SearchSource = { title: string; url: string };
/** One place the answer is about, when the answer is one place and the source gave its coordinates. */
export type SearchPlace = { name: string; address?: string; lat: number; lng: number };
export type SearchAnswer = { answer: string; sources: SearchSource[]; place: SearchPlace | null };

export interface SearchClient {
  readonly kind: "exa" | "fake";
  /** One question, as it goes out ("near us" already spelled out by services/look-up.ts). */
  answer(query: string): Promise<SearchAnswer>;
}

/** What Roomie says when the search service can't be reached. */
export class SearchUnavailableError extends Error {
  constructor(message = "I couldn't look that up right now. Try again in a bit.") {
    super(message);
    this.name = "SearchUnavailableError";
  }
}

const placeSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional().nullable(),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
});

/** A place from the model's structured answer, or null when it's missing, partial or out of range. */
export function placeFrom(raw: unknown): SearchPlace | null {
  const p = placeSchema.safeParse(raw);
  if (!p.success) return null;
  return { name: p.data.name.trim(), ...(p.data.address?.trim() ? { address: p.data.address.trim() } : {}), lat: p.data.latitude, lng: p.data.longitude };
}

/* ---------- Exa ---------- */

const EXA_URL = "https://api.exa.ai/answer";

/** Exa's answer comes back as this object (outputSchema); a plain string answer is taken as it is. */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "The answer in at most two short sentences, plain text, no links." },
    place: {
      type: ["object", "null"],
      description: "Only when the answer is about exactly one physical place and a source gives its coordinates; otherwise null.",
      properties: {
        name: { type: "string" },
        address: { type: "string" },
        latitude: { type: "number" },
        longitude: { type: "number" },
      },
      required: ["name", "latitude", "longitude"],
    },
  },
  required: ["answer"],
} as const;

const SYSTEM_PROMPT =
  "Answer for someone in a group chat: at most two short sentences, the fact first, exact times, prices and distances when the sources give them. No markdown, no links. If the sources don't say, say so plainly.";

const exaResponse = z.object({
  answer: z.union([z.string(), z.object({ answer: z.string().optional(), place: z.unknown().optional() }).passthrough()]),
  citations: z.array(z.object({ title: z.string().nullish(), url: z.string() }).passthrough()).optional(),
});

export class ExaSearch implements SearchClient {
  readonly kind = "exa" as const;
  constructor(
    private readonly apiKey = process.env.EXA_API_KEY ?? "",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async answer(query: string): Promise<SearchAnswer> {
    let res: Response;
    try {
      res = await this.fetcher(EXA_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.apiKey },
        body: JSON.stringify({ query, text: false, systemPrompt: SYSTEM_PROMPT, outputSchema: OUTPUT_SCHEMA }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      console.warn(`[search] request failed: ${e instanceof Error ? e.message : String(e)}`);
      throw new SearchUnavailableError();
    }
    if (!res.ok) {
      console.warn(`[search] Exa answered ${res.status}`);
      throw new SearchUnavailableError();
    }
    const parsed = exaResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      console.warn("[search] Exa's answer didn't parse", parsed.error.issues[0]?.message);
      throw new SearchUnavailableError();
    }
    const a = parsed.data.answer;
    const answer = (typeof a === "string" ? a : (a.answer ?? "")).trim();
    const place = typeof a === "string" ? null : placeFrom(a.place);
    const sources = (parsed.data.citations ?? []).filter((c) => /^https?:\/\//.test(c.url)).map((c) => ({ title: c.title?.trim() || hostOf(c.url), url: c.url }));
    return { answer, sources, place };
  }
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/* ---------- the fake ---------- */

type Fixture = { match: RegExp; answer: SearchAnswer };

/** Deterministic answers for tests, evals and dev-chat. Every query asked is kept in `queries`. */
export const FAKE_FIXTURES: Fixture[] = [
  {
    match: /\bcostco\b/i,
    answer: {
      answer: "Costco on Ashland closes at 8:30 PM today, so not till 9.",
      sources: [{ title: "Costco Warehouse Hours", url: "https://www.costco.com/warehouse-locations/chicago-ashland.html" }],
      place: { name: "Costco Wholesale", address: "1430 S Ashland Ave, Chicago, IL 60608", lat: 41.8625, lng: -87.6664 },
    },
  },
  {
    match: /\bplumb/i,
    answer: {
      answer: "Pipe Pros Plumbing is 0.6 miles away and does same-day visits; they're at (312) 555-0142.",
      sources: [{ title: "Pipe Pros Plumbing - Reviews", url: "https://www.yelp.com/biz/pipe-pros-plumbing-chicago" }],
      place: { name: "Pipe Pros Plumbing", address: "2150 W Roscoe St, Chicago, IL 60618", lat: 41.9434, lng: -87.6826 },
    },
  },
  {
    match: /\b(?:recycl|bulk pickup|trash pickup)/i,
    answer: {
      answer: "Recycling in Chicago goes out every other week; check your block's day on the city's map.",
      sources: [{ title: "Recycling Pickup | City of Chicago", url: "https://www.chicago.gov/city/en/depts/streets/provdrs/streets_san/svcs/recycling.html" }],
      place: null,
    },
  },
];

export class FakeSearch implements SearchClient {
  readonly kind = "fake" as const;
  queries: string[] = [];
  constructor(private readonly fixtures: Fixture[] = FAKE_FIXTURES) {}

  async answer(query: string): Promise<SearchAnswer> {
    this.queries.push(query);
    const hit = this.fixtures.find((f) => f.match.test(query));
    if (hit) return structuredClone(hit.answer);
    return {
      answer: `Here's the short version for "${query.slice(0, 80)}": the sources agree, nothing surprising.`,
      sources: [{ title: "Search result", url: `https://search.example/?q=${encodeURIComponent(query.slice(0, 80))}` }],
      place: null,
    };
  }
}

/* ---------- which one ---------- */

let override: SearchClient | null = null;
let fake: FakeSearch | undefined;
let real: ExaSearch | undefined;

/** Tests inject a client; null goes back to the env's choice. */
export function setSearchClient(c: SearchClient | null) {
  override = c;
}

export function searchClient(): SearchClient {
  if (override) return override;
  if (process.env.SEARCH_FAKE === "1" || !process.env.EXA_API_KEY?.trim()) return (fake ??= new FakeSearch());
  return (real ??= new ExaSearch());
}

/** Whether look-up is on: a test's client, the fake on purpose (SEARCH_FAKE=1), or a key. No key and no fake = off. */
export function searchAvailability(): { ready: boolean; kind: "exa" | "fake" | "none" } {
  if (override) return { ready: true, kind: override.kind };
  if (process.env.SEARCH_FAKE === "1") return { ready: true, kind: "fake" };
  if (process.env.EXA_API_KEY?.trim()) return { ready: true, kind: "exa" };
  return { ready: false, kind: "none" };
}
