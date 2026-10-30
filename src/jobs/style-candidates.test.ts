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

test("parseCandidates: lenient, because a skipped batch is lost: long lists cut, percents read as shares, bad entries dropped", () => {
  const r = parseCandidates(JSON.stringify({ languages: [{ name: "Hindi", share: 45 }, { name: "English", share: 0.55 }, { name: 3 }], codeSwitching: 7, tone: ["a", "b", "c", "d", "e", "f"], slang: "bet" }))!;
  assert.deepEqual(r.languages, [{ name: "Hindi", share: 0.45 }, { name: "English", share: 0.55 }]);
  assert.equal(r.codeSwitching, 0.07);
  assert.deepEqual(r.tone, ["a", "b", "c", "d", "e"]);
  assert.deepEqual(r.slang, []);
});

test("parseCandidates: not JSON (or not an object) -> null", () => {
  assert.equal(parseCandidates("I can't help with that."), null);
  assert.equal(parseCandidates("{not json}"), null);
  assert.equal(parseCandidates(""), null);
});

test("readerFrom: a fake model's text becomes candidates; a bad answer skips the batch and is logged with a sample", async () => {
  let asked = "";
  const reader = readerFrom(async (prompt) => {
    asked = prompt;
    return JSON.stringify(good);
  });
  assert.deepEqual(await reader(lines), good);
  assert.match(asked, /\[Ryan\] bet/);
  const logs: string[] = [];
  const bad = readerFrom(async () => "sorry, no", (m) => logs.push(m));
  assert.equal(await bad(lines), null);
  assert.match(logs[0] ?? "", /wasn't JSON; skipped 1 batch so far\. It began: "sorry, no"/);
});
