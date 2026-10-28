// Claim link rules, no DB. Run: npx tsx --test src/services/claims.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAIM_TTL_MS, claimState, newClaimToken } from "./claims";

const issued = new Date("2026-10-28T12:00:00Z");
const row = (usedAt: Date | null = null) => ({ expiresAt: new Date(issued.getTime() + CLAIM_TTL_MS), usedAt });

test("tokens are 32 random bytes, base64url, never repeated", () => {
  const a = newClaimToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(a, "base64url").length, 32);
  assert.notEqual(a, newClaimToken());
});

test("a link lasts 24 hours", () => {
  assert.equal(CLAIM_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(claimState(row(), new Date(issued.getTime() + 23 * 3600_000)), "ok");
  assert.equal(claimState(row(), new Date(issued.getTime() + CLAIM_TTL_MS)), "expired", "expires exactly at 24h");
  assert.equal(claimState(row(), new Date(issued.getTime() + 25 * 3600_000)), "expired");
});

test("single use: a used link stays used, even before it expires", () => {
  assert.equal(claimState(row(new Date(issued.getTime() + 60_000)), new Date(issued.getTime() + 120_000)), "used");
});

test("an unknown token is missing", () => {
  assert.equal(claimState(undefined), "missing");
});
