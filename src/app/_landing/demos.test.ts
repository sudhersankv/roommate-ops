// The landing page's chats add up (docs/landing.md "Changing the copy"): each demo's numbers sum as its comment says.
// Run: npx tsx --test src/app/_landing/demos.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatLine } from "./chat";
import { APARTMENT, DEMOS, HERO } from "./demos";

const said = (lines: ChatLine[]) => lines.filter((l): l is Extract<ChatLine, { who: string }> => "who" in l);
const roomieText = (lines: ChatLine[]) =>
  said(lines)
    .filter((l) => l.who === "Roomie" && typeof l.text === "string")
    .map((l) => l.text as string)
    .join("\n");
const demo = (id: string) => {
  const d = DEMOS.find((x) => x.id === id);
  assert.ok(d, `demo ${id}`);
  return d;
};

test("the hero: rent $2,400 (3 x $800) and $60 internet over 3 = $20 each, said as such", () => {
  const text = roomieText(HERO.lines);
  assert.equal(2400 / 3, 800);
  assert.match(text, /Rent \$2,400 is due Saturday\. Maya pays the landlord/);
  assert.equal(60 / 3, 20);
  assert.match(text, /\$60 internet, \$20 each: Maya and Sam owe Dev \$20/);
  assert.match(text, /Thursday 1-3/, "the landlord line");
  assert.equal(HERO.title, APARTMENT.title);
});

test("rent demo: $2,400 / 3 = $800 to Maya, said to the viewer privately with a pay link", () => {
  const d = demo("rent");
  assert.equal(2400 / 3, 800);
  const lines = said(d.lines);
  assert.match(lines[0].text as string, /Rent \$2,400 is due Saturday\. Maya pays the landlord\./);
  assert.ok(!lines[0].dm, "the rent line is for the group");
  const owe = lines.find((l) => l.dm && /You owe Maya \$800 for rent/.test(String(l.text)));
  assert.ok(owe, "the share goes out by DM");
  assert.equal(owe.button, "Pay Maya $800 on Venmo");
  assert.ok(lines.filter((l) => l.dm).length >= 2, "the rest of the exchange stays private");
  assert.equal(d.title, "Nobody has to be that guy anymore.");
  assert.equal(d.trick.name, "Money");
});

test("lease demo: 'tell them' -> Sent -> the landlord's reply with a day and a reminder, no money", () => {
  const d = demo("lease");
  const text = roomieText(d.lines);
  assert.match(text, /^Sent: reported the leaking kitchen sink\./m);
  assert.match(text, /Landlord: plumber Tuesday 10-12\. I'll remind you Monday\./);
  assert.ok(!/\$/.test(text), "no amounts in a work order");
  assert.ok(d.lines.some((l) => "day" in l), "the reply comes a day later");
  assert.equal(d.trick.name, "Lease Inbox");
});

test("groceries demo: 2 open + milk + dish soap = 4, + oat milk = 5", () => {
  const d = demo("groceries");
  const text = roomieText(d.lines);
  assert.equal(2 + 2, 4);
  assert.equal(4 + 1, 5);
  assert.match(text, /^Probably low: milk, dish soap\. Add them\?/m);
  assert.match(text, /Added both as shared\. Cart's at 4\./);
  assert.match(text, /Added, yours\. Cart's at 5\./);
});

test("house demo: the 7-day dish streak in the one voice, then the morning line", () => {
  const d = demo("house");
  const text = roomieText(d.lines);
  assert.match(text, /7 in a row for Dev/);
  assert.match(text, /Dishes are Sam's tomorrow/);
  assert.match(text, /^Morning\. Dishes are on Sam today/m);
  assert.ok(!/!!|🎉|team!/.test(text), "chill, not hype");
  assert.equal(d.trick.name, "House");
});

test("pizza demo: $36 over the 3 of 4 who had some = $12 each, from a Poll", () => {
  const d = demo("pizza");
  const poll = d.lines.find((l): l is Extract<ChatLine, { poll: string }> => "poll" in l);
  assert.ok(poll, "a Poll bubble");
  assert.equal(poll.poll, "Who had pizza?");
  const total = poll.options.reduce((n, o) => n + o.votes, 0);
  assert.equal(total, 4);
  assert.equal(poll.of, 4);
  const had = poll.options.find((o) => o.label === "I did");
  assert.equal(had?.votes, 3);
  assert.equal(36 / (had?.votes ?? 0), 12);
  assert.match(roomieText(d.lines), /\$36 pizza, three ways: Dev and Sam owe Maya \$12 each/);
  assert.match(d.group.people, /Priya/, "the fourth person is in the header");
});

test("five demos, one per bucket, all in Apt 4B; a win line and a Roomie line in each", () => {
  assert.equal(DEMOS.length, 5);
  assert.deepEqual(
    DEMOS.map((d) => d.trick.name),
    ["Money", "Lease Inbox", "Groceries", "House", "Money"],
  );
  for (const d of DEMOS) {
    assert.equal(d.group.title, "Apt 4B", d.id);
    assert.ok(said(d.lines).some((l) => l.who === "Roomie"), `${d.id}: Roomie speaks`);
    assert.ok(said(d.lines).some((l) => l.win), `${d.id}: a win to cheer`);
  }
});
