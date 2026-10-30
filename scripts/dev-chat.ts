// npm run dev-chat [-- --chat <id>] [-- --cleanup]
// A pretend WhatsApp group in the terminal, through the real pipeline (Gate + agent + tools) and the dev Channel.
// Commands (names are display names; quotes around text are optional):
//   join <adder> [others...]   Roomie is added to the Chat by <adder>; <others> were already in it (Onboarding)
//   add <name>                 someone joins later (Pending; Roomie asks the Admins)
//   say <name> <text>          a message in the Chat ("say Maya roomie who owes what")
//   photo <name> <path|url> [caption]  a photo (e.g. a receipt), stored under public/uploads/dev/ and sent with the caption
//   ledger [n]                 the last n Expenses (cents, method, Payers, Shares) and Balances, straight from services
//   cart [total]               open Cart items; with a total, the split "Maya paid <total>" would save
//   approve <name> [by <admin>] approve a Pending member directly (no LLM)
//   link <name>                mint a Claim link for <name> and print it
//   who                        Members with role and status
//   quit
// --chat attaches to an existing dev Chat (the seed's is "dev-apt-4b"); otherwise a new one is made on `join`.
// --cleanup deletes the Group on exit. Lines can be piped in: `Get-Content walk.txt | npm run dev-chat`.
// Splitwise and Instacart use their fakes when COMPOSIO_API_KEY is missing or rejected (each says so once at start).
import "../src/lib/env";
import { createInterface } from "node:readline";
import { registerChannel } from "../src/channels";
import { DevChannel, devUserId, type DevOutput } from "../src/channels/dev";
import { db } from "../src/db";
import { mastra } from "../src/mastra";
import { onGroupJoined, onParticipantJoined } from "../src/onboarding";
import { respondToIncoming } from "../src/pipeline";
import { cart, claims, groups, members, money, receipts } from "../src/services";
import { useFakeSplitwiseIfUnavailable } from "../src/integrations/splitwise";
import { useFakeInstacartIfUnavailable } from "../src/integrations/instacart";
import { assertNotProdDb } from "./lib/prod-guard";
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
let chatId = flag("--chat") ?? `dev-${Date.now()}`;
const cleanup = args.includes("--cleanup");
const interactive = process.stdin.isTTY;

const names = new Map<string, string>(); // dev user id -> display name
const nameOf = (userId: string) => names.get(userId) ?? userId;
const user = (name: string) => {
  const id = devUserId(name);
  names.set(id, name);
  return { userExternalId: id, name };
};

function show(out: DevOutput) {
  const head = out.to === "chat" ? "[Roomie]" : `[Roomie -> ${nameOf(out.userExternalId)}, private]`;
  console.log(`${head} ${out.msg.text.replace(/\n/g, "\n         ")}`);
  for (const b of out.msg.buttons ?? []) console.log(`         [button] ${b.text} -> ${b.url}`);
}
registerChannel(new DevChannel(show));

