// Pure tests for the Toolkit rules: requirements with their red/green state, post order and Roomie's one-line announcement.
// Run: npx tsx --test src/services/toolkits.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { manifestOf, MANIFESTS } from "@/toolkits/manifests";
import { announcement, byPostOrder, checkRequirements, unmet, type RequirementFacts } from "./toolkits";

const facts = (over: Partial<RequirementFacts> = {}): RequirementFacts => ({ hasEnv: () => false, enabled: [], integrations: {}, ...over });

describe("checkRequirements", () => {
  test("a Toolkit with nothing required has no blocking requirements", () => {
    assert.deepEqual(unmet(checkRequirements(manifestOf("house")!, facts())), []);
  });

  test("Groceries needs Money: red with Money off, green with it on, and the line names Money", () => {
    const groceries = manifestOf("groceries")!;
    const off = checkRequirements(groceries, facts());
    assert.deepEqual(unmet(off), [{ label: "Needs Money first", ok: false, blocking: true }]);
    assert.deepEqual(unmet(checkRequirements(groceries, facts({ enabled: ["splitting"] }))), []);
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
    assert.deepEqual(checkRequirements(trips, facts()), [{ label: "Needs Money first", ok: false, blocking: true }]);
    assert.equal(checkRequirements(trips, facts({ enabled: ["splitting"] }))[0].ok, true);
  });

  test("env requirements read the env checker", () => {
    const m = { ...manifestOf("research")!, requires: { env: ["SOME_KEY"] } };
    assert.equal(checkRequirements(m, facts({ hasEnv: (n) => n === "SOME_KEY" }))[0].ok, true);
    assert.equal(checkRequirements(m, facts())[0].label, "Needs SOME_KEY on the server");
  });

  test("worksWith extras show up but never block", () => {
    const reqs = checkRequirements(manifestOf("groceries")!, facts({ enabled: ["splitting"], integrations: { instacart: { ok: false, hint: "The Instacart link needs COMPOSIO_API_KEY on the server." } } }));
    assert.deepEqual(reqs.filter((r) => !r.blocking), [{ label: "Works with Instacart (through Composio)", ok: false, detail: "The Instacart link needs COMPOSIO_API_KEY on the server.", blocking: false }]);
    assert.deepEqual(unmet(reqs), []);
  });
});

test("byPostOrder: money, then the house, then groceries (ADR 0017), whatever the nav says; no postOrder = nav order, then last", () => {
  assert.deepEqual(byPostOrder(MANIFESTS).map((m) => m.name), ["Money", "House", "Groceries"]);
  type Entry = { id: string; postOrder?: number; dashboard?: { nav: { label: string; href: () => string; icon: "Wallet"; order: number } } };
  const nav = (order: number): Entry["dashboard"] => ({ nav: { label: "x", href: () => "/", icon: "Wallet", order } });
  const sorted = byPostOrder<Entry>([{ id: "late" }, { id: "nav", dashboard: nav(5) }, { id: "post", postOrder: 20, dashboard: nav(1) }]);
  assert.deepEqual(sorted.map((m) => m.id), ["nav", "post", "late"]);
});

test("announcement: one line with the first example, in Tricks words", () => {
  assert.equal(announcement(manifestOf("groceries")!), `Learned Groceries. Try: "roomie, tacos for 5 friday"`);
  assert.equal(announcement({ name: "X", gate: { criterion: "", examples: [] } }), "Learned X.");
});
