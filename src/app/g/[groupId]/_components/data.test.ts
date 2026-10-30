// The shell is built from the manifests (ADR 0011): the dock's tabs and the More drawer for a Group's learned Tricks.
// Pure (shellView takes the on/off map), no DB. Run: npx tsx --test "src/app/g/[groupId]/_components/data.test.ts"
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "@/toolkits/presets";
import { NAV_TABS, shellView } from "./data";

const onFor = (ids: readonly string[]) => Object.fromEntries(["splitting", "groceries", "house"].map((id) => [id, ids.includes(id)]));

describe("shellView", () => {
  test("roommates: the dock is Money, Cart, House; the drawer lists the same three and nothing is left to teach", () => {
    const v = shellView("g1", onFor(PRESETS.roommates));
    assert.deepEqual(v.nav.map((n) => [n.label, n.href]), [["Money", "/g/g1/money"], ["Cart", "/g/g1/cart"], ["House", "/g/g1/house"]]);
    assert.ok(v.nav.length <= NAV_TABS);
    assert.deepEqual(v.drawer.learned.map((n) => n.label), ["Money", "Cart", "House"]);
    assert.deepEqual(v.drawer.notYet, []);
    assert.ok(v.drawer.soon.some((s) => s.name === "Lease Inbox"));
    // Reminders aren't a Trick's: the drawer's Group section has them (dock.tsx), so no manifest owns a reminders page.
    assert.ok(!v.ownedPages.some((p) => p.prefix === "reminders"));
  });

  test("a trip: Money and Cart in the dock; House is a greyed slot; the house page shows the off state", () => {
    const v = shellView("g1", onFor(PRESETS.trip));
    assert.deepEqual(v.nav.map((n) => n.label), ["Money", "Cart"]);
    assert.deepEqual(v.drawer.notYet.map((t) => t.name), ["House"]);
    const house = v.ownedPages.find((p) => p.prefix === "house")!;
    assert.deepEqual(house.owners.map((o) => [o.name, o.enabled]), [["House", false]]);
    assert.ok(!v.ownedPages.some((p) => p.prefix === "chores"), "the old page prefix is gone");
  });

  test("nothing learned: Home and More only; every Trick is a slot to teach", () => {
    const v = shellView("g1", onFor([]));
    assert.deepEqual(v.nav, []);
    assert.deepEqual(v.drawer.notYet.map((t) => t.name), ["Money", "Groceries", "House"]);
  });
});
