// The Tricks stay decoupled (ADR 0011, ADR 0015 decision 5): no Toolkit id is written as a literal outside the places
// that are allowed to know it. A new leak is a conscious edit to ALLOWED below. Walks src/ with node:fs, no DB.
// Run: npx tsx --test src/toolkits/coupling.test.ts
//
// The heuristic: "splitting" and "house" are unambiguous, so any quoted literal counts. "chores" is also a table
// name (schema, Activity refs) and a House tab, "upkeep" a House tab and tag, "groceries" an Expense category, so for
// those only the shapes a Toolkit id takes count: `toolkit: "x"`, `toolkits: [... "x" ...]`, `includes("x")`,
// `on("x")`, `isEnabled(..., "x")`, `setToolkit(..., { toolkit: "x" })`, `enabledToolkits ... "x"`,
// `manifestOf("x")`, `toolkitById("x")`, `findManifest("x")`, `TOOLKITS.find(... "x")` and
// `eq(groupToolkits.toolkit, "x")`. A manifest's `requires` is the one sanctioned way to name another Toolkit, so
// that block is skipped. Comments and docs aren't checked: this is about code.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { TOOLKIT_IDS } from "./manifests";

const SRC = join(process.cwd(), "src");

/** Where a Toolkit id may appear, as path prefixes under src/ (posix slashes). */
const ALLOWED = [
  "toolkits/manifests.ts",
  "toolkits/presets.ts",
  "toolkits/registry.ts",
  "toolkits/coming-soon.ts",
  "app/_landing/demos.ts",
  "app/_landing/tricks.ts",
  "db/enums.ts",
  // A Trick's own services keep its settings on its group_toolkits row (the Pantry; the nudge hour on House's row).
  "services/pantry.ts",
  "services/schedule.ts",
];
const isTest = (p: string) => /\.(test|dbtest)\.tsx?$/.test(p) || p.startsWith("mastra/evals/");
const ownFolder = (p: string, id: string) => p.startsWith(`toolkits/${id}/`);

/** Toolkit ids today, plus the two that merged into House: they must not come back as ids either. */
const IDS = [...TOOLKIT_IDS, "chores", "upkeep"] as const;
/** Ids that are also something else in code (a table, a tab, an Expense category): only id-shaped uses count. */
const AMBIGUOUS = new Set(["chores", "upkeep", "groceries"]);

const idShapes = (id: string): RegExp[] => {
  const q = `(?:"|')${id}(?:"|')`;
  return [
    new RegExp(`\\btoolkit:\\s*${q}`),
    new RegExp(`\\btoolkits:\\s*\\[[^\\]]*${q}`),
    new RegExp(`\\.includes\\(${q}\\)`),
    new RegExp(`\\bon\\(${q}\\)`),
    new RegExp(`\\b(?:isEnabled|manifestOf|toolkitById|findManifest|settingsOf|mergeSettings)\\([^)]*${q}`),
    new RegExp(`\\b(?:setToolkit|enabledToolkits|toolkitStates|TOOLKITS\\.find|MANIFESTS\\.find)\\b[^;\\n]*${q}`),
    new RegExp(`groupToolkits\\.toolkit,\\s*${q}`),
  ];
};
const anyLiteral = (id: string) => new RegExp(`(?:"|')${id}(?:"|')`);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(name)) yield full;
  }
}

/**
 * Code only: line comments and block comments stripped (strings are kept; a Trick's name in copy isn't an id), and a
 * manifest's `requires: { ... }` block, the declared dependency, skipped.
 */
const codeOf = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/\brequires:\s*\{[^}]*\}/g, "requires: {}");

describe("Toolkit ids stay in their own folder, the manifests, presets, registry, coming-soon, the landing's Trick files and tests", () => {
  const files = [...walk(SRC)].map((f) => ({ path: relative(SRC, f).split(sep).join("/"), text: codeOf(readFileSync(f, "utf8")) }));

  test("the walk sees the source tree", () => {
    assert.ok(files.length > 100, `only ${files.length} files`);
    assert.ok(files.some((f) => f.path === "jobs/scheduler.ts"));
  });

  for (const id of IDS) {
    test(`"${id}" appears nowhere it shouldn't`, () => {
      const leaks: string[] = [];
      for (const f of files) {
        if (isTest(f.path) || ownFolder(f.path, id) || ALLOWED.some((a) => f.path === a || f.path.startsWith(`${a}/`))) continue;
        const hit = AMBIGUOUS.has(id) ? idShapes(id).find((re) => re.test(f.text)) : anyLiteral(id).test(f.text) ? anyLiteral(id) : undefined;
        if (hit) leaks.push(`${f.path} (${hit.source})`);
      }
      assert.deepEqual(leaks, [], `"${id}" leaked into: ${leaks.join(", ")}`);
    });
  }

  test("the heuristic catches the shapes it says it does", () => {
    const shapes = idShapes("groceries");
    for (const sample of [`toolkit: "groceries"`, `toolkits: ["splitting", "groceries"]`, `on.includes("groceries")`, `on("groceries")`, `isEnabled(groupId, "groceries")`, `setToolkit(ctx, { toolkit: "groceries", enabled: true })`, `eq(groupToolkits.toolkit, "groceries")`]) {
      assert.ok(shapes.some((re) => re.test(sample)), sample);
    }
    for (const sample of [`category: "groceries"`, `refTable: "chores"`, `pgTable("chores", {`, `kind: "chores.nudge"`]) {
      assert.ok(!idShapes("groceries").some((re) => re.test(sample)) && !idShapes("chores").some((re) => re.test(sample)), `${sample} is not an id`);
    }
  });
});
