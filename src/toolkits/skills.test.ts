// Each Trick's instructions are a skill.md next to its manifest (#35). skill.ts is generated from it by
// `npm run skills` (so every bundler loads plain TypeScript); this test fails when one is missing or stale.
// The composer loads the Gate-picked Trick's skill in full and the others as one line. Run: npx tsx --test src/toolkits/skills.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { roomieInstructions, toolkitPersona } from "@/mastra/agents/instructions";
import { skillModule, TRICK_DIRS } from "../../scripts/build-skills";
import { MANIFESTS, TOOLKIT_IDS } from "./manifests";

const dir = (name: string) => join(process.cwd(), "src", "toolkits", name);

describe("skill files", () => {
  test("core and every Trick with a manifest have a skill.md, and its skill.ts is up to date", () => {
    assert.deepEqual([...TRICK_DIRS].sort(), ["core", "groceries", "house", "lease-inbox", "splitting"]);
    for (const name of TRICK_DIRS) {
      const md = join(dir(name), "skill.md");
      assert.ok(existsSync(md), `${name}/skill.md is missing`);
      const ts = join(dir(name), "skill.ts");
      assert.ok(existsSync(ts), `${name}/skill.ts is missing: run npm run skills`);
      // Line endings aside (a Windows checkout turns LF into CRLF).
      const lf = (t: string) => t.replace(/\r\n/g, "\n");
      assert.equal(lf(readFileSync(ts, "utf8")), lf(skillModule(readFileSync(md, "utf8"))), `${name}/skill.ts is stale: run npm run skills`);
    }
  });

  test("manifests no longer carry instructions (they're client-safe data; skills are server-only)", () => {
    for (const m of MANIFESTS) assert.equal("persona" in m, false, m.id);
  });
});

describe("the composer: the picked Trick's skill in full, the others as one line", () => {
  const skills = { core: "CORE SKILL", splitting: "MONEY SKILL", groceries: "GROCERIES SKILL", house: "HOUSE SKILL", "lease-inbox": "INBOX SKILL" };
  const text = (picked: string | undefined, enabled: readonly string[] = TOOLKIT_IDS) => toolkitPersona(enabled, { picked, skills }).join("\n");

  test("a picked Trick: its skill and core's in full; the other learned Tricks as their one-line summary", () => {
    const t = text("groceries");
    assert.match(t, /GROCERIES SKILL/);
    assert.match(t, /CORE SKILL/);
    assert.doesNotMatch(t, /MONEY SKILL|HOUSE SKILL|INBOX SKILL/);
    for (const m of MANIFESTS.filter((x) => x.id !== "groceries")) assert.ok(t.includes(m.name), `${m.name} still named`);
  });

  test("no pick (or 'none'): every learned Trick's skill in full, as before", () => {
    for (const picked of [undefined, "none"]) {
      const t = text(picked);
      for (const s of ["CORE", "MONEY", "GROCERIES", "HOUSE", "INBOX"]) assert.match(t, new RegExp(`${s} SKILL`), `${picked}: ${s}`);
    }
  });

  test("'core' picked: core's skill in full, the Tricks as one line each", () => {
    const t = text("core");
    assert.match(t, /CORE SKILL/);
    assert.doesNotMatch(t, /MONEY SKILL|GROCERIES SKILL|HOUSE SKILL|INBOX SKILL/);
  });

  test("a Trick that isn't learned here never gets its skill, even if picked", () => {
    const t = text("house", ["groceries"]);
    assert.doesNotMatch(t, /HOUSE SKILL/);
    assert.match(t, /GROCERIES SKILL/, "falls back to every learned Trick");
  });

  test("core's skill appears once", () => {
    assert.equal(text(undefined).split("CORE SKILL").length - 1, 1);
  });

  test("roomieInstructions reads the pick from the Gate's toolkit in the context", () => {
    const t = roomieInstructions({ memberName: "Maya", toolkit: "splitting" } as never, "Maya", new Date(0), "America/Chicago", { toolkits: TOOLKIT_IDS, skills });
    assert.match(t, /MONEY SKILL/);
    assert.doesNotMatch(t, /GROCERIES SKILL/);
  });
});

describe("Tricks not learned here are known, not advertised (#44)", () => {
  const off = (recentReplies: string[] = []) => toolkitPersona(["splitting", "groceries", "house"], { recentReplies }).join(" ");

  test("the line names them with what they do, says not to advertise, and how to answer when asked", () => {
    const t = off();
    assert.match(t, /Not learned here: Lease Inbox \(/);
    assert.match(t, /Don't advertise these/);
    assert.match(t, /only when the conversation clearly needs it/);
    assert.match(t, /If someone asks for one, say you haven't learned it here yet/);
    assert.doesNotMatch(t, /roomie, learn/i, "no script to type");
  });

  test("one Roomie named in its recent replies isn't brought up again unless asked", () => {
    assert.match(off(["I could take the landlord's emails if an admin teaches me Lease Inbox."]), /You mentioned Lease Inbox recently: don't bring it up again unless someone asks/);
    assert.doesNotMatch(off(["Added eggs."]), /You mentioned/);
  });

  test("everything learned: no line at all", () => {
    assert.doesNotMatch(toolkitPersona(TOOLKIT_IDS).join(" "), /Not learned here/);
  });
});
