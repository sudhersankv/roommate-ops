import { test } from "node:test";
import assert from "node:assert/strict";
import { dropMemberLines, readSection, replaceSection, shouldRefreshStyle, STYLE_EVERY } from "./style-note";

const WM = `# Group
## Group style
- Languages:
- Tone:

## Member notes
- Maya: diet: vegetarian
`;

test("refresh every 50 new lines", () => {
  assert.equal(STYLE_EVERY, 50);
  assert.equal(shouldRefreshStyle(49), false);
  assert.equal(shouldRefreshStyle(50), true);
});

test("replaceSection swaps only the Group style body and keeps Member notes", () => {
  const out = replaceSection(WM, "## Group style", "- Languages: English, Spanish\n- Tone: dry\n- Confidence (0-1): 0.4");
  assert.equal(readSection(out, "## Group style"), "- Languages: English, Spanish\n- Tone: dry\n- Confidence (0-1): 0.4");
  assert.equal(readSection(out, "## Member notes"), "- Maya: diet: vegetarian");
  assert.match(out, /^# Group\n## Group style\n/);
});

test("replaceSection appends a missing section", () => {
  const out = replaceSection("# Group\n## Member notes\n- Dev: pays with venmo\n", "## Group style", "- Tone: chill");
  assert.equal(readSection(out, "## Group style"), "- Tone: chill");
  assert.equal(readSection(out, "## Member notes"), "- Dev: pays with venmo");
});

test("readSection of a missing heading is empty", () => {
  assert.equal(readSection(WM, "## Nope"), "");
});

test("dropMemberLines forgets one Member's notes and keeps everyone else's", () => {
  const notes = "- Dev: pays with venmo\n- [Maya]: vegetarian\n- Developer Dan: likes tea";
  assert.equal(dropMemberLines(notes, "dev"), "- [Maya]: vegetarian\n- Developer Dan: likes tea");
  assert.equal(dropMemberLines(notes, "Maya"), "- Dev: pays with venmo\n- Developer Dan: likes tea");
});