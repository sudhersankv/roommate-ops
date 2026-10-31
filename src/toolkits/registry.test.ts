// Pure tests for the Toolkit registry and the manifest contract: which tools a request gets, and that every
// manifest is complete. No DB, no model.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { roomieInstructions } from "@/mastra/agents/instructions";
import { adminOnlyTools, allTools, core, groupDecisionRefusal, skillsById, toolsFor, TOOLKITS } from "./registry";
import { CATALOG, COMING_SOON, findManifest, MANIFESTS, TOOLKIT_IDS } from "./manifests";
import { PRESETS, presetFor } from "./presets";
import { TOOLKIT_CATEGORIES } from "./types";

const ids = (tools: Record<string, unknown>) => Object.keys(tools).sort();
const coreIds = ids(core.tools);

describe("toolsFor", () => {
  test("no toolkit or 'none' gives core + every enabled Toolkit", () => {
    assert.deepEqual(ids(toolsFor()), ids(allTools()));
    assert.deepEqual(ids(toolsFor("none")), ids(allTools()));
  });

  test("a Gate toolkit narrows to core + that Toolkit", () => {
    const t = toolsFor("groceries");
    assert.ok(coreIds.every((id) => id in t), "core is always on");
    assert.ok("cart_add" in t);
    assert.ok(!("log_expense" in t) && !("log_chore" in t) && !("upkeep_add" in t));
  });

  test("'core' (reminders, members, settings): core tools only", () => {
    assert.deepEqual(ids(toolsFor("core")), coreIds);
    assert.ok("list_toolkits" in core.tools && "toggle_toolkit" in core.tools);
  });

  test("disabled Toolkits are never returned, even when the Gate picks them", () => {
    assert.deepEqual(ids(toolsFor("splitting", ["groceries"])), coreIds);
    const t = toolsFor(undefined, ["groceries"]);
    assert.ok("cart_add" in t && !("log_expense" in t));
  });

  test("tool keys equal tool ids and are unique across Toolkits", () => {
    const seen = new Set<string>();
    for (const tk of [core, ...TOOLKITS]) {
      for (const [key, tool] of Object.entries(tk.tools)) {
        assert.equal(tool.id, key);
        assert.ok(!seen.has(key), `duplicate tool id ${key}`);
        seen.add(key);
      }
    }
  });
});