const unquote = (s: string) => s.trim().replace(/^["'](.*)["']$/s, "$1");

async function groupId(): Promise<string> {
  const found = await groups.chatFor("dev", chatId);
  if (!found) throw new Error(`No Chat "${chatId}" yet. Start with: join <name>`);
  return found.group.id;
}

async function memberNamed(name: string) {
  const gid = await groupId();
  const m = (await members.listGroupMembers({ groupId: gid })).find((x) => x.displayName.toLowerCase() === name.toLowerCase());
  if (!m) throw new Error(`No member named ${name}.`);
  return { gid, m };
}

async function send(name: string, text: string, imageUrl?: string) {
  const u = user(name);
  console.log(`[${u.name}] ${imageUrl ? `(photo ${imageUrl}) ` : ""}${text}`);
  const started = Date.now();
  const r = await respondToIncoming({ channel: "dev", chatExternalId: chatId, userExternalId: u.userExternalId, userName: u.name, text, imageUrl });
  const tools = r.toolCalls.filter((t) => t !== "updateWorkingMemory");
  console.log(`         (gate ${r.gate.decision}/${r.gate.reason}${tools.length ? `, tools ${tools.join(",")}` : ""}, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (r.out) show({ to: "chat", chatExternalId: chatId, msg: r.out });
  else console.log("         (Roomie stays quiet)");
}

async function run(line: string) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  const tail = line.trim().slice(cmd.length).trim();
  switch (cmd?.toLowerCase()) {
    case "join": {
      const [adder, ...others] = rest.map(unquote);
      if (!adder) throw new Error("join <adder> [others...]");
      const res = await onGroupJoined({ channel: "dev", externalId: chatId, title: flag("--title") ?? "Dev chat" }, [adder, ...others].map(user), user(adder));
      if (!res.created) return console.log(`(Chat ${chatId} already has Group ${res.group.id})`);
      console.log(`(Group ${res.group.id} created; ${res.members.map((m) => `${m.displayName} ${m.role}/${m.status}`).join(", ")})`);
      // A real adapter waits 1-3 minutes before this first message (ADR 0001).
      if (res.intro) show({ to: "chat", chatExternalId: chatId, msg: res.intro });
      if (res.setupDm) show({ to: "private", userExternalId: res.members[0].channelUserId ?? adder, msg: res.setupDm });
      return;
    }
    case "add": {
      const name = unquote(tail);
      const res = await onParticipantJoined(await groupId(), user(name));
      console.log(`(${res.member.displayName} is ${res.member.status})`);
      if (res.announce) show({ to: "chat", chatExternalId: chatId, msg: res.announce });
      return;
    }
    case "say": {
      const [name] = rest;
      return send(unquote(name), unquote(tail.slice(name.length)));
    }
    case "photo": {
      // photo <name> <path-or-url> [caption]: the file goes to public/uploads/dev/ like a Channel adapter would store it.
      const [name, src, ...words] = rest.map(unquote);
      if (!name || !src) throw new Error("photo <name> <path-or-url> [caption]");
      const bytes = /^https?:\/\//i.test(src) ? Buffer.from(await (await fetch(src)).arrayBuffer()) : await readFile(src);
      const mime = /\.png$/i.test(src) ? "image/png" : /\.webp$/i.test(src) ? "image/webp" : "image/jpeg";
      const saved = await receipts.saveUpload("dev", bytes, mime);
      const imageUrl = saved.url || saved.path;
      return send(name, unquote(words.join(" ")), imageUrl);
    }
    case "approve": {
      const byAt = rest.findIndex((x) => x.toLowerCase() === "by");
      const name = unquote((byAt === -1 ? rest : rest.slice(0, byAt)).join(" "));
      const { gid, m } = await memberNamed(name);
      const admin = byAt === -1 ? (await members.admins({ groupId: gid }))[0] : (await memberNamed(rest.slice(byAt + 1).join(" "))).m;
      await members.approveMember({ groupId: gid, memberId: admin.id, source: "chat" }, { memberId: m.id });
      return console.log(`(${admin.displayName} approved ${m.displayName})`);
    }
    case "link": {
      const { m } = await memberNamed(unquote(tail));
      const link = await claims.createClaimToken(m.id);
      return console.log(`(Claim link for ${m.displayName}, single use, until ${link.expiresAt.toISOString()}): ${link.url}`);
    }
    case "ledger": {
      // The numbers straight from the services (no LLM), to compare with the dashboard to the cent.
      const gid = await groupId();
      for (const e of await money.listExpenses({ groupId: gid }, Number(tail) || 5)) {
        const paid = (e.payers ?? []).map((p) => `${p.name} ${p.cents}`).join(" + ");
        const owe = (e.splits ?? []).map((s) => `${s.name} ${s.cents}${s.weight != null ? ` (${s.weight})` : ""}`).join(", ");
        console.log(`  ${e.occurredOn} ${e.description} ${e.cents}c [${e.method}, ${e.category}] paid: ${paid} | shares: ${owe}`);
      }
      console.log(`  balances: ${(await money.getBalances({ groupId: gid })).map((b) => `${b.name} ${b.cents}`).join(", ")}`);
      return;
    }
    case "cart": {
      // Open items (and, with a total, the split "I paid" would save), straight from services.
      const gid = await groupId();
      const items = await cart.listOpenItems({ groupId: gid });
      for (const i of items) console.log(`  ${i.name} ${i.qty} [${i.shared ? "shared" : i.addedByName}${i.recipeTitle ? `, ${i.recipeTitle}` : ""}]`);
      const total = Math.round(Number(tail) * 100);
      if (total > 0) {
        const people = await members.listMembers({ groupId: gid });
        const rows = cart.computeCartSplits(items.map((i) => ({ addedBy: i.addedBy!, shared: i.shared, estCents: i.estCents })), people.map((m) => m.id), total, people.find((m) => m.displayName === "Maya")?.id);
        console.log(`  if Maya paid ${total}c: ${rows.map((r) => `${people.find((m) => m.id === r.memberId)?.displayName} ${r.cents}`).join(", ")}`);
      }
      return;
    }
    case "who": {
      const gid = await groupId();
      for (const m of await members.listGroupMembers({ groupId: gid })) console.log(`  ${m.displayName.padEnd(12)} ${m.role.padEnd(7)} ${m.status}${m.accountId ? "  (has an Account)" : ""}`);
      return;
    }
    case "chat":
      chatId = unquote(tail);
      return console.log(`(now in Chat ${chatId})`);
    case "quit":
    case "exit":
      return "quit";
    case "":
    case undefined:
      return;
    default:
      if (cmd.startsWith("#")) return; // comments in piped scripts
      throw new Error(`Unknown command "${cmd}". Try: join, add, say, photo, approve, link, ledger, cart, who, quit`);
  }
}

await assertNotProdDb(db, "dev-chat");
await useFakeSplitwiseIfUnavailable();
await useFakeInstacartIfUnavailable();
console.log(`dev-chat on Chat "${chatId}". Commands: join, add, say, photo, approve, link, ledger, cart, who, quit`);
const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> ", terminal: interactive });
if (interactive) rl.prompt();
for await (const line of rl) {
  if (!interactive && line.trim() && !line.trim().startsWith("#")) console.log(`\n> ${line.trim()}`);
  try {
    if ((await run(line)) === "quit") break;
  } catch (e) {
    console.log(`(error) ${e instanceof Error ? e.message : String(e)}`);
  }
  if (interactive) rl.prompt();
}
rl.close();

if (cleanup) {
  const found = await groups.chatFor("dev", chatId);
  if (found) await groups.deleteGroup(found.group.id);
  console.log("(Group deleted)");
}
await mastra.observability.flush().catch(() => {});
await db.$client.end();
process.exit(0);
