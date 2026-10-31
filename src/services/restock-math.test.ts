import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { addDaysToDay } from "@/lib/time";
import { checkoutAskLine, lastBoughtText, restockAddedLine, restockCandidates, restockLine, type PurchaseEvent, type RestockCandidate } from "./restock-math";

const SAM = "sam-member-id";

/** Purchases of `item` every `gaps[i]` days, starting on `start`. */
function bought(item: string, start: string, gaps: number[], memberId: string | null = null): PurchaseEvent[] {
  const days = [start];
  for (const g of gaps) days.push(addDaysToDay(days[days.length - 1], g));
  return days.map((occurredOn) => ({ item, memberId, occurredOn }));
}

const at = (events: PurchaseEvent[], today: string, cart: { name: string }[] = [], mutes: string[] = []) => restockCandidates(events, cart, mutes, today);

describe("restockCandidates", () => {
  test("fewer than three purchases: no opinion", () => {
    assert.deepEqual(at(bought("milk", "2026-09-01", [9]), "2026-10-30"), []);
  });

  test("a 9-day habit is due on day 8 (0.9 x 9 = 8.1 falls on local day 8), not day 7", () => {
    const events = bought("milk", "2026-10-03", [9, 9, 9]); // Oct 3, 12, 21, 30
    const last = "2026-10-30";
    assert.equal(events.at(-1)!.occurredOn, last);
    assert.deepEqual(at(events, addDaysToDay(last, 7)), []);
    assert.deepEqual(at(events, addDaysToDay(last, 8)), [{ item: "milk", lastBought: last, expectedOn: "2026-11-08", scope: "shared", overdueDays: -1 }]);
  });

  test("irregular gaps: the median, not the mean", () => {
    // gaps 5, 6, 30 -> median 6 (the mean would be ~13.7)
    const events = bought("dish soap", "2026-08-20", [5, 6, 30]);
    const last = events.at(-1)!.occurredOn;
    assert.equal(at(events, addDaysToDay(last, 5)).length, 1); // floor(0.9 x 6) = 5
    assert.equal(at(events, addDaysToDay(last, 4)).length, 0);
  });

  test("an even number of gaps: the median is the middle two averaged", () => {
    const events = bought("coffee", "2026-09-01", [10, 12, 14, 16]); // median 13 -> threshold 11.7 -> day 11
    const last = events.at(-1)!.occurredOn;
    assert.equal(at(events, addDaysToDay(last, 11))[0]?.expectedOn, addDaysToDay(last, 13));
    assert.equal(at(events, addDaysToDay(last, 10)).length, 0);
  });

  test("two purchases on one day count once", () => {
    const events = [...bought("milk", "2026-10-01", [9, 9]), { item: "milk 2%", memberId: null, occurredOn: "2026-10-19" }];
    assert.deepEqual(at(events, "2026-10-30").map((c) => c.lastBought), ["2026-10-19"]);
    assert.deepEqual(at(bought("milk", "2026-10-01", [0, 0, 9]), "2026-10-30"), [], "only two distinct days");
  });

  test("spelling doesn't split the history; the newest name is the one said", () => {
    const events: PurchaseEvent[] = [
      { item: "whole milk", memberId: null, occurredOn: "2026-10-01" },
      { item: "milk 2%", memberId: null, occurredOn: "2026-10-10" },
      { item: "milk", memberId: null, occurredOn: "2026-10-19" },
    ];
    assert.deepEqual(at(events, "2026-10-28").map((c) => c.item), ["milk"]);
  });

  test("in the open Cart already: not low", () => {
    const events = bought("milk", "2026-10-01", [9, 9]);
    assert.deepEqual(at(events, "2026-10-28", [{ name: "Milk, 1 gal" }]), []);
    assert.equal(at(events, "2026-10-28", [{ name: "oat milk" }]).length, 1, "oat milk is a different thing");
  });

  test("muted: not low", () => {
    const events = [...bought("dish soap", "2026-09-01", [14, 14]), ...bought("milk", "2026-10-01", [9, 9])];
    assert.deepEqual(at(events, "2026-10-29", [], ["dish soap"]).map((c) => c.item), ["milk"]);
  });

  test("personal and shared are separate habits", () => {
    const events = [...bought("oat milk", "2026-10-01", [7, 7], SAM), ...bought("milk", "2026-09-24", [9, 9])];
    const got = at(events, "2026-10-21"); // milk expected today (0), Sam's oat milk tomorrow (-1)
    assert.deepEqual(
      got.map((c) => [c.item, c.scope]),
      [["milk", "shared"], ["oat milk", SAM]],
    );
  });

  test("the same thing bought shared and by Sam: two histories, neither borrows the other's purchases", () => {
    const events = [...bought("milk", "2026-10-01", [9, 9]), { item: "milk", memberId: SAM, occurredOn: "2026-10-25" }];
    assert.deepEqual(at(events, "2026-10-27").map((c) => [c.item, c.scope]), [["milk", "shared"]]);
  });

  test("bought in the last two days: never low, whatever the habit", () => {
    const events = bought("bananas", "2026-10-20", [1, 1, 1, 1]); // daily -> due every day
    assert.deepEqual(at(events, "2026-10-26"), []); // last bought Oct 24, two days ago
    assert.equal(at(events, "2026-10-27").length, 1);
  });

  test("most overdue first, then by name", () => {
    const events = [
      ...bought("milk", "2026-10-01", [9, 9]), // last Oct 19, expected Oct 28
      ...bought("eggs", "2026-09-20", [10, 10]), // last Oct 10, expected Oct 20
      ...bought("bread", "2026-10-07", [7, 7]), // last Oct 21, expected Oct 28
    ];
    assert.deepEqual(at(events, "2026-10-30").map((c) => [c.item, c.overdueDays]), [["eggs", 10], ["bread", 2], ["milk", 2]]);
  });
});

