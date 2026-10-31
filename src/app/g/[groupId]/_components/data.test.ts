// The shell is built from the manifests (ADR 0011): the dock's tabs and the More drawer for a Group's learned Tricks.
// Pure (shellView takes the on/off map, and stub manifests where a Trick doesn't exist yet), no DB.
// Run: npx tsx --test "src/app/g/[groupId]/_components/data.test.ts"
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { COMING_SOON, MANIFESTS } from "@/toolkits/manifests";
import { PRESETS } from "@/toolkits/presets";
import type { ToolkitManifest } from "@/toolkits/types";
import type { GroupSession } from "@/lib/session";
import type { Expense } from "@/services/money";
import { addDaysToDay } from "@/lib/time";
import { restockCandidates } from "@/services/restock-math";
import { NAV_TABS, expenseView, groupTricks, probablyLowRows, shellView, todayRows } from "./data";

const onFor = (ids: readonly string[]) => Object.fromEntries(MANIFESTS.map((m) => [m.id, ids.includes(m.id)]));

/** The nav orders the issue (#28) gives: Money 10, House 30, Inbox 35, Cart 40. */
const ISSUE_ORDER: Record<string, number> = { splitting: 10, house: 30, groceries: 40 };
const withIssueOrder = (list: readonly ToolkitManifest[]) =>
  list.map((m) => (m.dashboard?.nav && ISSUE_ORDER[m.id] ? { ...m, dashboard: { ...m.dashboard, nav: { ...m.dashboard.nav, order: ISSUE_ORDER[m.id] } } } : m));

/** Lease Inbox as #27 will build it: a stub of the coming-soon manifest with a nav tab at 35. */
const leaseStub = (): ToolkitManifest => {
  const soon = COMING_SOON.find((m) => m.id === "lease-inbox")!;
  return { ...soon, status: "stable", dashboard: { nav: { label: "Inbox", href: (g) => `/g/${g}/inbox`, icon: "Inbox", order: 35 }, pages: ["inbox"] } };
};

const navOrder = (id: string) => MANIFESTS.find((m) => m.id === id)?.dashboard?.nav?.order ?? 0;

describe("shellView", () => {
  test("the dock holds two Tricks, so Ask Roomie has two a side (Home · 2 · Ask · 2 · More)", () => {
    assert.equal(NAV_TABS, 2);
  });

  test("roommates, at the issue's nav orders: Money and House in the dock; Cart is a learned tile in the drawer", () => {
    const v = shellView("g1", onFor(PRESETS.roommates), withIssueOrder(MANIFESTS));
    assert.deepEqual(v.nav.map((n) => [n.label, n.href]), [["Money", "/g/g1/money"], ["House", "/g/g1/house"]]);
    assert.deepEqual(v.drawer.learned.map((n) => n.label), ["Cart"]);
    assert.deepEqual(v.drawer.notYet, []);
    assert.ok(v.drawer.soon.some((s) => s.name === "Lease Inbox"));
    // Reminders aren't a Trick's: the drawer's Group section has them (dock.tsx), so no manifest owns a reminders page.
    assert.ok(!v.ownedPages.some((p) => p.prefix === "reminders"));
  });

  test(
    "roommates, with today's manifests: Money and House in the dock, Cart in the drawer",
    { skip: navOrder("groceries") < navOrder("house") ? "groceries' nav.order is still below House's (20 < 30); #28 wants Cart at 40 (src/toolkits/groceries/manifest.ts)" : false },
    () => {
      const v = shellView("g1", onFor(PRESETS.roommates));
      assert.deepEqual(v.nav.map((n) => n.label), ["Money", "House"]);
      assert.deepEqual(v.drawer.learned.map((n) => n.label), ["Cart"]);
    }
  );

  test("Lease Inbox on, House off: Inbox takes House's slot; Cart stays in the drawer; House is a slot to teach", () => {
    const lease = leaseStub();
    const manifests = [...withIssueOrder(MANIFESTS), lease];
    const v = shellView("g1", { ...onFor(["splitting", "groceries"]), [lease.id]: true }, manifests, COMING_SOON.filter((m) => m.id !== lease.id));
    assert.deepEqual(v.nav.map((n) => [n.label, n.href]), [["Money", "/g/g1/money"], ["Inbox", "/g/g1/inbox"]]);
    assert.deepEqual(v.drawer.learned.map((n) => n.label), ["Cart"]);
    assert.deepEqual(v.drawer.notYet.map((t) => t.name), ["House"]);
    assert.ok(!v.drawer.soon.some((s) => s.name === "Lease Inbox"), "a built Trick isn't Soon");
  });

  test("Lease Inbox and House both on: House (30) keeps its slot, Inbox (35) goes to the drawer before Cart", () => {
    const lease = leaseStub();
    const v = shellView("g1", { ...onFor(PRESETS.roommates), [lease.id]: true }, [...withIssueOrder(MANIFESTS), lease]);
    assert.deepEqual(v.nav.map((n) => n.label), ["Money", "House"]);
    assert.deepEqual(v.drawer.learned.map((n) => n.label), ["Inbox", "Cart"]);
  });

  test("a trip: Money and Cart in the dock; House is a greyed slot; the house page shows the off state", () => {
    const v = shellView("g1", onFor(PRESETS.trip));
    assert.deepEqual(v.nav.map((n) => n.label), ["Money", "Cart"]);
    assert.deepEqual(v.drawer.learned, []);
    assert.deepEqual(v.drawer.notYet.map((t) => t.name), ["House"]);
    const house = v.ownedPages.find((p) => p.prefix === "house")!;
    assert.deepEqual(house.owners.map((o) => [o.name, o.enabled]), [["House", false]]);
    assert.ok(!v.ownedPages.some((p) => p.prefix === "chores"), "the old page prefix is gone");
  });

  test("nothing learned: Home · Ask · More only; every Trick is a slot to teach, the Soon ones stay one tile's worth", () => {
    const v = shellView("g1", onFor([]));
    assert.deepEqual(v.nav, []);
    assert.deepEqual(v.drawer.learned, []);
    assert.deepEqual(v.drawer.notYet.map((t) => t.name), ["Money", "Groceries", "House"]);
    assert.equal(v.drawer.soon.length, COMING_SOON.length);
  });
});

