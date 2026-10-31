// Admin-only tools need the Admin's own message to ask for them (audit H6). Pure, no DB.
// Run: npx tsx --test src/toolkits/admin-ask.test.ts
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkAdminAsk, namesTarget } from "./admin-ask";
import { adminAskGate, adminOnlyTools, callKey } from "./registry";
import { core } from "./core/manifest";
import { house } from "./house/manifest";
import { splitting } from "./splitting/manifest";
import { leaseInbox } from "./lease-inbox/manifest";
import type { AdminAsk } from "./types";

const spec = (id: string): AdminAsk => {
  const s = core.adminOnly?.[id] ?? splitting.adminOnly?.[id] ?? house.adminOnly?.[id] ?? leaseInbox.adminOnly?.[id];
  assert.ok(s, id);
  return s;
};
const ok = (id: string, input: unknown, latest: string, confirming = false) => checkAdminAsk(spec(id), input, latest, confirming).ok;

describe("which tools are admin-only (from the manifests, not a list in code)", () => {
  test("members, settings, Tricks, simplify debts, Splitwise, chore and upkeep removal", () => {
    assert.deepEqual(new Set(adminOnlyTools()), new Set([
      "approve_member", "decline_member", "promote_member", "toggle_toolkit", "set_group_settings",
      "set_simplify_debts", "splitwise_connect", "splitwise_import", "splitwise_export", "splitwise_mirror",
      "chore_remove", "upkeep_remove", "rotate_join_link", "set_join_policy", "revoke_seat",
      "set_rent", "set_variable_expense",
      "trust_sender", "release_inbox", "send_intro",
    ]));
  });
});

describe("rent and variable bills (#25)", () => {
  test("set_rent: the Admin's own words about the rent", () => {
    assert.equal(ok("set_rent", { amount: 2400, dueDay: 1 }, "roomie rent is 2400 on the 1st, I pay it"), true);
    assert.equal(ok("set_rent", { amount: 2500 }, "roomie the rent went up to 2500"), true);
    assert.equal(ok("set_rent", { amount: 2400 }, "roomie hi"), false);
    assert.equal(ok("set_rent", { amount: 2400 }, "roomie don't change the rent"), false);
  });
  test("set_variable_expense: the bill and that it varies", () => {
    assert.equal(ok("set_variable_expense", { description: "Electric", dueDay: 20 }, "roomie electric varies, due the 20th, Dev pays"), true);
    assert.equal(ok("set_variable_expense", { description: "Electric", dueDay: 20 }, "roomie the water bill varies"), false, "another bill");
  });
});

