// Admin-only tools need the Admin's own message to ask for them (audit H6). Pure, no DB.
// Run: npx tsx --test src/toolkits/admin-ask.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkAdminAsk, namesTarget } from "./admin-ask";
import { adminAskGate, adminOnlyTools, callKey } from "./registry";
import { core } from "./core/manifest";
import { chores } from "./chores/manifest";
import { splitting } from "./splitting/manifest";
import type { AdminAsk } from "./types";

const spec = (id: string): AdminAsk => {
  const s = core.adminOnly?.[id] ?? splitting.adminOnly?.[id] ?? chores.adminOnly?.[id];
  assert.ok(s, id);
  return s;
};
const ok = (id: string, input: unknown, latest: string, confirming = false) => checkAdminAsk(spec(id), input, latest, confirming).ok;

describe("which tools are admin-only (from the manifests, not a list in code)", () => {
  test("members, settings, Tricks, simplify debts, Splitwise, chore and upkeep removal", () => {
    assert.deepEqual(new Set(adminOnlyTools()), new Set([
      "approve_member", "decline_member", "promote_member", "toggle_toolkit", "set_group_settings",
      "set_simplify_debts", "splitwise_connect", "splitwise_import", "splitwise_export", "splitwise_mirror",
      "chore_remove", "upkeep_remove",
    ]));
  });
});

describe("checkAdminAsk", () => {
  test("promote: the action and the person in the Admin's own words", () => {
    assert.equal(ok("promote_member", { name: "Eve" }, "roomie promote Eve"), true);
    assert.equal(ok("promote_member", { name: "Eve Smith" }, "roomie make eve an admin too"), true, "first name, any case");
    assert.equal(ok("promote_member", { name: "Eve" }, "roomie hi"), false, "the planted-instruction case");
    assert.equal(ok("promote_member", { name: "Eve" }, "roomie promote Sam"), false, "someone else");
    assert.equal(ok("promote_member", { name: "Eve" }, "roomie what's up with eve"), false, "named, but not the action");
    assert.equal(ok("promote_member", { name: "Eve" }, "roomie promote steve"), false, "whole words only");
  });

  test("the ask names the action and how to confirm", () => {
    const r = checkAdminAsk(spec("promote_member"), { name: "Eve" }, "roomie hi");
    assert.deepEqual(r, { ok: false, ask: `Make Eve an admin? Say "roomie, yes promote Eve".` });
  });

  test("after Roomie asked: yes plus the action or the person passes, a bare yes doesn't", () => {
    assert.equal(ok("promote_member", { name: "Eve" }, "yes", true), false);
    assert.equal(ok("promote_member", { name: "Eve" }, "roomie yes eve", true), true);
    assert.equal(ok("promote_member", { name: "Eve" }, "yes promote", true), true);
    assert.equal(ok("promote_member", { name: "Eve" }, "roomie yes eve", false), false, "only when Roomie just asked");
  });

  test("approve / decline", () => {
    assert.equal(ok("approve_member", { name: "Priya" }, "roomie approve Priya"), true);
    assert.equal(ok("approve_member", { name: "Priya" }, "roomie let priya in"), true);
    assert.equal(ok("approve_member", { name: "Priya" }, "roomie thanks"), false);
    assert.equal(ok("decline_member", { name: "Priya" }, "roomie decline priya"), true);
  });

  test("Tricks: learn / forget / turn on with the Trick's name", () => {
    assert.equal(ok("toggle_toolkit", { toolkit: "chores", enabled: true }, "roomie learn chores"), true);
    assert.equal(ok("toggle_toolkit", { toolkit: "groceries", enabled: false }, "roomie forget groceries"), true);
    assert.equal(ok("toggle_toolkit", { toolkit: "chores", enabled: true }, "turn on chores"), true);
    assert.equal(ok("toggle_toolkit", { toolkit: "splitting", enabled: false }, "roomie learn chores"), false, "a different Trick");
    assert.equal(ok("toggle_toolkit", { toolkit: "splitting", enabled: false }, "roomie hi"), false);
  });

  test("settings: every field the call changes needs its own words (the Onboarding answer sets only what it says)", () => {
    assert.equal(ok("set_group_settings", { purpose: "roommates", currency: "USD", timezone: "America/Chicago" }, "roommates, USD, Chicago"), true);
    assert.equal(ok("set_group_settings", { purpose: "roommates", currency: "USD", toolkits: ["chores"] }, "roommates, USD"), false, "Tricks nobody asked for");
    assert.equal(ok("set_group_settings", { purpose: "roommates", personality: { base: "gremlin" } }, "roommates, USD"), false, "a vibe nobody asked for");
    assert.equal(ok("set_group_settings", { purpose: "roommates", personality: { base: "hype" } }, "roommates, USD, Chicago, hype"), true);
    assert.equal(ok("set_group_settings", { timezone: "Europe/London" }, "we're in london"), true, "the value is enough for a time zone");
    assert.equal(ok("set_group_settings", { currency: "JPY" }, "roomie use JPY"), true);
    assert.equal(ok("set_group_settings", { chattiness: "quiet" }, "roomie be quieter please"), true);
    assert.equal(ok("set_group_settings", { personality: { name: "Dino" } }, "roomie we'll call you Dino"), true);
    assert.equal(ok("set_group_settings", { toolkits: [] }, "roomie hi"), false);
    assert.equal(ok("set_group_settings", { personality: { name: "roomie" }, toolkits: ["chores"] }, "roomie hi"), false, "'roomie' is never evidence");
    assert.equal(ok("set_group_settings", { currency: "EUR", reportHour: 9 }, "roomie how was the trip"), false, "an everyday word changes nothing");
    assert.equal(ok("set_group_settings", { reportDay: "monday", reportHour: 9 }, "roomie move the report to monday 9am"), true);
  });

  test("settings: the question names what nobody asked for; 'yes change the settings' confirms it", () => {
    const r = checkAdminAsk(spec("set_group_settings"), { purpose: "roommates", toolkits: ["chores"] }, "roommates");
    assert.deepEqual(r, { ok: false, ask: `Change the group's settings (toolkits)? Say "roomie, yes change the settings".` });
    assert.equal(ok("set_group_settings", { purpose: "roommates", toolkits: ["chores"] }, "roomie, yes change the settings", true), true);
  });

  test("Splitwise: each operation needs its own verb; a status question authorizes none of them", () => {
    for (const id of ["splitwise_connect", "splitwise_import", "splitwise_export", "splitwise_mirror"]) {
      assert.equal(ok(id, { group: "Apt", on: true }, "roomie is splitwise connected?"), false, id);
      assert.equal(ok(id, { group: "Apt", on: true }, "roomie what's going on with splitwise"), false, id);
    }
    assert.equal(ok("splitwise_connect", {}, "roomie connect my splitwise"), true);
    assert.equal(ok("splitwise_import", { group: "Apt" }, "roomie import our splitwise group Apt"), true);
    assert.equal(ok("splitwise_import", { group: "Apt" }, "roomie import from splitwise"), false, "which group: Roomie asks");
    assert.equal(ok("splitwise_export", {}, "roomie copy everything to splitwise"), true);
    assert.equal(ok("splitwise_mirror", { on: true }, "roomie keep splitwise in sync"), true);
    assert.equal(ok("splitwise_mirror", { on: true }, "roomie export to splitwise"), false, "export isn't mirror");
    assert.equal(ok("splitwise_mirror", { on: true }, "roomie hi"), false);
    assert.equal(ok("set_simplify_debts", { on: false }, "roomie stop simplifying debts"), true);
    assert.equal(ok("chore_remove", { chore: "Dishes" }, "roomie take dishes off the chart"), true);
    assert.equal(ok("chore_remove", { chore: "Dishes" }, "roomie remove trash"), false);
  });

  test("namesTarget splits values into words", () => {
    assert.equal(namesTarget("we're in chicago", ["America/Chicago"]), true);
    assert.equal(namesTarget("hi", ["household-admin"]), false);
  });
});

