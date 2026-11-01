// npm run evals [-- --only id,id] [-- --baseline]
// Runs every scenario in src/mastra/evals/scenarios.ts through the real pipeline (Jev Gate + Sonnet + tools) against
// the dev DB, each in its own throwaway Group that is deleted afterwards (memory thread included). Prints a
// table and the pass rate; --baseline also writes docs/evals-baseline.md. Traces stay in Postgres for Studio.
import "../src/lib/env";
import { writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

// Receipts use the sample receipt (the vision call is covered by dev-chat); Splitwise and Instacart use their fakes.
// Recipes are written by the real model.
process.env.RECEIPT_FAKE = "1";
process.env.SPLITWISE_FAKE = "1";
process.env.INSTACART_FAKE = "1";
// Lease Inbox: FakeMail (no AgentMail inbox per scenario), keyword classification and lease answers (no small model).
process.env.MAIL_FAKE = "1";
process.env.MAIL_CLASSIFIER_FAKE = "1";

import { db, schema } from "../src/db";
import { respond, type PipelineResult } from "../src/pipeline";
import { mastra } from "../src/mastra";
import { deleteGroup } from "../src/services/groups";
import { assertNotProdDb } from "./lib/prod-guard";
import { shapeOf } from "../src/mastra/scorers/brevity-tone";
import { dbMoments } from "../src/services/pet";
import { localDay } from "../src/lib/dates";
import { countEmoji } from "../src/lib/personality";
import { EVAL_MEMBERS, READ_ONLY_TOOLS, SCENARIOS, type EvalEnv, type EvalMember, type Expect, type Scenario, type Turn } from "../src/mastra/evals/scenarios";

const args = process.argv.slice(2);
const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;
const writeBaseline = args.includes("--baseline");
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_WAIT_MS = 30_000;

async function createGroup(id: string, greet = false): Promise<EvalEnv> {
  const [group] = await db.insert(schema.groups).values({ name: `Eval ${id} ${Date.now()}`, purpose: "roommates", onboardedAt: new Date() }).returning();
  // The day's greeting would add a hello to every scenario's first message; only the greeting scenarios keep it.
  if (!greet) await dbMoments.claim(group.id, "greeting", localDay(new Date(), group.timezone));
  const rows = await db
    .insert(schema.members)
    .values(EVAL_MEMBERS.map((name) => ({ groupId: group.id, displayName: name, role: name === "Maya" ? ("admin" as const) : ("member" as const), status: "active" as const })))
    .returning();
  const member = Object.fromEntries(rows.map((r) => [r.displayName, r.id])) as Record<EvalMember, string>;
  const as = (name: EvalMember) => ({ groupId: group.id, memberId: member[name], source: "chat" as const });
  return { ctx: as("Maya"), member, as };
}

const say = (env: EvalEnv, t: Turn) => {
  const name = t.from ?? "Maya";
  return respond({
    groupId: env.ctx.groupId,
    member: { id: env.member[name], displayName: name, role: name === "Maya" ? "admin" : "member", status: "active" },
    text: t.text,
    source: "chat",
    channel: "evals",
    isReplyToRoomie: t.isReplyToRoomie,
    ...(t.private ? { isPrivate: true } : {}),
    ...(t.photo && env.photo ? { imageUrl: env.photo } : {}),
  });
};
async function failures(x: Expect, r: PipelineResult, env: EvalEnv): Promise<string[]> {
  const out: string[] = [];
  const reply = r.out?.text ?? "";
  const speaks = x.speaks ?? true;
  if (speaks !== !!r.out) out.push(speaks ? "stayed quiet" : "spoke");
  if (!speaks) return out;
  for (const t of x.tools ?? []) if (!r.toolCalls.includes(t)) out.push(`no ${t}`);
  const banned = x.noTools === "actions" ? r.toolCalls.filter((t) => !READ_ONLY_TOOLS.has(t)) : r.toolCalls.filter((t) => (x.noTools ?? []).includes(t));
  if (banned.length) out.push(`called ${banned.join(",")}`);
  for (const s of x.replyIncludes ?? []) {
    const ok = typeof s === "string" ? reply.toLowerCase().includes(s.toLowerCase()) : s.test(reply);
    if (!ok) out.push(`reply lacks ${s}`);
  }
  for (const s of x.excludes ?? []) {
    const hit = typeof s === "string" ? reply.toLowerCase().includes(s.toLowerCase()) : s.test(reply);
    if (hit) out.push(`reply has ${s}`);
  }
  if (x.asks && !reply.includes("?") && !reply.includes("¿")) out.push("doesn't ask");
  const shape = shapeOf(reply);
  if (!x.long && shape.tooLong) out.push(`${shape.lines} lines`);
  if (x.maxLines !== undefined && shape.lines > x.maxLines) out.push(`${shape.lines} lines > ${x.maxLines}`);
  const emoji = countEmoji(reply);
  if (x.emoji?.min !== undefined && emoji < x.emoji.min) out.push(`${emoji} emoji < ${x.emoji.min}`);
  if (x.emoji?.max !== undefined && emoji > x.emoji.max) out.push(`${emoji} emoji > ${x.emoji.max}`);
  if (x.noButtons && r.out?.buttons?.length) out.push("has buttons");
  if (x.reacts !== undefined) {
    const want = x.reacts === true ? !!r.out?.react : r.out?.react === x.reacts;
    if (!want) out.push(r.out?.react ? `reacted ${r.out.react}` : "no reaction");
  }
  if (x.reactionOnly && r.out?.text.trim()) out.push("a line next to the reaction");
  if (x.noReaction && r.out?.react) out.push(`reacted ${r.out.react} instead of replying`);
  if (x.gateReason && r.gate.reason !== x.gateReason) out.push(`gate ${r.gate.reason}`);
  if (shape.bullets || shape.headers) out.push("bullets/headers");
  if (x.check) {
    const err = await x.check(env, reply);
    if (err) out.push(err);
  }
  return out;
}

const rateLimited = (r: PipelineResult | null, err: unknown) => /429|rate limit|REQUEST_LIMIT/i.test(`${r?.gate.jevError ?? ""} ${err instanceof Error ? err.message : err ?? ""}`);

type Row = { s: Scenario; pass: boolean; why: string; gate: string; tools: string; reply: string; ms: number };

async function runOne(s: Scenario): Promise<Row> {
  for (let attempt = 1; ; attempt++) {
    const env = await createGroup(s.id, s.greet);
    const started = Date.now();
    let r: PipelineResult | null = null;
    let err: unknown;
    try {
      await s.seed?.(env);
      for (const t of s.setup ?? []) await say(env, t);
      r = await say(env, s.turn);
    } catch (e) {
      err = e;
    }
    try {
      if (rateLimited(r, err) && attempt < MAX_ATTEMPTS) {
        console.log(`  ${s.id}: rate limited, retrying in ${RATE_LIMIT_WAIT_MS / 1000}s`);
        await new Promise((ok) => setTimeout(ok, RATE_LIMIT_WAIT_MS));
        continue;
      }
      const ms = Date.now() - started;
      if (!r) return { s, pass: false, why: `error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 160), gate: "-", tools: "-", reply: "", ms };
      const main = await failures(s.expect, r, env);
      const alt = s.alt && main.length ? await failures(s.alt, r, env) : null;
      const pass = main.length === 0 || (alt !== null && alt.length === 0);
      return {
        s,
        pass,
        why: pass ? "" : main.join("; ") + (alt ? ` | alt: ${alt.join("; ")}` : ""),
        gate: `${r.gate.decision}/${r.gate.reason}${r.gate.toolkit ? `/${r.gate.toolkit}` : ""}`,
        tools: r.toolCalls.filter((t) => t !== "updateWorkingMemory").join(",") || "-",
        reply: (r.out ? [r.out.react ? `(reacted ${r.out.react})` : "", r.out.text].filter(Boolean).join(" ") : "(quiet)").replace(/\s+/g, " "),
        ms,
      };
    } finally {
      if (env.photo) await rm(path.join("public", env.photo), { force: true }).catch(() => {});
      await deleteGroup(env.ctx.groupId).catch((e) => console.error(`cleanup failed for ${s.id}`, e));
    }
  }
}

const cell = (s: string, n: number) => s.replace(/\|/g, "/").slice(0, n);

await assertNotProdDb(db, "evals");
const picked = SCENARIOS.filter((s) => !only || only.has(s.id));
const rows: Row[] = [];
for (const s of picked) {
  const row = await runOne(s);
  rows.push(row);
  console.log(`${row.pass ? "PASS" : "FAIL"} ${s.id.padEnd(30)} ${row.gate.padEnd(28)} ${row.tools.padEnd(22)} ${(row.ms / 1000).toFixed(1)}s ${row.why}`);
}

const passed = rows.filter((r) => r.pass).length;
const rate = rows.length ? Math.round((passed / rows.length) * 100) : 0;
const table = [
  "| scenario | area | gate | tools | pass | why | reply |",
  "|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.s.id} | ${r.s.area} | ${r.gate} | ${r.tools} | ${r.pass ? "✅" : "❌"} | ${cell(r.why, 120)} | ${cell(r.reply, 110)} |`),
].join("\n");
console.log(`\n${table}\n\npass rate: ${passed}/${rows.length} (${rate}%)`);

if (writeBaseline) {
  const avg = rows.reduce((s, r) => s + r.ms, 0) / Math.max(1, rows.length) / 1000;
  writeFileSync(
    "docs/evals-baseline.md",
    `# Eval baseline

\`npm run evals\` on ${new Date().toISOString().slice(0, 10)}: **${passed}/${rows.length} (${rate}%)**, ${avg.toFixed(1)} s per scenario on average.
Agent \`${process.env.LLM_MODEL ?? "claude-sonnet-5-5"}\`, Gate \`${process.env.GATE_MODEL ?? "typesafeai-jev-1-14-0"}\` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in \`src/mastra/evals/scenarios.ts\`; gate = decision/reason/toolkit, tools = what the agent called.

${table}
`,
  );
  console.log("wrote docs/evals-baseline.md");
}

await mastra.observability.flush().catch(() => {});
await db.$client.end();
process.exit(passed === rows.length ? 0 : 1);