describe("restockLine", () => {
  const c = (item: string): RestockCandidate => ({ item, lastBought: "2026-10-01", expectedOn: "2026-10-10", scope: "shared", overdueDays: 1 });

  test("one line, ending with the question", () => {
    assert.equal(restockLine([c("milk"), c("dish soap")]), "Probably low: milk, dish soap. Add them?");
    assert.equal(restockLine([c("milk")]), "Probably low: milk. Add it?");
    assert.equal(restockLine([]), null);
  });

  test("at most four names, then +N more", () => {
    const six = ["milk", "dish soap", "eggs", "coffee", "bread", "rice"].map(c);
    assert.equal(restockLine(six), "Probably low: milk, dish soap, eggs, coffee +2 more. Add them?");
    assert.equal(restockLine(six, 2), "Probably low: milk, dish soap +4 more. Add them?");
  });

  test("nothing that could read as a price", () => {
    const line = restockLine(["milk", "dish soap", "eggs", "coffee", "bread"].map(c))!;
    assert.doesNotMatch(line, /[$€£]|\d+\.\d|\d{2,}/);
    assert.deepEqual(line.match(/\d+/g), ["1"]); // only the "+1 more"
  });

  test("a Member's own, for their DM: 'your'", () => {
    assert.equal(restockLine([c("oat milk")], 4, { yours: true }), "Probably low: your oat milk. Add it?");
    assert.equal(restockLine([c("oat milk"), c("coffee")], 4, { yours: true }), "Probably low: your oat milk, coffee. Add them?");
  });
});

describe("restockAddedLine", () => {
  test("one line saying what went in and for whom", () => {
    assert.equal(restockAddedLine(["milk", "dish soap"], "shared"), "Added milk and dish soap as shared.");
    assert.equal(restockAddedLine(["milk", "dish soap", "eggs"], "shared"), "Added milk, dish soap and eggs as shared.");
    assert.equal(restockAddedLine(["oat milk"], "mine"), "Added oat milk for you.");
    assert.equal(restockAddedLine([], "shared"), "Nothing to add: none of that is still low.");
  });
});

describe("checkoutAskLine", () => {
  test("asks once, no prices", () => {
    assert.equal(checkoutAskLine(["eggs", "coffee"]), "Want me to add eggs and coffee? They're probably low.");
    assert.equal(checkoutAskLine(["eggs"]), "Want me to add eggs? It's probably low.");
  });
});

describe("lastBoughtText", () => {
  test("days since, in words", () => {
    assert.equal(lastBoughtText("2026-10-21", "2026-10-30"), "last bought 9 days ago");
    assert.equal(lastBoughtText("2026-10-29", "2026-10-30"), "last bought yesterday");
    assert.equal(lastBoughtText("2026-10-30", "2026-10-30"), "bought today");
  });
});