test("expenseView: a receipt shows only for a Document's link (made local); an old /uploads path shows none", () => {
  const id = "0b7e4a52-3c1d-4f6a-9e2b-5d8c7a1f0e93";
  const s = { member: { id: "dev", role: "member" }, group: { timezone: "America/Chicago" } } as unknown as GroupSession;
  const e = (receiptUrl: string | null): Expense => ({ id: "e1", payerName: "Dev", cents: 6000, description: "Luigi's", createdAt: new Date(), occurredOn: "2026-10-30", category: "food", receiptUrl });
  assert.equal(expenseView(s, e(`/api/docs/${id}`)).receiptUrl, `/api/docs/${id}`);
  assert.equal(expenseView(s, e("/uploads/tg/-100123/AQAD.jpg")).receiptUrl, null);
  assert.equal(expenseView(s, e(null)).receiptUrl, null);
});

describe("todayRows (Home's Today = the Bundle on a page)", () => {
  const lines = [
    { id: "splitting", name: "Money", href: "/g/g1/money", line: "💸 Rent is due Friday: $1,200 each." },
    { id: "house", name: "House", href: "/g/g1/house", line: "🧹 Trash is on Maya today." },
    { id: "groceries", name: "Groceries", href: "/g/g1/cart", line: null },
  ];
  const reminder = (id: string, day: string, text: string) => ({ id, text, when: `${day}, 8:00 PM`, time: "8:00 PM", day, for: null, setBy: null, repeat: null, canCancel: true });

  test("one row per Trick line in the order given (post order), then today's Reminders; silent Tricks drop out", () => {
    const rows = todayRows(lines, [reminder("r1", "2026-10-30", "Trash goes out"), reminder("r2", "2026-10-31", "Not today")], "2026-10-30", "/g/g1");
    assert.deepEqual(
      rows.map((r) => [r.id, r.text]),
      [
        ["splitting", "💸 Rent is due Friday: $1,200 each."],
        ["house", "🧹 Trash is on Maya today."],
        ["reminder-r1", "Trash goes out, 8:00 PM"],
      ]
    );
    assert.equal(rows[0].trick, "splitting");
    assert.equal(rows[0].href, "/g/g1/money");
    assert.equal(rows[2].trick, null, "Reminders are core's: no Trick accent");
    assert.equal(rows[2].href, "/g/g1/reminders");
  });

  test("nothing to say: no rows (the strip shows one quiet line)", () => {
    assert.deepEqual(todayRows([{ ...lines[2] }, { ...lines[0], line: "   " }], [], "2026-10-30", "/g/g1"), []);
  });
});

test("probablyLowRows: the Cart page's Probably low is restockCandidates' answer, with when it was last bought", () => {
  const every = (item: string, gap: number, last: string, memberId: string | null = null) =>
    [0, 1, 2, 3].map((k) => ({ item, memberId, occurredOn: addDaysToDay(last, -gap * k) }))
  const today = "2026-10-30"
  const events = [...every("milk", 9, "2026-10-22"), ...every("oat milk", 7, "2026-10-24", "sam"), ...every("eggs", 10, "2026-10-28")]
  const low = restockCandidates(events, [], [], today).map((c) => ({ item: c.item, lastBought: c.lastBought, scope: c.scope === "shared" ? ("shared" as const) : ("mine" as const) }))
  assert.deepEqual(probablyLowRows(low, today), [
    { item: "milk", when: "last bought 8 days ago", scope: "shared" },
    { item: "oat milk", when: "last bought 6 days ago", scope: "mine" },
  ])
  assert.deepEqual(probablyLowRows([], today), [], "nothing low: the section is hidden")
})

describe("groupTricks (the Tricks page: a plain list)", () => {
  const card = (id: string, enabled: boolean, status: "stable" | "beta" | "coming-soon" = "stable") => ({ id, enabled, status });

  test("Learned, Not yet, Soon in catalog order; nothing else", () => {
    const g = groupTricks([card("a", true), card("b", false), card("c", false, "coming-soon"), card("d", true, "beta"), card("e", false, "beta")]);
    assert.deepEqual(Object.keys(g), ["learned", "notYet", "soon"]);
    assert.deepEqual(g.learned.map((c) => c.id), ["a", "d"]);
    assert.deepEqual(g.notYet.map((c) => c.id), ["b", "e"]);
    assert.deepEqual(g.soon.map((c) => c.id), ["c"]);
  });
});