describe("the Join link's admin tools (ADR 0014)", () => {
  test("rotate: the Admin's own words ask for a new link; a hello or a question doesn't", () => {
    assert.equal(ok("rotate_join_link", {}, "roomie rotate the join link"), true);
    assert.equal(ok("rotate_join_link", {}, "roomie we need a new dashboard link, the old one leaked"), true);
    assert.equal(ok("rotate_join_link", {}, "roomie reset the link"), true);
    assert.equal(ok("rotate_join_link", {}, "roomie hi"), false);
    assert.equal(ok("rotate_join_link", {}, "roomie what's the join link?"), false);
    assert.equal(ok("rotate_join_link", {}, "roomie don't rotate the join link"), false);
    assert.equal(ok("rotate_join_link", {}, "roomie should I rotate the join link?"), false, "a question isn't the ask");
    assert.equal(ok("rotate_join_link", {}, "roomie what's the new link?"), false);
    assert.equal(ok("rotate_join_link", {}, "roomie what does reset do"), false);
    assert.equal(ok("rotate_join_link", {}, "yes rotate the join link", true), true, "the confirmation passes");
  });
  test("join policy and revoking a seat", () => {
    assert.equal(ok("set_join_policy", { policy: "approve_all" }, "roomie I want to approve every join"), true);
    assert.equal(ok("set_join_policy", { policy: "free" }, "roomie let people pick their own name"), true);
    assert.equal(ok("set_join_policy", { policy: "free" }, "roomie hi"), false);
    assert.equal(ok("revoke_seat", { name: "Sam" }, "roomie that's not Sam on the dashboard, disconnect Sam"), true);
    assert.equal(ok("revoke_seat", { name: "Sam" }, "roomie disconnect Dev"), false, "someone else");
    assert.equal(ok("revoke_seat", { name: "Sam" }, "roomie kick Sam off the dashboard"), true);
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

  test("the ask is a plain question: no phrase to type (live test #10)", () => {
    const r = checkAdminAsk(spec("promote_member"), { name: "Eve" }, "roomie hi");
    assert.deepEqual(r, { ok: false, ask: "Make Eve an admin?" });
    for (const id of adminOnlyTools()) assert.doesNotMatch(spec(id).ask, /say/i, `${id}'s ask scripts a phrase`);
  });

  test("after Roomie asked: a plain yes confirms that call (live test #10: 'roomie yes', 'roomie, yes')", () => {
    for (const yes of ["yes", "roomie yes", "roomie, yes", "Yep, do it", "ok go ahead", "yes please 👍", "sure thing", "roomie yes eve"])
      assert.equal(ok("promote_member", { name: "Eve" }, yes, true), true, yes);
    assert.equal(ok("promote_member", { name: "Eve" }, "yes promote", true), true);
    assert.equal(ok("promote_member", { name: "Eve" }, "yes", false), false, "only when Roomie just asked about this call");
    assert.equal(ok("promote_member", { name: "Eve" }, "yes promote", false), false);
    assert.equal(ok("promote_member", { name: "Eve" }, "yes but wait", true), false, "a yes with more to it isn't a plain yes");
    assert.equal(ok("promote_member", { name: "Eve" }, "no", true), false);
  });

  test("the live settings ask: 'Keep this to inr and ist' asks for INR and Asia/Kolkata, and a plain yes confirms both", () => {
    const call = { currency: "INR", timezone: "Asia/Kolkata" };
    assert.equal(ok("set_group_settings", call, "Keep this to inr and ist"), true, "IST names Asia/Kolkata");
    assert.equal(ok("set_group_settings", call, "roomie use rupees and india time"), true);
    assert.equal(ok("set_group_settings", call, "roomie use rupees"), false, "the time zone wasn't asked for");
    assert.equal(ok("set_group_settings", call, "roomie yes", true), true);
    assert.equal(ok("set_group_settings", call, "roomie, yes", true), true);
    assert.equal(ok("set_group_settings", { timezone: "Asia/Kolkata" }, "roomie we're in kolkata"), true);
    assert.equal(ok("set_group_settings", { timezone: "America/Chicago" }, "roomie keep ist"), false, "IST isn't Chicago");
  });

  test("a reply naming the opposite action never confirms: asked to approve Priya, 'yes decline Priya' doesn't", () => {
    assert.equal(ok("approve_member", { name: "Priya" }, "yes decline Priya", true), false);
    assert.equal(ok("approve_member", { name: "Priya" }, "yes approve Priya", true), true);
  });

  test("negated asks don't count: 'don't approve Priya' approves nobody (and is decline's own words)", () => {
    assert.equal(ok("approve_member", { name: "Priya" }, "roomie don't approve Priya"), false);
    assert.equal(ok("approve_member", { name: "Priya" }, "roomie do not approve priya yet"), false);
    assert.equal(ok("approve_member", { name: "Priya" }, "roomie never let priya in"), false);
    assert.equal(ok("decline_member", { name: "Priya" }, "roomie don't approve Priya"), true);
    assert.equal(ok("promote_member", { name: "Eve" }, "roomie don't promote eve"), false);
    assert.equal(ok("toggle_toolkit", { toolkit: "house", enabled: false }, "roomie don't forget house"), false);
    assert.equal(ok("chore_remove", { chore: "Dishes" }, "roomie don't remove dishes"), false);
    assert.equal(ok("splitwise_connect", {}, "roomie don't connect splitwise"), false);
    assert.equal(ok("set_group_settings", { currency: "EUR" }, "roomie don't change the currency"), false);
    assert.equal(ok("approve_member", { name: "Priya" }, "roomie, don't under any circumstances approve Priya"), false, "however far the negation is");
    for (const [id, msg] of [
      ["splitwise_connect", "roomie, not connect splitwise"],
      ["splitwise_import", "no, don't import from splitwise group Apt"],
      ["splitwise_export", "roomie, not export to Splitwise"],
      ["splitwise_mirror", "roomie nope, no mirror with splitwise"],
    ] as const)
      assert.equal(ok(id, { group: "Apt", on: true }, msg), false, msg);
  });

  test("the action and the target in the same clause, the target not negated", () => {
    assert.equal(ok("approve_member", { name: "Sam" }, "roomie approve Priya and decline Sam"), false);
    assert.equal(ok("approve_member", { name: "Sam" }, "roomie approve Priya, not Sam"), false);
    assert.equal(ok("approve_member", { name: "Priya" }, "roomie approve Priya, not Sam"), true);
    assert.equal(ok("decline_member", { name: "Sam" }, "roomie approve Priya and decline Sam"), true);
    assert.equal(ok("promote_member", { name: "Eve" }, "roomie promote Sam. Eve is cool"), false);
  });

  test("settings confirmation: yes plus one field doesn't confirm the others", () => {
    assert.equal(ok("set_group_settings", { currency: "EUR", reportHour: 9 }, "roomie switch to euros"), false, "the report hour wasn't asked for");
    assert.equal(ok("set_group_settings", { currency: "EUR", reportHour: 9 }, "yes currency", true), false);
    assert.equal(ok("set_group_settings", { currency: "EUR", reportHour: 9 }, "yes, currency and the report", true), true);
    assert.equal(ok("set_group_settings", { currency: "EUR", reportHour: 9 }, "roomie, yes change the settings", true), true);
    assert.equal(ok("set_group_settings", { currency: "EUR", reportHour: 9 }, "yes, change the settings, not the currency", true), false, "an excluded field");
    assert.equal(ok("set_group_settings", { currency: "EUR", reportHour: 9 }, "yes change the settings but don't touch the report", true), false);
  });

  test("a negation inside the action's own words: 'let Priya not in' admits nobody", () => {
    assert.equal(ok("approve_member", { name: "Priya" }, "roomie let Priya not in"), false);
    assert.equal(ok("approve_member", { name: "Priya" }, "roomie let Priya in"), true);
    assert.equal(ok("decline_member", { name: "Priya" }, "roomie do not approve priya"), true, "decline's own words still start at the negation");
  });

  test("approve / decline", () => {
    assert.equal(ok("approve_member", { name: "Priya" }, "roomie approve Priya"), true);
    assert.equal(ok("approve_member", { name: "Priya" }, "roomie let priya in"), true);
    assert.equal(ok("approve_member", { name: "Priya" }, "roomie thanks"), false);
    assert.equal(ok("decline_member", { name: "Priya" }, "roomie decline priya"), true);
  });

  test("Tricks: learn / forget / turn on with the Trick's name", () => {
    assert.equal(ok("toggle_toolkit", { toolkit: "house", enabled: true }, "roomie learn house"), true);
    assert.equal(ok("toggle_toolkit", { toolkit: "groceries", enabled: false }, "roomie forget groceries"), true);
    assert.equal(ok("toggle_toolkit", { toolkit: "house", enabled: true }, "turn on house"), true);
    assert.equal(ok("toggle_toolkit", { toolkit: "splitting", enabled: false }, "roomie learn house"), false, "a different Trick");
    assert.equal(ok("toggle_toolkit", { toolkit: "splitting", enabled: false }, "roomie hi"), false);
  });

  test("settings: every field the call changes needs its own words (the Onboarding answer sets only what it says)", () => {
    assert.equal(ok("set_group_settings", { purpose: "roommates", currency: "USD", timezone: "America/Chicago" }, "roommates, USD, Chicago"), true);
    assert.equal(ok("set_group_settings", { purpose: "roommates", currency: "USD", toolkits: ["house"] }, "roommates, USD"), false, "Tricks nobody asked for");
    assert.equal(ok("set_group_settings", { purpose: "roommates", currency: "USD" }, "roommates, USD, Chicago, hype"), true, "extra words change nothing");
    assert.equal(ok("set_group_settings", { timezone: "Europe/London" }, "we're in london"), true, "the value is enough for a time zone");
    assert.equal(ok("set_group_settings", { currency: "JPY" }, "roomie use JPY"), true);
    assert.equal(ok("set_group_settings", { chattiness: "quiet" }, "roomie be quieter please"), true);
    assert.equal(ok("set_group_settings", { toolkits: [] }, "roomie hi"), false);
    assert.equal(ok("set_group_settings", { name: "roomie", toolkits: ["house"] }, "roomie hi"), false, "'roomie' is never evidence");
    assert.equal(ok("set_group_settings", { currency: "EUR", reportHour: 9 }, "roomie how was the trip"), false, "an everyday word changes nothing");
    assert.equal(ok("set_group_settings", { reportDay: "monday", reportHour: 9 }, "roomie move the report to monday 9am"), true);
  });

  test("settings: the question names the whole change with its values; 'yes change the settings' confirms it", () => {
    const r = checkAdminAsk(spec("set_group_settings"), { purpose: "roommates", toolkits: ["house"] }, "roommates");
    assert.deepEqual(r, { ok: false, ask: "Change the group's purpose to roommates and Tricks to house?" }, "the whole change, since a yes confirms all of it");
    assert.equal(ok("set_group_settings", { purpose: "roommates", toolkits: ["house"] }, "roomie, yes change the settings", true), true);
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
    assert.equal(namesTarget("hi", ["lease-inbox"]), false);
  });
});

describe("adminAskGate (the registry wrapper)", () => {
  // The confirmations live in one map per process; each test starts with none.
  beforeEach(() => (globalThis as { __roomieAdminConfirms?: Map<string, unknown> }).__roomieAdminConfirms?.clear());
  const rc = (latest: string | undefined, role = "admin") => ({
    requestContext: { get: (k: string) => ({ latest, role, groupId: "g1", memberId: "m1" } as Record<string, unknown>)[k] },
  });

  test("an Admin who didn't ask gets the question; their confirmation then passes", () => {
    const first = adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, rc("roomie hi"), 1_000);
    assert.equal(first?.refused, "confirm");
    assert.match(first!.ask, /Make Eve an admin\?/);
    assert.equal(adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, rc("yes, promote"), 2_000), null);
    assert.notEqual(adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, rc("yes, promote"), 3_000), null, "the confirmation is used up");
  });

  test("live test #10: Roomie asks about INR and IST, 'roomie, yes' confirms it; the question shows the whole change", () => {
    const call = { currency: "INR", timezone: "Asia/Kolkata", purpose: "roommates" };
    const first = adminAskGate("set_group_settings", spec("set_group_settings"), call, rc("Keep this to inr and ist"), 1_000);
    assert.equal(first?.ask, "Change the group's currency to INR, time zone to Asia/Kolkata and purpose to roommates?");
    assert.equal(first?.fresh, true, "a new question (so a confirm poll goes out once)");
    assert.equal(adminAskGate("set_group_settings", spec("set_group_settings"), call, rc("roomie, yes"), 2_000), null);
  });

  test("a plain yes answers only the newest thing Roomie asked this Admin", () => {
    adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, rc("roomie hi"), 1_000);
    adminAskGate("approve_member", spec("approve_member"), { name: "Priya" }, rc("roomie hi"), 2_000);
    assert.notEqual(adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, rc("yes"), 3_000), null, "the newer ask was Priya's");
    assert.equal(adminAskGate("approve_member", spec("approve_member"), { name: "Priya" }, rc("yes"), 4_000), null);
  });

  test("a tapped ✅ (confirmedCall) lets exactly that call through, nothing else", () => {
    const tapped = (latest: string, confirmedCall: string) => ({
      requestContext: { get: (k: string) => ({ latest, role: "admin", groupId: "g1", memberId: "m1", confirmedCall } as Record<string, unknown>)[k] },
    });
    const eve = `promote_member:${callKey({ name: "Eve" })}`;
    assert.equal(adminAskGate("promote_member", spec("promote_member"), { name: "Eve" }, tapped("", eve), 1_000), null);
    assert.notEqual(adminAskGate("promote_member", spec("promote_member"), { name: "Sam" }, tapped("", eve), 1_000), null);
    assert.notEqual(adminAskGate("approve_member", spec("approve_member"), { name: "Eve" }, tapped("", eve), 1_000), null);
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
