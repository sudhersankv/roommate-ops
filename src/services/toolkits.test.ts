// Pure tests for the Toolkit rules: requirements with their red/green state and Roomie's one-line announcement.
// Run: npx tsx --test src/services/toolkits.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { manifestOf } from "@/toolkits/manifests";
import { announcement, checkRequirements, unmet, type RequirementFacts } from "./toolkits";

const facts = (over: Partial<RequirementFacts> = {}): RequirementFacts => ({ hasEnv: () => false, enabled: [], integrations: {}, ...over });

describe("checkRequirements", () => {
  test("a Toolkit with nothing required has no blocking requirements", () => {
    assert.deepEqual(unmet(checkRequirements(manifestOf("chores")!, facts())), []);
  });

  test("integrations: missing is red and blocking, with the hint; present is green", () => {
    const research = manifestOf("research")!;
    const missing = checkRequirements(research, facts({ integrations: { composio: { ok: false, hint: "COMPOSIO_API_KEY isn't set on the server." } } }));
    assert.deepEqual(missing, [{ label: "Needs a Composio key", ok: false, detail: "COMPOSIO_API_KEY isn't set on the server.", blocking: true }]);
    assert.equal(unmet(missing).length, 1);
    assert.equal(unmet(checkRequirements(research, facts({ integrations: { composio: { ok: true } } }))).length, 0);
  });

  test("required Toolkits must be on", () => {
    const trips = manifestOf("trips")!;
    assert.deepEqual(checkRequirements(trips, facts()), [{ label: "Needs Splitting on", ok: false, blocking: true }]);
    assert.equal(checkRequirements(trips, facts({ enabled: ["splitting"] }))[0].ok, true);
  });

  test("env requirements read the env checker", () => {
    const m = { ...manifestOf("research")!, requires: { env: ["SOME_KEY"] } };
    assert.equal(checkRequirements(m, facts({ hasEnv: (n) => n === "SOME_KEY" }))[0].ok, true);
    assert.equal(checkRequirements(m, facts())[0].label, "Needs SOME_KEY on the server");
  });

  test("worksWith extras show up but never block", () => {
    const reqs = checkRequirements(manifestOf("groceries")!, facts({ integrations: { instacart: { ok: false, hint: "The Instacart link needs COMPOSIO_API_KEY on the server." } } }));
    assert.deepEqual(reqs, [{ label: "Works with Instacart (through Composio)", ok: false, detail: "The Instacart link needs COMPOSIO_API_KEY on the server.", blocking: false }]);
    assert.deepEqual(unmet(reqs), []);
  });
});

test("announcement: one line with the first example", () => {
  assert.equal(announcement(manifestOf("groceries")!), `Groceries is on. Try: "tacos for 5 friday"`);
  assert.equal(announcement({ name: "X", gate: { criterion: "", examples: [] } }), "X is on.");
});
