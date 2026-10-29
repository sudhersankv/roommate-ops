// The Learned style's counts come from the messages, not the model. Run: npx tsx --test src/lib/style-stats.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyLearned } from "./personality";
import { activeHours, countNickname, countPhrase, mergeLearned, type StyleCandidates, type StyleLine } from "./style-stats";

const at = (h: number) => new Date(Date.UTC(2026, 9, 28, h + 5)); // h o'clock in Chicago (CDT)
const L = (name: string, text: string, h = 20): StyleLine => ({ name, text, at: at(h) });
const none: StyleCandidates = { languages: [], codeSwitching: 0, slang: [], tone: [], nicknames: [], insideJokes: [] };

test("phrases count whole words in messages; nicknames only when someone else uses them", () => {
  const lines = [L("Maya", "no cap that was good"), L("Dev", "NO CAP"), L("Sam", "nocap"), L("Dev", "devvy here"), L("Maya", "devvy pay up"), L("Sam", "lol devvy")];
  assert.equal(countPhrase(lines, "no cap"), 2);
  assert.equal(countNickname(lines, "devvy", "Dev"), 2, "Dev calling himself Devvy doesn't count");
});

test("merge: model candidates are kept only as far as the messages back them; counts accumulate", () => {
  const batch1 = [L("Maya", "bet 🔥🔥"), L("Dev", "bet"), L("Sam", "yaar chalo"), L("Maya", "devvy?"), L("Sam", "ok devvy"), L("Maya", "the plant lives")];
  const cand: StyleCandidates = {
    languages: [{ name: "English", share: 0.8 }, { name: "Hindi", share: 0.2 }],
    codeSwitching: 0.2,
    slang: ["bet", "yaar", "skibidi"],
    tone: ["teasing", "warm"],
    nicknames: [{ nickname: "devvy", member: "Dev" }],
    insideJokes: ["the plant lives"],
  };
  const one = mergeLearned(emptyLearned(), batch1, cand, "America/Chicago", new Date("2026-10-28T00:00:00Z"));
  assert.deepEqual(one.slang, [{ phrase: "bet", count: 2 }], "yaar used once, skibidi never: dropped");
  assert.deepEqual(one.nicknames, [{ nickname: "devvy", member: "Dev", count: 2 }]);
  assert.equal(one.messagesSeen, 6);
  assert.equal(one.hours[20], 6);
  assert.ok(one.emojiPerMessage > 0.3 && one.emojiPerMessage < 0.4);
  assert.deepEqual(one.tone, ["teasing", "warm"]);
  assert.equal(one.languages[0].name, "English");

  const batch2 = [L("Dev", "bet bet"), L("Sam", "yaar"), L("Sam", "yaar fr"), L("Maya", "devvy lol", 9)];
  const two = mergeLearned(one, batch2, none, "America/Chicago");
  assert.deepEqual(two.slang.map((s) => `${s.phrase} ${s.count}`), ["bet 3"], "yaar has 2 here but was dropped before: needs the model to propose it again");
  assert.equal(two.nicknames[0].count, 3, "3 sightings: usable now");
  assert.equal(two.messagesSeen, 10);
  assert.deepEqual(two.tone, ["teasing", "warm"], "no new tone: keep the old");
  assert.ok(two.languages[0].share < one.languages[0].share + 0.01);
  assert.deepEqual(activeHours(two.hours, 2), [9, 20]);
  assert.ok(two.confidence > one.confidence);
});

test("merge with no lines changes nothing", () => {
  const l = emptyLearned();
  assert.equal(mergeLearned(l, [], none, "UTC"), l);
});