describe("the manifest contract", () => {
  test("registry and manifests list the same Toolkits, in order; coming-soon ones have no server entry", () => {
    assert.deepEqual(TOOLKITS.map((t) => t.id), [...TOOLKIT_IDS]);
    assert.deepEqual(MANIFESTS.map((m) => m.id), [...TOOLKIT_IDS]);
    for (const m of COMING_SOON) {
      assert.equal(m.status, "coming-soon");
      assert.ok(!TOOLKITS.some((t) => (t.id as string) === m.id), `${m.id} is a stub`);
    }
    assert.deepEqual(COMING_SOON.map((m) => m.id), ["outings", "cooking", "trips", "stickers", "guests", "move-out"]);
  });

  test("Lease Inbox (#27): built, off by default, its own tab and page, the email service required, offered at setup", () => {
    const lease = TOOLKITS.find((t) => t.id === "lease-inbox")!;
    assert.equal(lease.status, "stable");
    assert.equal(lease.defaultOn, false);
    assert.deepEqual(lease.requires, { integrations: ["agentmail"] });
    assert.deepEqual([lease.dashboard?.nav?.label, lease.dashboard?.nav?.href("g1"), lease.dashboard?.nav?.order], ["Inbox", "/g/g1/inbox", 35]);
    assert.deepEqual(lease.dashboard?.pages, ["inbox"]);
    assert.equal(lease.postOrder, 20);
    for (const id of ["report_issue", "send_to_landlord", "work_order_status", "trust_sender", "send_intro", "ask_lease", "notice_status", "inbox_status", "release_inbox"]) assert.ok(id in lease.tools, id);
    assert.deepEqual(Object.keys(lease.adminOnly ?? {}).sort(), ["release_inbox", "send_intro", "trust_sender"]);
    assert.ok(lease.bundle && lease.report && lease.onEnable && lease.dashboard?.settings, "it speaks in the Bundle and the report, sets itself up, and has a Settings section");
  });

  test("every catalog entry is complete", () => {
    const seen = new Set<string>();
    for (const m of CATALOG) {
      assert.ok(!seen.has(m.id), `duplicate id ${m.id}`);
      seen.add(m.id);
      for (const k of ["name", "description", "summary", "longDescription", "icon"] as const) assert.ok(m[k].trim(), `${m.id}.${k}`);
      assert.ok(TOOLKIT_CATEGORIES.includes(m.category), `${m.id}.category`);
      assert.ok(m.gate.criterion.trim() && m.gate.examples.length > 0, `${m.id}.gate`);
      assert.ok(m.summary.length <= 80, `${m.id}.summary is one line`);
      for (const id of m.requires?.toolkits ?? []) assert.ok(CATALOG.some((x) => x.id === id), `${m.id} requires unknown ${id}`);
    }
  });

  test("abilities only name the Toolkit's own tools", () => {
    for (const t of TOOLKITS) for (const id of Object.keys(t.abilities ?? {})) assert.ok(id in t.tools, `${t.id}.abilities.${id} isn't one of its tools`);
  });

  test("group decisions (#42): only a Toolkit's own non-admin tools; admin changes, reads and unknown tools are refused", () => {
    const admin = new Set(adminOnlyTools());
    for (const t of [core, ...TOOLKITS])
      for (const id of t.groupDecisions ?? []) {
        assert.ok(id in t.tools, `${t.id}.groupDecisions.${id} isn't one of its tools`);
        assert.ok(!admin.has(id), `${id} is admin-only`);
      }
    assert.equal(groupDecisionRefusal("chore_add", { name: "Trash run", everyDays: 3, rotation: ["Sreyas", "Maya", "Dev"] }), null);
    assert.equal(groupDecisionRefusal("log_expense", { amount: 60, description: "internet", category: "utilities" }), null);
    assert.match(groupDecisionRefusal("chore_remove", { chore: "Trash run" }) ?? "", /admin/, "an admin tool can't be pinned");
    assert.match(groupDecisionRefusal("set_rent", { amount: 2400 }) ?? "", /admin/);
    assert.ok(groupDecisionRefusal("get_balances", {}), "a read isn't a decision");
    assert.ok(groupDecisionRefusal("cart_add", { items: ["eggs"] }), "routine adds aren't polled");
    assert.ok(groupDecisionRefusal("no_such_tool", {}));
    assert.match(groupDecisionRefusal("chore_add", { everyDays: 3 }) ?? "", /isn't complete/, "an input the tool would reject");
  });

  test("House is one Trick: both halves' tools, one nav tab, one page", () => {
    const house = TOOLKITS.find((t) => t.id === "house")!;
    for (const id of ["log_chore", "chore_add", "chore_status", "chore_skip", "hall_of_shame", "upkeep_add", "upkeep_done", "upkeep_status", "upkeep_remove"]) assert.ok(id in house.tools, id);
    assert.equal(house.dashboard?.nav?.label, "House");
    assert.equal(house.dashboard?.nav?.href("g1"), "/g/g1/house");
    assert.deepEqual(house.dashboard?.pages, ["house"]);
    assert.ok(house.bundle && house.report && house.onEnable, "it speaks in the Bundle and the report, and sets itself up");
  });

  test("nav entries and owned pages", () => {
    for (const t of TOOLKITS) {
      const nav = t.dashboard?.nav;
      if (nav) assert.match(nav.href("g1"), /^\/g\/g1\/[a-z-]+/, `${t.id} nav href`);
      for (const p of t.dashboard?.pages ?? []) assert.match(p, /^[a-z-]+$/, `${t.id} page ${p}`);
    }
  });

  test("findManifest knows names, ids, nav labels, tags and near misses", () => {
    assert.equal(findManifest("Groceries")?.id, "groceries");
    assert.equal(findManifest("grocery")?.id, "groceries");
    assert.equal(findManifest("House")?.id, "house");
    assert.equal(findManifest("the house trick")?.id, "house");
    // The words people still say for House's two halves find it.
    assert.equal(findManifest("the chores toolkit")?.id, "house");
    assert.equal(findManifest("upkeep")?.id, "house");
    // Money answers to its id, its name and the words for what it does.
    for (const word of ["splitting", "split", "Money", "money", "expenses"]) assert.equal(findManifest(word)?.id, "splitting", word);
    assert.equal(findManifest("lease inbox")?.id, "lease-inbox");
    assert.equal(findManifest("the landlord")?.id, "lease-inbox");
    assert.equal(findManifest("move out")?.id, "move-out");
    assert.equal(findManifest("outings")?.id, "outings");
    assert.equal(findManifest("cooking")?.id, "cooking");
    assert.equal(findManifest("spaceships"), undefined);
  });

  test("presets only use real Toolkits; no answer = every defaultOn one", () => {
    for (const list of Object.values(PRESETS)) for (const id of list) assert.ok(TOOLKIT_IDS.includes(id));
    assert.deepEqual(presetFor(null), MANIFESTS.filter((m) => m.defaultOn).map((m) => m.id));
  });

  test("skills are in the instructions only while their Trick is on", () => {
    const ctx = { memberName: "Maya" };
    const skills = skillsById();
    const all = roomieInstructions(ctx, "Maya", new Date(0), "America/Chicago", { toolkits: TOOLKIT_IDS, skills });
    const groceriesOnly = roomieInstructions(ctx, "Maya", new Date(0), "America/Chicago", { toolkits: ["groceries"], skills });
    const splitting = skills.splitting;
    const groceries = skills.groceries;
    assert.ok(all.includes(splitting) && all.includes(groceries));
    assert.ok(groceriesOnly.includes(groceries) && !groceriesOnly.includes(splitting));
    assert.match(groceriesOnly, /Not learned here: Money \([^)]*\); House \(/);
    assert.match(groceriesOnly, /TRICKS\n- Tricks you know here: Groceries/);
    assert.ok(!all.includes("{TOOLKITS}"));
  });
});
