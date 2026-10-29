// Beta requests without a DB: validation, honeypot, the per-IP limit, the operator's DM and its fallbacks.
// Run: npx tsx --test src/services/beta.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { WindowLimiter } from "@/lib/window-limit";
import { NotAllowedError } from "./authz";
import { betaSummary, hashIp, listBetaRequests, notifyOperator, parseBetaRequest, submitBetaRequest, type BetaRequest } from "./beta";

const good = { name: " Test Request ", email: " Test@Example.com ", groupSize: "3-4", purpose: "roommates", phone: "", notes: "" };

const fakeRow = (over: Partial<BetaRequest> = {}): BetaRequest => ({
  id: "00000000-0000-0000-0000-000000000001",
  createdAt: new Date("2026-10-29T12:00:00Z"),
  name: "Test Request",
  email: "test@example.com",
  groupSize: "3-4",
  purpose: "roommates",
  phone: null,
  notes: null,
  status: "new",
  userAgent: null,
  ipHash: null,
  ...over,
});

const quiet = async <T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> => {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void logs.push(a.join(" "));
  try {
    return { result: await fn(), logs };
  } finally {
    console.log = orig;
  }
};

test("a good request is trimmed, the email lowercased, empty optionals dropped", () => {
  const r = parseBetaRequest(good);
  assert.ok(r.ok);
  assert.deepEqual(r.data, { name: "Test Request", email: "test@example.com", groupSize: "3-4", purpose: "roommates", phone: undefined, notes: undefined });
});

test("one message per bad field, in the form's words", () => {
  const r = parseBetaRequest({ name: "", email: "nope", groupSize: "50", purpose: "cult", notes: "x".repeat(1001) });
  assert.ok(!r.ok);
  assert.equal(r.errors.name, "Tell us your name.");
  assert.equal(r.errors.email, "That email doesn't look right.");
  assert.equal(r.errors.groupSize, "Pick how many people are in the group.");
  assert.equal(r.errors.purpose, "Pick what the group is.");
  assert.equal(r.errors.notes, "Keep it under 1000 characters.");
});

test("phone numbers: digits with an optional +, 7-15 digits", () => {
  const phone = (p: string) => parseBetaRequest({ ...good, phone: p });
  const ok = phone("+1 (555) 123-4567");
  assert.ok(ok.ok);
  assert.equal(ok.data.phone, "+15551234567");
  assert.ok(phone("447700900123").ok);
  for (const bad of ["12345", "call me", "+1 555 123 4567 8901 23"]) assert.ok(!phone(bad).ok, bad);
});

test("the IP is never stored, only a keyed hash", () => {
  const h = hashIp("203.0.113.9", "secret");
  assert.match(h, /^[0-9a-f]{32}$/);
  assert.equal(h, hashIp(" 203.0.113.9 ", "secret"));
  assert.notEqual(h, hashIp("203.0.113.9", "other"));
  assert.ok(!h.includes("203"));
});

test("the operator's DM: who, what, how to reach them; no notes line when there are none", () => {
  assert.equal(betaSummary(fakeRow()), "🦖 New WhatsApp beta request\nTest Request <test@example.com>\nroommates, 3-4 people");
  const full = betaSummary(fakeRow({ phone: "+15551234567", notes: "we are   5\nroommates", groupSize: "5-8" }));
  assert.equal(full.split("\n").at(-2), "roommates, 5-8 people, WhatsApp +15551234567");
  assert.equal(full.split("\n").at(-1), '"we are 5 roommates"');
});

test("submit: stores, then notifies; the honeypot fakes success and stores nothing", async () => {
  const saved: unknown[] = [];
  const told: string[] = [];
  const deps = {
    limiter: new WindowLimiter(3, 3600_000),
    insert: async (row: object) => (saved.push(row), fakeRow(row as Partial<BetaRequest>)),
    notify: async (r: BetaRequest) => void told.push(r.email),
  };
  const { result } = await quiet(() => submitBetaRequest(good, { ip: "203.0.113.9", userAgent: "UA" }, deps));
  assert.deepEqual(result, { ok: true });
  assert.equal(saved.length, 1);
  assert.equal((saved[0] as { ipHash: string }).ipHash.length, 32);
  assert.equal((saved[0] as { userAgent: string }).userAgent, "UA");
  assert.deepEqual(told, ["test@example.com"]);

  const bot = await quiet(() => submitBetaRequest({ ...good, website: "http://spam.example" }, { ip: "203.0.113.9" }, deps));
  assert.deepEqual(bot.result, { ok: true });
  assert.equal(saved.length, 1, "nothing stored for the honeypot");
});

test("submit: 3 an hour per IP; invalid tries don't count; another IP is fine", async () => {
  let now = 0;
  const deps = { limiter: new WindowLimiter(3, 3600_000, () => now), insert: async () => fakeRow(), notify: async () => {} };
  const send = (ip: string, raw: Record<string, unknown> = good) => quiet(() => submitBetaRequest(raw, { ip }, deps)).then((r) => r.result);
  assert.equal((await send("1.1.1.1", { ...good, email: "bad" })).ok, false);
  for (let i = 0; i < 3; i++) assert.deepEqual(await send("1.1.1.1"), { ok: true });
  const limited = await send("1.1.1.1");
  assert.equal(limited.ok, false);
  assert.equal(!limited.ok && limited.reason, "rate_limited");
  assert.deepEqual(await send("2.2.2.2"), { ok: true });
  now = 3600_001;
  assert.deepEqual(await send("1.1.1.1"), { ok: true }, "the window slides");
});

test("submit: a DB failure is a friendly error, not a throw", async () => {
  const errs: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void errs.push(a);
  try {
    const r = await submitBetaRequest(good, { ip: "9.9.9.9" }, { limiter: new WindowLimiter(3, 1000), insert: async () => Promise.reject(new Error("down")) });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "failed");
    assert.equal(errs.length, 1);
  } finally {
    console.error = orig;
  }
});

test("notify: DMs the operator's Telegram id with the summary and a button through /signin", async () => {
  const prev = process.env.APP_URL;
  process.env.APP_URL = "https://roomie.example";
  try {
    const sent: { to: string; text: string; url?: string }[] = [];
    const { result } = await quiet(() => notifyOperator(fakeRow(), async (to, out) => void sent.push({ to, text: out.text, url: out.buttons?.[0]?.url }), async () => "4242"));
    assert.equal(result, "telegram");
    assert.equal(sent[0].to, "4242");
    assert.match(sent[0].text, /^🦖 New WhatsApp beta request/);
    assert.equal(sent[0].url, "https://roomie.example/signin?next=%2Fadmin%2Fbeta");
  } finally {
    if (prev === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prev;
  }
});

test("notify falls back to a [beta] log line: no Telegram, no operator Member, or the DM fails", async () => {
  const cases = [
    { send: null, find: async () => "1", why: /no Telegram channel/ },
    { send: async () => {}, find: async () => null, why: /no operator Telegram Member/ },
    { send: async () => Promise.reject(new Error("press Start")), find: async () => "1", why: /Telegram DM failed \(press Start\)/ },
  ];
  for (const c of cases) {
    const { result, logs } = await quiet(() => notifyOperator(fakeRow(), c.send, c.find));
    assert.equal(result, "log");
    const line = logs.find((l) => l.startsWith("[beta] ") && c.why.test(l));
    assert.ok(line, logs.join(" | "));
    assert.match(line, /Test Request <test@example.com>/);
  }
});

test("only operators can read the list", async () => {
  await assert.rejects(listBetaRequests(null), (e) => e instanceof NotAllowedError && e.code === "operator-only");
});
