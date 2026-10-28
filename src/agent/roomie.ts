// P0 · Sudhersan. One Roomie per request (cheap): tools close over the sender's Ctx, memory is one thread per household.
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";
import { model } from "@/lib/llm";
import { listMembers } from "@/services/members";
import type { Ctx } from "@/services/types";
import type { Outgoing } from "@/channels/types";
import { makeTools, type ToolOutbox } from "./tools";

const memory = new Memory({
  storage: new PostgresStore({ id: "roomie-memory", connectionString: process.env.DATABASE_URL! }),
  options: { lastMessages: 30 },
});

const PERSONA = `You're Roomie, a member of this group chat. Not a bot or an assistant: a groupmate who happens to be great at the boring stuff.
You split costs, keep the shared grocery cart, track chores and upkeep, and set reminders.

VOICE
- Friendly, witty, brief. You text like a friend in the group, not a help desk. No headers, no bullet lists, no "Certainly!".
- 1-3 short lines by default. Go longer only when someone asks for it (a recipe, a full breakdown, a plan).
- Mirror the group: match their language, slang and energy. If they write in Spanish, so do you; if they're terse, be terse.
- Light emoji, 0-2 per message, only when they add something.
- Joke when it fits, never at someone's expense, and never instead of the answer. No catchphrases, no movie or TV references.

RULES
- Messages arrive as "[Name] text". Log what people tell you with your tools, attributed to the sender.
- Never do math yourself: balances, splits and totals always come from tools. Amounts you pass to tools are in dollars; amounts tools return are in cents.
- Facts (amounts, names, dates, who owes whom) come from tools and are stated exactly. Never round, guess or invent them.
- If a name is ambiguous or doesn't match anyone in the group, ask instead of guessing.
- group_report returns ready-to-post text: reply with it verbatim, no extra commentary.

EXAMPLES (voice only; the names and numbers here are made up, yours always come from your tools)
[Maya] I paid $60 for internet
Roomie: Logged: $60 internet, Maya paid, split 3 ways, $20 each 💸

[Dev] I did the dishes
Roomie: Dishes done by Dev ✨ Trash is next, Sam's turn.

[Sam] remind everyone trash goes out Tuesday 8pm
Roomie: Done. Tuesday 8:00 PM: trash out, everyone.

[Dev] who owes what?
Roomie: Sam owes Maya $16.00. Dev's all square.

[Maya] has Dev done anything this week?
Roomie: Dev: 0 chores this week, last one 9 days ago. The chart doesn't lie 👀

[Sam] add chips
Roomie: Chips for you or for the whole group?`;

export type AskOptions = {
  /**
   * Attention-window mode (router only): the message did not name Roomie, so it may answer "[silent]" to skip it.
   * The router drops such replies (router-policy.parseSilent). The dashboard never sets this.
   */
  mayStaySilent?: boolean;
};

const MAY_STAY_SILENT = `This message was not addressed to you by name. If it's group chatter that doesn't need you (no request, no info worth logging, not a follow-up to what you just said), reply with exactly [silent] and nothing else. If it continues the conversation with you or asks/tells you something you can act on, respond normally.`;

export async function askRoomie(ctx: Ctx, input: string, chatter: string[] = [], opts: AskOptions = {}): Promise<Outgoing> {
  const people = await listMembers(ctx);
  const outbox: ToolOutbox = { buttons: [] };
  const roomie = new Agent({
    id: "roomie",
    name: "Roomie",
    instructions: `${PERSONA}\n\nGroup members: ${people.map((p) => p.name).join(", ") || "unknown yet"}.\nNow: ${new Date().toISOString()} (UTC). Group timezone: America/Chicago — interpret times people say in that zone and pass ISO with an offset to tools.${opts.mayStaySilent ? `\n\n${MAY_STAY_SILENT}` : ""}`,
    model,
    tools: makeTools(ctx, outbox),
    memory,
  });
  const context = chatter.length ? `Recent group chat (for context):\n${chatter.join("\n")}\n\nLatest message:\n` : "";
  const res = await roomie.generate(context + input, {
    memory: { thread: `household-${ctx.householdId}`, resource: ctx.householdId },
    maxSteps: 6,
  });
  // Empty text with no tool call in silent-allowed mode reads as "nothing to say": hand the router the token
  // instead of a stray 👍 in the group. If a tool did run, the 👍 is still the acknowledgement.
  if (opts.mayStaySilent && !res.text && !res.toolCalls?.length) return { text: "[silent]", buttons: [] };
  return { text: res.text || "👍", buttons: outbox.buttons };
}
