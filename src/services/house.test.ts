// House's upkeep lines for the morning Bundle and the report (#73), pure. Run: npx tsx --test src/services/house.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { upkeepBundleText, upkeepForBundle, upkeepReportParts, upkeepSentence } from "./house";

const done = new Date("2026-08-01T15:00:00Z");
// "Today" is Fri Oct 30 2026; Sunday is Nov 1.
const item = (item: string, dueIn: number, dueDay: string, whoseTurn: string | null = "Dev Patel", lastDone: Date | null = done) => ({ item, dueIn, dueDay, whoseTurn, lastDone });
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

test("upkeepForBundle: two days ahead, the day itself, and weekly while late; never-done items stay out", () => {
  const items = [
    item("Replace HVAC / air filter", 2, "2026-11-01"),
    item("Test smoke alarms", 1, "2026-10-31"),
    item("Clean dryer vent", 0, "2026-10-30"),
    item("Descale coffee maker", -7, "2026-10-23"),
    item("Check fire extinguisher", -3, "2026-10-27"),
    item("Clean the gutters", 0, "2026-10-30", "Sam", null),
    item("Water filter", 5, "2026-11-04"),
  ];
  assert.deepEqual(upkeepForBundle(items).map((m) => m.item), ["Replace HVAC / air filter", "Clean dryer vent", "Descale coffee maker"]);
});

test("upkeepSentence: names the person by first name and the day by name, in varied wording", () => {
  const filter = item("Replace HVAC / air filter", 2, "2026-11-01");
  const said = [0, 1, 2].map((v) => upkeepSentence(filter, v));
  assert.equal(said[0], "Air filter's due Sunday. Dev, you're up.");
  assert.equal(new Set(said).size, 3, "three different wordings");
  for (const s of said) {
    assert.match(s, /\bDev\b/);
    assert.match(s, /Sunday/);
    assert.doesNotMatch(s, /Patel/);
  }
  assert.equal(upkeepSentence(item("Replace HVAC / air filter", 0, "2026-10-30"), 1), "Air filter today. Dev's turn.");
});

test("upkeepSentence: a quick job takes a minute; late says how late; nobody active -> no name", () => {
  assert.equal(upkeepSentence(item("Test smoke alarms", 2, "2026-10-31", "Sam"), 0), "Smoke alarm test Saturday. Takes a minute, Sam.");
  assert.equal(upkeepSentence(item("Test smoke alarms", 2, "2026-10-31", "Sam"), 1), "Smoke alarm test Saturday, Sam. Takes a minute.");
  assert.equal(upkeepSentence(item("Descale coffee maker", -7, "2026-10-23", "Maya"), 0), "Coffee maker's a week late. Maya, you're up.");
  assert.equal(upkeepSentence(item("Descale coffee maker", -14, "2026-10-16", "Maya"), 1), "Maya, coffee maker is 2 weeks late; it's yours.");
  assert.equal(upkeepSentence(item("Replace HVAC / air filter", 2, "2026-11-01", null), 0), "Air filter's due Sunday.");
});

test("upkeepBundleText: null when nothing's worth a mention; two items never open the same way; the rest counted", () => {
  assert.equal(upkeepBundleText([]), null);
  assert.equal(upkeepBundleText([item("Water filter", 5, "2026-11-04"), item("Clean the gutters", 0, "2026-10-30", "Sam", null)]), null);
  const two = upkeepBundleText([item("Replace HVAC / air filter", 2, "2026-11-01"), item("Clean dryer vent", 2, "2026-11-01", "Sam")])!;
  assert.match(two, /\bDev\b/);
  assert.match(two, /\bSam\b/);
  for (const re of [/you're up/g, /'s turn/g, /on you/g]) assert.ok(count(two, re) <= 1, `one wording once: ${two}`);
  const three = upkeepBundleText([item("Replace HVAC / air filter", 0, "2026-10-30"), item("Clean dryer vent", 0, "2026-10-30", "Sam"), item("Descale coffee maker", -7, "2026-10-23", "Maya")])!;
  assert.match(three, /1 more upkeep on the list\.$/);
  assert.doesNotMatch(three, /Maya/);
  const one = [item("Replace HVAC / air filter", 2, "2026-11-01")];
  assert.equal(upkeepBundleText(one), upkeepBundleText(one), "the same morning reads the same");
});

test("upkeepReportParts: each item with whoever's up", () => {
  assert.deepEqual(upkeepReportParts([]), []);
  assert.equal(upkeepReportParts([{ item: "Replace HVAC / air filter", dueIn: 4, dueDay: "2026-11-03", whoseTurn: "Dev Patel" }])[0].text, "Upkeep due soon: Air filter (Dev, Tue).");
});
