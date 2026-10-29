// npm run telegram:check: is everything ready for Roomie's first real Telegram group? Read-only: getMe and
// getWebhookInfo on Telegram (no messages, no polling, the webhook is left alone), one select on the DB, a 1-token
// Haiku call and one Jev call on the gateway. Prints what it found (the token is never printed) and exits non-zero with
// a plain-English fix when something would break the first run.
import "../src/lib/env";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";

type Status = "ok" | "warn" | "fail";
const rows: { status: Status; what: string; detail: string; fix?: string }[] = [];
const note = (status: Status, what: string, detail: string, fix?: string) => rows.push({ status, what, detail, fix });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/bot\d+:[\w-]+/g, "bot<token>").slice(0, 200);

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
const tg = async <T>(method: string): Promise<T> => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { signal: AbortSignal.timeout(10_000) });
  const body = (await res.json()) as { ok: boolean; result?: T; description?: string; error_code?: number };
  if (!body.ok) throw new Error(`${body.error_code ?? res.status} ${body.description ?? ""}`.trim());
  return body.result as T;
};

/* ---------- Telegram ---------- */
if (!token) {
  note("fail", "Telegram token", "TELEGRAM_BOT_TOKEN is not set", "Put the token BotFather gave you in .env as TELEGRAM_BOT_TOKEN (docs/telegram.md).");
} else {
  try {
    const me = await tg<{ id: number; username: string; can_join_groups?: boolean; can_read_all_group_messages?: boolean }>("getMe");
    note("ok", "Telegram bot", `@${me.username} (id ${me.id})`);
    if (username && username.toLowerCase() !== me.username.toLowerCase()) {
      note("fail", "TELEGRAM_BOT_USERNAME", `.env says @${username}, the token belongs to @${me.username}`, `Set TELEGRAM_BOT_USERNAME=${me.username} in .env.`);
    } else if (!username) {
      note("warn", "TELEGRAM_BOT_USERNAME", "not set (polling works; the webhook and the intro's @handle need it)", `Add TELEGRAM_BOT_USERNAME=${me.username} to .env.`);
    } else note("ok", "TELEGRAM_BOT_USERNAME", `@${username}`);
    note(me.can_join_groups ? "ok" : "fail", "can_join_groups", String(!!me.can_join_groups), "BotFather -> /mybots -> Bot Settings -> Allow Groups? -> Turn groups on.");
    note(
      me.can_read_all_group_messages ? "ok" : "fail",
      "can_read_all_group_messages",
      me.can_read_all_group_messages ? "true (privacy mode off: Roomie sees every message)" : "false (privacy mode on: Roomie only sees /commands and replies)",
      "BotFather -> /setprivacy -> pick the bot -> Disable. Then remove Roomie from the group and add it again (Telegram applies it on join).",
    );
  } catch (e) {
    const m = msg(e);
    note("fail", "Telegram bot", m, /401|Unauthorized/i.test(m) ? "Telegram rejected the token. Copy it again from BotFather (/mybots -> API Token) into TELEGRAM_BOT_TOKEN." : "Couldn't reach api.telegram.org. Check the network, then run this again.");
  }
  try {
    const w = await tg<{ url: string; pending_update_count: number; last_error_message?: string }>("getWebhookInfo");
    if (w.url) note("warn", "Webhook", `set to ${w.url} (${w.pending_update_count} pending)${w.last_error_message ? `, last error: ${w.last_error_message}` : ""}`, "Fine for production. For the local test, `npm run telegram` deletes it when it starts and polls instead.");
    else note("ok", "Webhook", `none, so \`npm run telegram\` can poll (${w.pending_update_count} update${w.pending_update_count === 1 ? "" : "s"} waiting)`);
  } catch (e) {
    note("warn", "Webhook", `getWebhookInfo failed: ${msg(e)}`);
  }
}

/* ---------- the app's settings ---------- */
const appUrl = process.env.APP_URL?.trim();
if (!appUrl) note("warn", "APP_URL", "not set: dashboard links can't be sent", "Set APP_URL=http://localhost:3000 for now, or a tunnel URL (cloudflared tunnel --url http://localhost:3000) to get real buttons.");
else if (/^https?:\/\/(localhost|127\.|0\.0\.0\.0)/.test(appUrl)) note("warn", "APP_URL", `${appUrl}: links come as text (Telegram refuses localhost buttons)`, "For buttons that open on a phone: cloudflared tunnel --url http://localhost:3000, then APP_URL=<the https://...trycloudflare.com URL>.");
else if (!appUrl.startsWith("https://")) note("warn", "APP_URL", `${appUrl}: not https, so Telegram may refuse the buttons`, "Use an https URL (a tunnel works).");
else {
  // Our webhook answers 401 to a POST without the secret: a cheap "is this Roomie?" that changes nothing.
  const probe = await fetch(`${appUrl.replace(/\/$/, "")}/api/telegram`, { method: "POST", signal: AbortSignal.timeout(8_000) }).then(
    (r) => r.status,
    () => null,
  );
  const tunnel = /\.(trycloudflare\.com|ngrok(-free)?\.(app|dev|io))$/i.test(new URL(appUrl).hostname);
  if (probe === null) note("warn", "APP_URL", `${appUrl} doesn't answer`, "Start `npm run dev` (and the tunnel), or point APP_URL at http://localhost:3000 for now.");
  else if (probe !== 401) note("warn", "APP_URL", `${appUrl} answers, but not like Roomie (POST /api/telegram gave ${probe})`, "Point APP_URL at your `npm run dev` (localhost or a tunnel to it).");
  else if (!tunnel) note("warn", "APP_URL", `${appUrl} answers like Roomie, but it's a deployed app, not this machine`, "Claim links and buttons open that server: fine only if it runs this branch on the same DATABASE_URL. For the local test: a tunnel to `npm run dev`, or http://localhost:3000.");
  else note("ok", "APP_URL", `${appUrl} (a tunnel that answers like Roomie: buttons will open on phones)`);
}

