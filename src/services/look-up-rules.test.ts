import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { localQuery, memberNamed, shortAnswer, wantsNearUs } from "./look-up-rules";
import { cleanPin, mapsUrl, pinLabel, pinTag } from "@/lib/place";

const NAMES = ["Maya", "Dev Patel", "Sam", "Former member", "Someone", "+1 555 0100", "Zoë"];

describe("memberNamed", () => {
  test("a Member's name or first name as a whole word", () => {
    assert.equal(memberNamed("look up dev patel's instagram", NAMES), "Dev Patel");
    assert.equal(memberNamed("who is DEV", NAMES), "Dev Patel");
    assert.equal(memberNamed("find maya's address", NAMES), "Maya");
    assert.equal(memberNamed("is zoe on linkedin", NAMES), "Zoë");
  });
  test("not a Member: other words, placeholders, partial words", () => {
    assert.equal(memberNamed("is costco open till 9", NAMES), null);
    assert.equal(memberNamed("best devices under $50", NAMES), null);
    assert.equal(memberNamed("samsung fridge reviews", NAMES), null);
    assert.equal(memberNamed("former tenants rights chicago", NAMES), null);
    assert.equal(memberNamed("someone's lost dog", NAMES), null);
  });
});

describe("near us", () => {
  const place = { lat: 41.9, lng: -87.7, name: "Apt 4B", address: "2140 W Roscoe St, Chicago" };
  test("the words", () => {
    for (const q of ["find a plumber near us", "pizza nearby", "closest pharmacy", "laundromat around here", "gyms in our area"]) assert.ok(wantsNearUs(q), q);
    for (const q of ["is costco open till 9", "how long do eggs keep"]) assert.ok(!wantsNearUs(q), q);
  });
  test("spelled out as the saved place", () => {
    assert.equal(localQuery("find a plumber near us", place, true), "find a plumber near 2140 W Roscoe St, Chicago");
    assert.equal(localQuery("pizza nearby", { lat: 1, lng: 2 }, true), "pizza near 1, 2");
    assert.equal(localQuery("pizza nearby", { lat: 1, lng: 2, name: "Home" }, true), "pizza near Home (1, 2)");
    assert.equal(localQuery(" pizza nearby ", null, true), "pizza nearby");
    assert.equal(localQuery("is costco open", place, false), "is costco open");
  });
});

describe("shortAnswer", () => {
  test("two sentences, no links or markdown", () => {
    assert.equal(shortAnswer("**Costco** closes at 8:30 PM. It opens at 10 AM. Gas is open later."), "Costco closes at 8:30 PM. It opens at 10 AM.");
    assert.equal(shortAnswer("See [their site](https://x.com/a) or https://y.com now."), "See their site or now.");
    assert.equal(shortAnswer("Pipe Pros is 0.6 miles away. Eggs are $4.99 there. Third."), "Pipe Pros is 0.6 miles away. Eggs are $4.99 there.");
  });
  test("long text is cut on a word", () => {
    const out = shortAnswer("word ".repeat(100), 50);
    assert.ok(out.length <= 50, out);
    assert.ok(out.endsWith("…"));
  });
});

describe("pins", () => {
  test("cleanPin", () => {
    assert.equal(cleanPin({ lat: 91, lng: 0 }), null);
    assert.equal(cleanPin({ lat: Number.NaN, lng: 0 }), null);
    assert.equal(cleanPin(null), null);
    assert.deepEqual(cleanPin({ lat: 41.12345678, lng: -87.1, name: "  Home  ", address: "" }), { lat: 41.123457, lng: -87.1, name: "Home" });
  });
  test("label, tag and maps link", () => {
    const p = { lat: 1.5, lng: -2, name: 'The "Spot"', address: "1 Main St" };
    assert.equal(pinLabel(p), 'The "Spot", 1 Main St');
    assert.equal(pinLabel({ lat: 1.5, lng: -2 }), "1.5, -2");
    assert.equal(pinTag(p), `[location: 1.5,-2 name="The 'Spot'" address="1 Main St"]`);
    assert.equal(mapsUrl(p), "https://www.google.com/maps/search/?api=1&query=1.5,-2");
  });
});
