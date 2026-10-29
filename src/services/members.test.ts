// Member facts ("knows you"), pure. Run: npx tsx --test src/services/members.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeFacts, mergeFacts } from "./members";

test("remember: facts replace, 'cares about' keeps the newest 3, empty clears", () => {
  let n = mergeFacts({ handles: { venmo: "@maya" } }, { diet: "vegetarian", caresAbout: "the plant" });
  n = mergeFacts(n, { caresAbout: "climbing" });
  n = mergeFacts(n, { caresAbout: "jazz" });
  n = mergeFacts(n, { caresAbout: "THE PLANT" });
  n = mergeFacts(n, { caresAbout: "tea" });
  assert.deepEqual(n.caresAbout, ["jazz", "THE PLANT", "tea"]);
  assert.equal(n.handles?.venmo, "@maya", "handles untouched");
  assert.equal(mergeFacts(n, { diet: "" }).diet, undefined);
});

test("describeFacts reads like a sentence, payment apps without handles", () => {
  const s = describeFacts({ preferredName: "May", diet: "vegetarian", allergies: "peanuts", caresAbout: ["the plant"], birthday: "March 3", handles: { venmo: "@maya" } });
  assert.equal(s, "goes by May; diet: vegetarian; allergies: peanuts; cares about the plant; birthday: March 3; pays with venmo");
  assert.equal(describeFacts({}), "");
});
