// Pure tests for the Toolkit registry: which tools a request gets. No DB, no model.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { allTools, core, toolsFor, TOOLKITS } from "./registry";

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
    assert.ok(!("log_expense" in t) && !("log_chore" in t) && !("add_maintenance" in t));
  });

  test("'reminders' is core: core tools only", () => {
    assert.deepEqual(ids(toolsFor("reminders")), coreIds);
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