const join = process.env.JOIN_DELAY_MS?.trim();
const reply = process.env.REPLY_DELAY_MS?.trim();
note(join === "0" ? "ok" : "warn", "JOIN_DELAY_MS", join ? `${join} ms` : "unset (60000 ms: the intro comes a minute after Roomie joins)", join === "0" ? undefined : "For the first test run, JOIN_DELAY_MS=0 makes the intro come right away (put it back later: ADR 0001).");
note("ok", "REPLY_DELAY_MS", reply ? `${reply} ms after "typing"` : 'unset (600-1800 ms after "typing")');

/* ---------- Toolkits ---------- */
try {
  const { core, TOOLKITS } = await import("../src/toolkits/registry");
  const list = [core, ...TOOLKITS].map((t) => `${t.id} (${Object.keys(t.tools).length})`);
  note("ok", "Toolkits", list.join(", "));
} catch (e) {
  note("fail", "Toolkits", `the registry didn't load: ${msg(e)}`, "Run `npm run typecheck` and fix what it reports.");
}

/* ---------- database ---------- */
const { db } = await import("../src/db");
try {
  await db.execute(sql`select 1`);
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] };
  const applied = Number(((await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows[0] as { n: number }).n);
  if (applied < journal.entries.length) note("fail", "Database", `reachable, but ${journal.entries.length - applied} migration(s) not applied`, "Run `npm run db:migrate`.");
  else {
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from groups g join chats c on c.group_id = g.id where c.channel = 'telegram'`)).rows as { n: number }[];
    note("ok", "Database", `reachable, ${applied} migrations applied, ${n} Telegram group${n === 1 ? "" : "s"} so far`);
  }
} catch (e) {
  note("fail", "Database", msg(e), "Check DATABASE_URL in .env (the Neon connection string), then `npm run db:migrate`.");
}

/* ---------- gateway: the agent's models and Jev ---------- */
const base = (process.env.NEON_AI_GATEWAY_BASE_URL ?? "").replace(/\/+$/, "");
const gwToken = process.env.NEON_AI_GATEWAY_TOKEN;
const gatewayFix = (m: string) =>
  /401|403/.test(m)
    ? "The gateway refused the token. If .env looks right, a system env var may be shadowing it: in PowerShell run `Remove-Item Env:NEON_AI_GATEWAY_BASE_URL` (and _TOKEN), or fix them in .env."
    : /429/.test(m)
      ? "Rate limited right now. Wait a minute and run this again."
      : "Check NEON_AI_GATEWAY_BASE_URL and NEON_AI_GATEWAY_TOKEN in .env.";
if (!base || !gwToken) {
  note("fail", "AI gateway", "NEON_AI_GATEWAY_BASE_URL / NEON_AI_GATEWAY_TOKEN not set", "Copy both from the Neon console (AI Gateway) into .env.");
} else {
  const small = process.env.SMALL_MODEL ?? "claude-haiku-5-5";
  try {
    const started = Date.now();
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${gwToken}`, "content-type": "application/json" },
      body: JSON.stringify({ model: small, max_tokens: 1, messages: [{ role: "user", content: "Say hi" }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
    note("ok", "AI gateway", `${small} answered in ${Date.now() - started} ms (agent: ${process.env.LLM_MODEL ?? "claude-sonnet-5-5"})`);
  } catch (e) {
    note("fail", "AI gateway", `${small}: ${msg(e)}`, gatewayFix(msg(e)));
  }
  try {
    const { askJev, jevState, gateModel } = await import("../src/mastra/gate/jev");
    const started = Date.now();
    const { answers } = await askJev(jevState({ latest: "[Maya] roomie, who owes what?", members: ["Maya", "Dev"] }), 8_000);
    note("ok", "Jev (the Gate)", `${gateModel()} answered in ${Date.now() - started} ms (act ${answers.intent.act.toFixed(2)} for "roomie, who owes what?")`);
  } catch (e) {
    note("fail", "Jev (the Gate)", msg(e), `${gatewayFix(msg(e))} Without Jev Roomie still answers when someone says "roomie", but never chimes in.`);
  }
}

await db.$client.end().catch(() => {});

/* ---------- report ---------- */
const icon: Record<Status, string> = { ok: "ok  ", warn: "warn", fail: "FAIL" };
const width = Math.max(...rows.map((r) => r.what.length));
console.log("\nRoomie on Telegram: readiness check (read-only)\n");
for (const r of rows) {
  console.log(`  ${icon[r.status]}  ${r.what.padEnd(width)}  ${r.detail}`);
  if (r.fix && r.status !== "ok") console.log(`        ${" ".repeat(width)}  -> ${r.fix}`);
}
const failed = rows.filter((r) => r.status === "fail");
const warned = rows.filter((r) => r.status === "warn");
console.log(
  failed.length
    ? `\n${failed.length} thing${failed.length === 1 ? "" : "s"} to fix before the first group test (see -> above).`
    : `\nReady${warned.length ? ` (${warned.length} note${warned.length === 1 ? "" : "s"} above)` : ""}. Next: docs/first-group-test.md.`,
);
process.exit(failed.length ? 1 : 0);
