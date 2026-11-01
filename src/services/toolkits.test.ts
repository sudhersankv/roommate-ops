// Pure tests for the Toolkit rules: requirements with their red/green state, post order and Roomie's one-line announcement.
// Run: npx tsx --test src/services/toolkits.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, manifestOf, MANIFESTS } from "@/toolkits/manifests";
import { announcement, announcementFor, byPostOrder, checkRequirements, learnedSay, resolveToolkitSet, setupFor, unmet, type RequirementFacts } from "./toolkits";

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
    const research = { ...manifestOf("outings")!, requires: { integrations: ["composio" as const] } };
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
    const m = { ...manifestOf("outings")!, requires: { env: ["SOME_KEY"] } };
    assert.equal(checkRequirements(m, facts({ hasEnv: (n) => n === "SOME_KEY" }))[0].ok, true);
    assert.equal(checkRequirements(m, facts())[0].label, "Needs SOME_KEY on the server");
  });

  test("worksWith extras show up but never block", () => {
    const reqs = checkRequirements(manifestOf("groceries")!, facts({ enabled: ["splitting"], integrations: { instacart: { ok: false, hint: "The Instacart link needs COMPOSIO_API_KEY on the server." } } }));
    assert.deepEqual(reqs.filter((r) => !r.blocking), [{ label: "Works with Instacart (through Composio)", ok: false, detail: "The Instacart link needs COMPOSIO_API_KEY on the server.", blocking: false }]);
    assert.deepEqual(unmet(reqs), []);
  });
});

describe("resolveToolkitSet", () => {
  test("Groceries brings Money along; the list comes back in catalog order", () => {
    assert.deepEqual(resolveToolkitSet(["groceries"], CATALOG), ["splitting", "groceries"]);
    assert.deepEqual(resolveToolkitSet(["house", "groceries", "splitting"], CATALOG), ["splitting", "groceries", "house"]);
  });

  test("coming-soon and unknown ids drop out; an empty list stays empty", () => {
    assert.deepEqual(resolveToolkitSet(["house", "trips", "nonsense"], CATALOG), ["house"]);
    assert.deepEqual(resolveToolkitSet([], CATALOG), []);
  });
});

test("byPostOrder: money, the landlord, the house, then groceries (ADR 0017), whatever the nav says; no postOrder = nav order, then last", () => {
  assert.deepEqual(byPostOrder(MANIFESTS).map((m) => m.name), ["Money", "Lease Inbox", "House", "Groceries"]);
  type Entry = { id: string; postOrder?: number; dashboard?: { nav: { label: string; href: () => string; icon: "Wallet"; order: number } } };
  const nav = (order: number): Entry["dashboard"] => ({ nav: { label: "x", href: () => "/", icon: "Wallet", order } });
  const sorted = byPostOrder<Entry>([{ id: "late" }, { id: "nav", dashboard: nav(5) }, { id: "post", postOrder: 20, dashboard: nav(1) }]);
  assert.deepEqual(sorted.map((m) => m.id), ["nav", "post", "late"]);
});

test("announcement: one line saying what Roomie can do now, no phrase to type (#44)", () => {
  assert.equal(announcement(manifestOf("groceries")!), "Learned Groceries: one shared Cart, recipes for the group, and an Instacart list.", "what it does now, no phrase to type");
  assert.equal(learnedSay({ name: "Lease Inbox", summary: "Your group's own email address for the landlord." }), "Learned Lease Inbox: your group's own email address for the landlord.");
});

describe("a Trick that needs setup (#69)", () => {
  const url = (p: string) => `https://tryroomie.me${p}`;
  test("only the Lease Inbox has setup today, pointing at its Inbox page", () => {
    assert.deepEqual(MANIFESTS.filter((m) => m.setup).map((m) => m.id), ["lease-inbox"]);
    assert.deepEqual(setupFor(manifestOf("lease-inbox")!, "g1", url), {
      say: "That needs a quick setup. Here:",
      links: [{ text: "Set up Lease Inbox", url: "https://tryroomie.me/g/g1/inbox" }],
    });
  });
  test("no setup: nothing; a manifest's own line wins; no absolute APP_URL: the line without a link", () => {
    assert.equal(setupFor(manifestOf("groceries")!, "g1", url), null);
    const m = { ...manifestOf("lease-inbox")!, setup: { path: "/settings", line: "Give it a minute on the dashboard. Here:" } };
    assert.deepEqual(setupFor(m, "g1", url), { say: "Give it a minute on the dashboard. Here:", links: [{ text: "Set up Lease Inbox", url: "https://tryroomie.me/g/g1/settings" }] });
    assert.deepEqual(setupFor(manifestOf("lease-inbox")!, "g1", () => null), { say: "That needs a quick setup on the dashboard." });
  });
  test("the dashboard switch-on post: the learned line, then the setup line with its button", () => {
    assert.deepEqual(announcementFor(manifestOf("lease-inbox")!, "g1", url), {
      text: "Learned Lease Inbox: your group's own email address for the landlord.\nThat needs a quick setup. Here:",
      buttons: [{ text: "Set up Lease Inbox", url: "https://tryroomie.me/g/g1/inbox" }],
    });
    assert.deepEqual(announcementFor(manifestOf("groceries")!, "g1", url), { text: announcement(manifestOf("groceries")!) });
  });
});
