// /help's FAQ: what the page shows (`a`) and what search engines get (`text`, FAQPage JSON-LD) say the same thing.
// Run: npx tsx --test src/app/help/faq.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactNode } from "react";
import { FAQ, faqJsonLd } from "./faq";

/** The text a React tree would render (no DOM needed): strings, joined through elements and fragments. */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** Letters, digits and spaces only, lowercased: quotes, arrows and ellipses don't count as a difference. */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$@]+/gu, " ")
    .trim()
    .split(/\s+/)
    .join(" ");

test("every FAQ answer renders to the same words as its JSON-LD text", () => {
  for (const f of FAQ) assert.equal(words(textOf(f.a)), words(f.text), f.q);
});

test("the JSON-LD is a FAQPage with one Question per entry and no raw '<'", () => {
  const ld = faqJsonLd();
  assert.ok(!ld.includes("<"));
  const parsed = JSON.parse(ld) as { "@type": string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
  assert.equal(parsed["@type"], "FAQPage");
  assert.deepEqual(
    parsed.mainEntity.map((e) => e.name),
    FAQ.map((f) => f.q),
  );
});

test("the trust questions (ADR 0015, 0016) are answered: iMessage is Soon through a relay; the landlord knows it's a shared inbox", () => {
  const byQ = (q: RegExp) => FAQ.find((f) => q.test(f.q))?.text ?? "";
  assert.match(byQ(/iMessage/), /^Soon, through a relay we run\./);
  assert.match(byQ(/landlord know/), /^Yes\. Every email it sends says it's the residents' shared inbox and names who asked\./);
  assert.ok(!FAQ.some((f) => /vibe|name/i.test(f.q)), "no vibe or name question (one voice)");
});
