import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ExaSearch, FakeSearch, SearchUnavailableError, placeFrom, searchAvailability, searchClient, setSearchClient } from "./search";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  setSearchClient(null);
});

const jsonFetch = (status: number, body: unknown, seen?: { url?: string; init?: RequestInit }) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    if (seen) Object.assign(seen, { url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

describe("ExaSearch", () => {
  test("posts the question to /answer with the key, and reads the structured answer, its place and sources", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const exa = new ExaSearch(
      "k-123",
      jsonFetch(
        200,
        {
          answer: { answer: "Costco closes at 8:30 PM.", place: { name: "Costco", address: "1430 S Ashland Ave", latitude: 41.86, longitude: -87.66 } },
          citations: [{ title: "Costco hours", url: "https://www.costco.com/x" }, { title: null, url: "https://example.org/y" }, { title: "bad", url: "ftp://nope" }],
        },
        seen,
      ),
    );
    const r = await exa.answer("is costco open till 9");
    assert.equal(seen.url, "https://api.exa.ai/answer");
    assert.equal((seen.init?.headers as Record<string, string>)["x-api-key"], "k-123");
    const body = JSON.parse(String(seen.init?.body));
    assert.equal(body.query, "is costco open till 9");
    assert.equal(body.text, false);
    assert.ok(body.outputSchema);
    assert.equal(r.answer, "Costco closes at 8:30 PM.");
    assert.deepEqual(r.place, { name: "Costco", address: "1430 S Ashland Ave", lat: 41.86, lng: -87.66 });
    assert.deepEqual(r.sources, [
      { title: "Costco hours", url: "https://www.costco.com/x" },
      { title: "example.org", url: "https://example.org/y" },
    ]);
  });

  test("a plain string answer has no place", async () => {
    const r = await new ExaSearch("k", jsonFetch(200, { answer: "Yes.", citations: [] })).answer("q");
    assert.deepEqual(r, { answer: "Yes.", sources: [], place: null });
  });

  test("an error status or a bad body is SearchUnavailableError", async () => {
    await assert.rejects(new ExaSearch("k", jsonFetch(401, { error: "no" })).answer("q"), SearchUnavailableError);
    await assert.rejects(new ExaSearch("k", jsonFetch(200, { nope: 1 })).answer("q"), SearchUnavailableError);
    const throwing = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    await assert.rejects(new ExaSearch("k", throwing).answer("q"), SearchUnavailableError);
  });
});

describe("placeFrom", () => {
  test("needs a name and coordinates in range", () => {
    assert.equal(placeFrom(null), null);
    assert.equal(placeFrom({ name: "X", latitude: 91, longitude: 0 }), null);
    assert.equal(placeFrom({ name: "", latitude: 1, longitude: 2 }), null);
    assert.deepEqual(placeFrom({ name: " X ", address: " ", latitude: 1, longitude: 2 }), { name: "X", lat: 1, lng: 2 });
  });
});

describe("FakeSearch", () => {
  test("answers from its fixtures, deterministically, and keeps the queries", async () => {
    const f = new FakeSearch();
    const a = await f.answer("is Costco open till 9?");
    assert.match(a.answer, /8:30 PM/);
    assert.ok(a.place);
    const b = await f.answer("best ramen");
    assert.equal(b.place, null);
    assert.equal(b.sources.length, 1);
    assert.deepEqual(f.queries, ["is Costco open till 9?", "best ramen"]);
    assert.deepEqual(await f.answer("best ramen"), b);
  });
});

describe("searchClient / searchAvailability", () => {
  test("no key: the fake, but look-up isn't available", () => {
    delete process.env.EXA_API_KEY;
    delete process.env.SEARCH_FAKE;
    assert.equal(searchClient().kind, "fake");
    assert.deepEqual(searchAvailability(), { ready: false, kind: "none" });
  });
  test("SEARCH_FAKE=1: the fake, available", () => {
    process.env.EXA_API_KEY = "k";
    process.env.SEARCH_FAKE = "1";
    assert.equal(searchClient().kind, "fake");
    assert.equal(searchAvailability().ready, true);
  });
  test("a key: Exa", () => {
    process.env.EXA_API_KEY = "k";
    delete process.env.SEARCH_FAKE;
    assert.equal(searchClient().kind, "exa");
    assert.deepEqual(searchAvailability(), { ready: true, kind: "exa" });
  });
  test("a test's client wins and counts as available", () => {
    delete process.env.EXA_API_KEY;
    const f = new FakeSearch();
    setSearchClient(f);
    assert.equal(searchClient(), f);
    assert.equal(searchAvailability().ready, true);
  });
});
