// Permission rules, no DB. Run: npx tsx --test src/services/authz.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canChangeExpense, checkActive, checkAdmin, NotAllowedError, type Actor } from "./authz";

const actor = (role: Actor["role"], status: Actor["status"], id = "me"): Actor => ({ id, displayName: "Me", role, status });
const code = (fn: () => void) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    assert.ok(e instanceof NotAllowedError, `expected NotAllowedError, got ${e}`);
    return e.code;
  }
};

test("checkActive: active passes; Pending, removed and strangers are refused", () => {
  assert.equal(code(() => checkActive(actor("member", "active"))), "ok");
  assert.equal(code(() => checkActive(actor("admin", "pending"))), "pending");
  assert.equal(code(() => checkActive(actor("member", "removed"))), "removed");
  assert.equal(code(() => checkActive(undefined)), "not-member");
});

test("checkActive: the Pending message is friendly and names who can approve", () => {
  assert.throws(() => checkActive(actor("member", "pending"), ["Maya"]), /^NotAllowedError: Hang on, an admin needs to approve you first\. Maya can approve you\.$/);
  assert.throws(() => checkActive(actor("member", "pending"), ["Maya", "Dev"]), /Maya or Dev can approve you/);
  assert.throws(() => checkActive(actor("member", "pending")), /approve you first\.$/);
});

test("checkAdmin: only active Admins; a Pending Admin is still Pending", () => {
  assert.equal(code(() => checkAdmin(actor("admin", "active"))), "ok");
  assert.equal(code(() => checkAdmin(actor("member", "active"), ["Maya"])), "admin-only");
  assert.equal(code(() => checkAdmin(actor("admin", "pending"))), "pending");
  assert.throws(() => checkAdmin(actor("member", "active"), ["Maya"]), /Only an admin can do that\. Maya can do that\./);
});

test("canChangeExpense: whoever added it, paid it or has a Share, or an Admin", () => {
  const e = { createdBy: "maya", payerId: "dev", participantIds: ["maya", "dev", "sam"] };
  assert.equal(canChangeExpense(actor("member", "active", "maya"), e), true, "added it");
  assert.equal(canChangeExpense(actor("member", "active", "dev"), e), true, "paid it");
  assert.equal(canChangeExpense(actor("member", "active", "sam"), e), true, "has a Share");
  assert.equal(canChangeExpense(actor("member", "active", "priya"), e), false, "not in it");
  assert.equal(canChangeExpense(actor("admin", "active", "priya"), e), true, "Admin");
  assert.equal(canChangeExpense(actor("admin", "pending", "maya"), e), false, "Pending can't, even their own");
});
