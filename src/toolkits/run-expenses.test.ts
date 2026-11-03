// #71: the Expenses one agent run logged, keyed by the RequestContext's runId. No DB.
// Run: npx tsx --test src/toolkits/run-expenses.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestContext } from "@mastra/core/request-context";
import { loggedThisRun } from "./util";

const run = (runId?: string) => ({ requestContext: new RequestContext<unknown>(runId ? [["runId", runId]] : []) });

test("loggedThisRun: every Expense this run logged, in order; another run starts its own list", () => {
  const a = run("run-a");
  assert.deepEqual(loggedThisRun(a, "e1"), ["e1"]);
  assert.deepEqual(loggedThisRun(a, "e2"), ["e1", "e2"]);
  assert.deepEqual(loggedThisRun(a, "e2"), ["e1", "e2"], "the same Expense twice counts once");
  assert.deepEqual(loggedThisRun(run("run-b"), "e3"), ["e3"]);
  assert.deepEqual(loggedThisRun(run("run-a"), "e4"), ["e1", "e2", "e4"], "keyed by the run's id, not the context object");
});

test("loggedThisRun: no runId (Studio, scripts) never combines; an old run is forgotten after 10 minutes", () => {
  assert.deepEqual(loggedThisRun(run(), "x1"), ["x1"]);
  assert.deepEqual(loggedThisRun(run(), "x2"), ["x2"]);
  assert.deepEqual(loggedThisRun(undefined, "x3"), ["x3"]);
  const t0 = 1_000_000;
  loggedThisRun(run("old"), "o1", t0);
  assert.deepEqual(loggedThisRun(run("old"), "o2", t0 + 11 * 60_000), ["o2"]);
});
