// Pure tests for the Toolkit registry and the manifest contract: which tools a request gets, and that every
// manifest is complete. No DB, no model.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { roomieInstructions } from "@/mastra/agents/instructions";
import { allTools, core, toolsFor, TOOLKITS } from "./registry";
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
    assert.deepEqual(COMING_SOON.map((m) => m.id), ["research", "pdf", "trips", "stickers", "household-admin"]);
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

  test("nav entries and owned pages", () => {
    for (const t of TOOLKITS) {
      const nav = t.dashboard?.nav;
      if (nav) assert.match(nav.href("g1"), /^\/g\/g1\/[a-z-]+/, `${t.id} nav href`);
      for (const p of t.dashboard?.pages ?? []) assert.match(p, /^[a-z-]+$/, `${t.id} page ${p}`);
    }
  });

  test("findManifest knows names, ids, nav labels and near misses", () => {
    assert.equal(findManifest("Groceries")?.id, "groceries");
    assert.equal(findManifest("grocery")?.id, "groceries");
    assert.equal(findManifest("the chores toolkit")?.id, "chores");
    assert.equal(findManifest("money")?.id, "splitting");
    assert.equal(findManifest("pdfs")?.id, "pdf");
    assert.equal(findManifest("household admin")?.id, "household-admin");
    assert.equal(findManifest("spaceships"), undefined);
  });

  test("presets only use real Toolkits; no answer = every defaultOn one", () => {
    for (const list of Object.values(PRESETS)) for (const id of list) assert.ok(TOOLKIT_IDS.includes(id));
    assert.deepEqual(presetFor(null), MANIFESTS.filter((m) => m.defaultOn).map((m) => m.id));
  });

  test("persona fragments are in the instructions only while their Toolkit is on", () => {
    const ctx = { memberName: "Maya" };
    const all = roomieInstructions(ctx, "Maya", new Date(0), "America/Chicago", { toolkits: TOOLKIT_IDS });
    const groceriesOnly = roomieInstructions(ctx, "Maya", new Date(0), "America/Chicago", { toolkits: ["groceries"] });
    const splitting = MANIFESTS.find((m) => m.id === "splitting")!.persona!;
    const groceries = MANIFESTS.find((m) => m.id === "groceries")!.persona!;
    assert.ok(all.includes(splitting) && all.includes(groceries));
    assert.ok(groceriesOnly.includes(groceries) && !groceriesOnly.includes(splitting));
    assert.match(groceriesOnly, /Off here: Splitting, Chores, Upkeep/);
    assert.ok(!all.includes("{TOOLKITS}"));
  });
});
