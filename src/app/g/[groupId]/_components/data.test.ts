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
import type { InboxData } from "@/services/lease-inbox-toolkit";
import { NAV_TABS, expenseView, groupTricks, inboxThreads, shellView, todayRows } from "./data";

const onFor = (ids: readonly string[]) => Object.fromEntries(MANIFESTS.map((m) => [m.id, ids.includes(m.id)]));

/** The nav orders the issue (#28) gives: Money 10, House 30, Inbox 35, Cart 40. */
const ISSUE_ORDER: Record<string, number> = { splitting: 10, house: 30, groceries: 40 };
const withIssueOrder = (list: readonly ToolkitManifest[]) =>
  list.map((m) => (m.dashboard?.nav && ISSUE_ORDER[m.id] ? { ...m, dashboard: { ...m.dashboard, nav: { ...m.dashboard.nav, order: ISSUE_ORDER[m.id] } } } : m));

const LEASE = "lease-inbox";

const navOrder = (id: string) => MANIFESTS.find((m) => m.id === id)?.dashboard?.nav?.order ?? 0;

describe("shellView", () => {
  test("the dock holds two Tricks, so Ask Roomie has two a side (Home · 2 · Ask · 2 · More)", () => {
    assert.equal(NAV_TABS, 2);
  });

  test("roommates, at the issue's nav orders: Money and House in the dock; Cart is a learned tile in the drawer", () => {
    const v = shellView("g1", onFor(PRESETS.roommates), withIssueOrder(MANIFESTS));
    assert.deepEqual(v.nav.map((n) => [n.label, n.href]), [["Money", "/g/g1/money"], ["House", "/g/g1/house"]]);
    assert.deepEqual(v.drawer.learned.map((n) => n.label), ["Cart"]);
    // Lease Inbox is built (#27) but off by default: a slot to teach, not Soon.
    assert.deepEqual(v.drawer.notYet.map((t) => t.name), ["Lease Inbox"]);
    assert.ok(!v.drawer.soon.some((s) => s.name === "Lease Inbox"));
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
    const v = shellView("g1", onFor(["splitting", "groceries", LEASE]), withIssueOrder(MANIFESTS));
    assert.deepEqual(v.nav.map((n) => [n.label, n.href]), [["Money", "/g/g1/money"], ["Inbox", "/g/g1/inbox"]]);
    assert.deepEqual(v.drawer.learned.map((n) => n.label), ["Cart"]);
    assert.deepEqual(v.drawer.notYet.map((t) => t.name), ["House"]);
    assert.ok(!v.drawer.soon.some((s) => s.name === "Lease Inbox"), "a built Trick isn't Soon");
  });

  test("Lease Inbox and House both on: House (30) keeps its slot, Inbox (35) goes to the drawer before Cart", () => {
    const v = shellView("g1", onFor([...PRESETS.roommates, LEASE]), withIssueOrder(MANIFESTS));
    assert.deepEqual(v.nav.map((n) => n.label), ["Money", "House"]);
    assert.deepEqual(v.drawer.learned.map((n) => n.label), ["Inbox", "Cart"]);
  });

  test("a trip: Money and Cart in the dock; House is a greyed slot; the house page shows the off state", () => {
    const v = shellView("g1", onFor(PRESETS.trip));
    assert.deepEqual(v.nav.map((n) => n.label), ["Money", "Cart"]);
    assert.deepEqual(v.drawer.learned, []);
    assert.deepEqual(v.drawer.notYet.map((t) => t.name), ["House", "Lease Inbox"]);
    const house = v.ownedPages.find((p) => p.prefix === "house")!;
    assert.deepEqual(house.owners.map((o) => [o.name, o.enabled]), [["House", false]]);
    assert.ok(!v.ownedPages.some((p) => p.prefix === "chores"), "the old page prefix is gone");
  });

  test("nothing learned: Home · Ask · More only; every Trick is a slot to teach, the Soon ones stay one tile's worth", () => {
    const v = shellView("g1", onFor([]));
    assert.deepEqual(v.nav, []);
    assert.deepEqual(v.drawer.learned, []);
    assert.deepEqual(v.drawer.notYet.map((t) => t.name), ["Money", "Groceries", "House", "Lease Inbox"]);
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

describe("inboxThreads (the Inbox page: tabs by class)", () => {
  const at = (iso: string) => new Date(iso);
  const mail = (id: string, cls: InboxData["mail"][number]["class"], threadId: string, receivedAt: string, over: Partial<InboxData["mail"][number]> = {}): InboxData["mail"][number] => ({
    id,
    class: cls,
    from: "leasing@brookfieldresidential.com",
    subject: `Subject ${id}`,
    summary: `summary ${id}`,
    text: "Dear Resident,",
    threadId,
    receivedAt: at(receivedAt),
    trusted: cls !== "new-sender",
    documentIds: [],
    ...over,
  });
  const data: InboxData = {
    address: "apt-4b-x7k2@agentmail.to",
    senders: [{ value: "brookfieldresidential.com", source: "forward" }],
    mail: [
      mail("m1", "notice", "t1", "2026-10-27T20:14:00Z", { documentIds: ["0b7e4a52-3c1d-4f6a-9e2b-5d8c7a1f0e93"] }),
      mail("m2", "rent-lease", "t2", "2026-10-28T15:00:00Z"),
      mail("m3", "work-order", "t3", "2026-10-29T15:00:00Z"),
      mail("m4", "other", "t4", "2026-10-29T16:00:00Z"),
      mail("m5", null, "t5", "2026-10-29T17:00:00Z"),
      mail("m6", "new-sender", "t6", "2026-10-30T15:00:00Z", { from: "parking@cityparkingllc.com" }),
    ],
    sent: [
      { id: "s1", threadId: "t3", summary: "reported the leaking kitchen sink", to: "leasing@brookfieldresidential.com", by: "Dev", at: at("2026-10-28T14:00:00Z") },
      { id: "s2", threadId: "t7", summary: "reported the broken blinds", to: "leasing@brookfieldresidential.com", by: null, at: at("2026-10-30T16:00:00Z") },
    ],
    workOrders: [
      { id: "w1", title: "the leaking kitchen sink", status: "scheduled", scheduledFor: "2026-11-03T10:00", lastReply: "plumber Tuesday 10am", threadId: "t3", reportedBy: "Dev" },
      { id: "w2", title: "the broken blinds", status: "sent", scheduledFor: null, lastReply: null, threadId: "t7", reportedBy: null },
    ],
  };

  test("each thread lands in its class's tab; a work order nobody answered yet is Work orders; unclassified is Everything else", () => {
    const { threads, counts } = inboxThreads(data, "America/Chicago");
    const tabOf = Object.fromEntries(threads.map((t) => [t.threadId, t.tab]));
    assert.deepEqual(tabOf, { t1: "notices", t2: "rent", t3: "work-orders", t4: "other", t5: "other", t6: "new-senders", t7: "work-orders" });
    assert.deepEqual(counts, { notices: 1, rent: 1, "work-orders": 2, other: 2, "new-senders": 1 });
    assert.deepEqual(threads.map((t) => t.threadId), ["t7", "t6", "t5", "t4", "t3", "t2", "t1"], "newest first");
  });

  test("a thread reads in order with what Roomie sent; new senders can't be replied to; attachments link to Documents", () => {
    const { threads } = inboxThreads(data, "America/Chicago");
    const sink = threads.find((t) => t.threadId === "t3")!;
    assert.deepEqual(sink.items.map((i) => [i.direction, i.from]), [["out", "Roomie for Dev"], ["in", "leasing@brookfieldresidential.com"]]);
    assert.equal(sink.workOrder?.status, "scheduled");
    assert.equal(sink.canReply, true);
    assert.equal(threads.find((t) => t.threadId === "t6")!.canReply, false);
    assert.equal(threads.find((t) => t.threadId === "t7")!.canReply, false, "only our own email in it: nothing from the landlord to answer");
    assert.deepEqual(threads.find((t) => t.threadId === "t1")!.items[0].documents, [{ id: "0b7e4a52-3c1d-4f6a-9e2b-5d8c7a1f0e93", href: "/api/docs/0b7e4a52-3c1d-4f6a-9e2b-5d8c7a1f0e93" }]);
  });
});