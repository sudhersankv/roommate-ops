// The style job's JSON contract with a fake model. No DB, no gateway.
// Run: npx tsx --test src/jobs/style-candidates.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCandidates, readerFrom, STYLE_INSTRUCTIONS, stylePrompt } from "./style-candidates";

const lines = [
  { name: "Ryan", text: "bet, I'll grab the eggs", at: new Date() },
  { name: "Maya", text: "no cap ryry you said that yesterday", at: new Date() },
];
const good = { languages: [{ name: "English", share: 1 }], codeSwitching: 0, slang: ["bet", "no cap"], tone: ["teasing"], nicknames: [{ nickname: "ryry", member: "Ryan" }], insideJokes: [] };

test("the prompt asks for JSON only, and the lines go in as [Name] text", () => {
  assert.match(STYLE_INSTRUCTIONS, /Reply with JSON only/);
  assert.equal(stylePrompt(lines), "[Ryan] bet, I'll grab the eggs\n[Maya] no cap ryry you said that yesterday");
});

test("parseCandidates: plain JSON, fenced JSON, prose around it; missing lists default to empty", () => {
  assert.deepEqual(parseCandidates(JSON.stringify(good)), good);
  assert.deepEqual(parseCandidates("```json\n" + JSON.stringify(good) + "\n```"), good);
  assert.deepEqual(parseCandidates(`Here you go: ${JSON.stringify(good)} Hope that helps`), good);
  assert.deepEqual(parseCandidates(`{"slang": ["fr"]}`), { languages: [], codeSwitching: 0, slang: ["fr"], tone: [], nicknames: [], insideJokes: [] });
});

test("parseCandidates: not JSON, or the wrong shape -> null", () => {
  assert.equal(parseCandidates("I can't help with that."), null);
  assert.equal(parseCandidates("{not json}"), null);
  assert.equal(parseCandidates(`{"codeSwitching": 7}`), null);
});

test("readerFrom: a fake model's text becomes candidates; a bad answer skips the batch", async () => {
  let asked = "";
  const reader = readerFrom(async (prompt) => {
    asked = prompt;
    return JSON.stringify(good);
  });
  assert.deepEqual(await reader(lines), good);
  assert.match(asked, /\[Ryan\] bet/);
  assert.equal(await readerFrom(async () => "sorry")(lines), null);
});
