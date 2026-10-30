import { test } from "node:test";
import assert from "node:assert/strict";
import { GATE_SPAN, isUnaddressed, NOT_KEPT, redactUnaddressed, ROOT_SPAN } from "./observability";

const ended = new Date();
const root = (output: unknown, endTime: Date | undefined = ended) => ({ name: ROOT_SPAN, endTime, output, input: { text: "[Maya] my rent is late again" } as unknown });
const gate = (speak: boolean) => ({ name: GATE_SPAN, endTime: ended, output: { speak, decision: "ignore" }, input: { latest: "[Maya] hi all", hardTrigger: false, inWindow: false } as unknown });

test("a message the Gate ignored keeps no text in its spans", () => {
  const r = redactUnaddressed(root({ replied: false }));
  assert.deepEqual(r.input, { text: NOT_KEPT, chars: "[Maya] my rent is late again".length });
  const g = redactUnaddressed(gate(false));
  assert.deepEqual(g.input, { latest: NOT_KEPT, chars: "[Maya] hi all".length, hardTrigger: false, inWindow: false });
});

test("the day's greeting alone doesn't count as reading the message", () => {
  assert.ok(isUnaddressed(root({ replied: true, greeting: "morning!" })));
});

test("messages Roomie acted on keep their text", () => {
  assert.ok(!isUnaddressed(root({ text: "Logged it." })));
  assert.ok(!isUnaddressed(root({ replied: false, silent: true })), "the agent read it (follow-up window, stayed silent)");
  assert.ok(!isUnaddressed(gate(true)));
  assert.equal((redactUnaddressed(gate(true)).input as { latest: string }).latest, "[Maya] hi all");
});

test("spans that haven't ended, and other spans, are left alone", () => {
  assert.ok(!isUnaddressed(root(undefined, undefined)));
  assert.ok(!isUnaddressed({ name: "agent run: 'roomie'", endTime: ended, output: { replied: false } }));
});
