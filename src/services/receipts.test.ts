// Receipts: the model only transcribes; sums and splits are recomputed here (pure, no model call).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReceipt, imageDataUrl, isOwnUpload, matchItem, parseModelJson, priceToCents, receiptSplits, SAMPLE_RECEIPT } from "./receipts";

const sum = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);

test("priceToCents parses printed prices without float math", () => {
  assert.equal(priceToCents("12.50"), 1250);
  assert.equal(priceToCents("$1,234.5"), 123450);
  assert.equal(priceToCents(0.1 + 0.2), null, "a float with many decimals isn't a printed price");
  assert.equal(priceToCents("9"), 900);
  assert.equal(priceToCents("abc"), null);
});

test("checkReceipt recomputes the total from items + tax + tip", () => {
  const r = checkReceipt(SAMPLE_RECEIPT);
  assert.equal(r.itemsCents, 10700);
  assert.equal(r.totalCents, 13797);
  assert.equal(r.mismatch, false);
  assert.equal(r.confidence, "high");
  assert.equal(r.date, "2026-10-27");
});

test("checkReceipt flags a printed total that doesn't match the items", () => {
  const r = checkReceipt({ ...SAMPLE_RECEIPT, total: "140.00" });
  assert.equal(r.totalCents, 13797, "the computed sum wins");
  assert.equal(r.printedTotalCents, 14000);
  assert.equal(r.mismatch, true);
  assert.equal(r.confidence, "low");
});

test("parseModelJson accepts fenced JSON and rejects junk", () => {
  const r = parseModelJson('```json\n{"merchant":"X","items":[{"name":"a","price":"1.00"}],"total":"1.00"}\n```');
  assert.equal(r.merchant, "X");
  assert.throws(() => parseModelJson("no json here"), /make sense/);
});

test("receiptSplits: steak to Dev, wine shared, the rest shared; tax + tip by share of items; sums to the total", () => {
  const r = checkReceipt(SAMPLE_RECEIPT);
  const everyone = ["maya", "dev", "sam"];
  const { rows, items } = receiptSplits(r, [{ item: "steak", memberIds: ["dev"] }, { item: "wine", memberIds: everyone }], everyone, "maya");
  assert.equal(sum(rows), 13797);
  assert.deepEqual(items.find((i) => i.name === "Ribeye steak")?.memberIds, ["dev"]);
  const by = Object.fromEntries(rows.map((x) => [x.memberId, x.cents]));
  // Items: Dev 3800 + 6900/3 (2300) = 6100; Maya and Sam 2300 each. Extras 3097 spread 61:23:23.
  assert.ok(by.dev > by.maya && by.maya >= by.sam, JSON.stringify(by));
  assert.ok(Math.abs(by.maya - by.sam) <= 1);
  assert.throws(() => receiptSplits(r, [{ item: "lobster", memberIds: ["dev"] }], everyone), /No item like "lobster".*Ribeye steak/);
});

test("receiptSplits: an override total spreads the difference the same way", () => {
  const r = checkReceipt(SAMPLE_RECEIPT);
  const { rows } = receiptSplits(r, [], ["a", "b"], "a", 12000);
  assert.equal(sum(rows), 12000);
});

test("matchItem prefers exact, then contains, then a word", () => {
  const items = [{ name: "Margherita pizza", cents: 1 }, { name: "Pizza bianca", cents: 1 }];
  assert.equal(matchItem(items, "pizza bianca", new Set()), 1);
  assert.equal(matchItem(items, "margherita", new Set()), 0);
  assert.equal(matchItem(items, "the pizza", new Set([0])), 1);
});

test("our own photos are /api/docs links (relative or under APP_URL); old /uploads paths and typed URLs are not", async () => {
  const id = "0b7e4a52-3c1d-4f6a-9e2b-5d8c7a1f0e93";
  assert.equal(isOwnUpload(`/api/docs/${id}`), true);
  assert.equal(isOwnUpload(`/api/docs/${id}/../x`), false);
  assert.equal(isOwnUpload("/uploads/tg/-100123/AQAD.jpg"), false);
  assert.equal(isOwnUpload(`https://evil.example/api/docs/${id}`), false);
  await assert.rejects(imageDataUrl("/uploads/../../.env"), /only read photos/);
  await assert.rejects(imageDataUrl("http://127.0.0.9/a.jpg"), /only read photos/);
});