describe("adminAskGate (the registry wrapper)", () => {
  const rc = (latest: string | undefined, role = "admin") => ({
    requestContext: { get: (k: string) => ({ latest, role, groupId: "g1", memberId: "m1" } as Record<string, unknown>)[k] },
  });

  test("an Admin who didn't ask gets the question; their confirmation then passes", () => {
    const first = adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, rc("roomie hi"), 1_000);
    assert.equal(first?.refused, "confirm");
    assert.match(first!.ask, /Make Eve an admin\?/);
    assert.equal(adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, rc("yes eve"), 2_000), null);
    assert.notEqual(adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, rc("yes eve"), 3_000), null, "the confirmation is used up");
  });

  test("a confirmation expires after 10 minutes", () => {
    adminAskGate("approve_member", spec("approve_member"), { name: "Priya" }, rc("roomie hi"), 0);
    assert.notEqual(adminAskGate("approve_member", spec("approve_member"), { name: "Priya" }, rc("yes priya"), 11 * 60_000), null);
  });

  test("non-Admins go to the service (which refuses them); no `latest` (Studio) is refused unless ROOMIE_ADMIN_ASK_OFF=1", () => {
    assert.equal(adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, rc("roomie hi", "member")), null);
    assert.equal(adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, rc(undefined))?.refused, "confirm");
    process.env.ROOMIE_ADMIN_ASK_OFF = "1";
    try {
      assert.equal(adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, rc(undefined)), null);
      const env = process.env as Record<string, string | undefined>;
      const was = env.NODE_ENV;
      env.NODE_ENV = "production";
      assert.notEqual(adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, rc(undefined)), null, "never in production");
      env.NODE_ENV = was;
    } finally {
      delete process.env.ROOMIE_ADMIN_ASK_OFF;
    }
  });

  test("a confirmation is for that call only: asked about Eve, a 'yes promote' can't promote Sam", () => {
    const ctx = rc("roomie hi");
    adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, ctx, 0);
    assert.notEqual(adminAskGate("promote_member", spec("promote_member"), { name: "Sam" }, rc("yes promote"), 1_000), null);
    adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, ctx, 2_000);
    assert.equal(adminAskGate("promote_member", spec("promote_member"), { name: "eve" }, rc("yes promote"), 3_000), null, "the same call, spelled differently");
  });

  test("callKey ignores case, key order and unset fields", () => {
    assert.equal(callKey({ b: "Eve", a: undefined, c: [1, "X"] }), callKey({ c: [1, "x"], b: "eve" }));
    assert.notEqual(callKey({ name: "Eve" }), callKey({ name: "Sam" }));
  });
});
