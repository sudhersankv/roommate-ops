// Who may see /admin/*. Run: npx tsx --test src/lib/operator.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { operatorFrom } from "./operator-rule";

const ops = { operators: ["Owner@Example.com"] };
const owner = { id: "u1", email: "owner@example.com", emailVerified: true };

test("a verified operator passes, case-insensitively", () => {
  assert.equal(operatorFrom(owner, ops), owner);
});

test("signed out, or not on the list: no", () => {
  assert.equal(operatorFrom(null, ops), null);
  assert.equal(operatorFrom({ ...owner, email: "someone@example.com" }, ops), null);
});

test("fail-closed: an empty allowlist admits nobody", () => {
  assert.equal(operatorFrom(owner, { operators: [] }), null);
});

test("the email must be verified by the identity provider, even when it matches", () => {
  assert.equal(operatorFrom({ ...owner, emailVerified: false }, ops), null);
  assert.equal(operatorFrom({ ...owner, emailVerified: undefined }, ops), null);
});

test("the dev bypass identity counts as verified only when it is the dev email", () => {
  const dev = { id: "dev:owner@example.com", email: "owner@example.com" };
  assert.equal(operatorFrom(dev, { ...ops, devEmail: "owner@example.com" }), dev);
  assert.equal(operatorFrom(dev, { ...ops, devEmail: "other@example.com" }), null);
  assert.equal(operatorFrom(dev, { ...ops, devEmail: null }), null);
});
