// Polls (ADR 0018) and the DM side's one switch (ADR 0020): ask_poll (who-questions only, the service sends and
// resolves it), group_decision (a pinned call put to the whole chat as a ✅ / ❌ poll, #42) and set_nudges ("roomie stop
// nudging me" / "nudge me again"). Thin: services/polls.ts and members.ts.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { members } from "@/services";
import { askGroupDecision, askPoll, GroupDecisionError, MAX_POLL_OPTIONS } from "@/services/polls";
import { EXPENSE_CATEGORIES } from "@/db/enums";
import { ctxOf, memberIdByName, toCents } from "../util";

export const pollTools = {
  ask_poll: createTool({
    id: "ask_poll",
    description:
      "Ask the group chat a poll, only when more than one person's answer is needed and it's a WHO question: who was in on an expense the payer said they're not sure about, who's shopping, which day. Never for how to split or whether something's shared. Up to 4 short options. For who was in on an expense, pass about (the amount, what it was, the payer): nothing is logged until the poll resolves (a majority voted, or 2 hours), then it's logged evenly among those who were in and the chat hears one line.",
    inputSchema: z.object({
      question: z.string().describe(`e.g. "Who's in on the $60 pizza?"`),
      options: z.array(z.string()).min(2).max(MAX_POLL_OPTIONS).describe(`Short options, e.g. ["I'm in", "Not me"], or the members' names`),
      multi: z.boolean().default(false).describe("Several options may be picked (names: true)"),
      about: z
        .object({
          amount: z.number().positive().describe("In the group's currency, as said"),
          description: z.string(),
          payer: z.string().optional().describe("Who paid; default the sender"),
          category: z.enum(EXPENSE_CATEGORIES).optional(),
        })
        .optional()
        .describe("Only for 'who was in on this expense'"),
    }),
    execute: async ({ question, options, multi, about }, context) => {
      const ctx = ctxOf(context);
      const payerId = about?.payer ? await memberIdByName(ctx, about.payer) : ctx.memberId;
      const res = await askPoll(ctx, {
        kind: about ? "who-in" : "question",
        question,
        options,
        multi,
        about: about ? { kind: "who-in", payerId, cents: toCents(about.amount), description: about.description, ...(about.category ? { category: about.category } : {}) } : { kind: "question" },
      });
      return {
        asked: true,
        ...(res.asText ? { answerWith: "a number" } : {}),
        say: "The poll is in the chat. Reply with one short line at most (e.g. 'Tap the poll'), don't repeat the options, and don't log anything: it's logged when the poll resolves.",
      };
    },
  }),
  group_decision: createTool({
    id: "group_decision",
    description:
      "Put ONE action to the whole chat as a ✅ / ❌ poll when it's a decision several people care about and someone suggested it without the others agreeing yet: a new shared chore with a rotation ('add Trash run every 3 days, Sreyas first?'), splitting a shared bill everyone pays ('split the $60 internet three ways?'), a reminder for everyone. " +
      "Not for routine adds or anything the sender clearly asked you to just do (then do it), never for admin changes. " +
      "Pin the exact call: `tool` is the tool you'd call and `input` its full input, with every person named (payer, rotation): it runs later as whoever taps ✅ first, so defaults like 'the sender' or 'me' would mean them. The first ✅ from any approved Member does it once, ❌ drops it, and after 30 minutes it lapses. Nothing happens until then.",
    inputSchema: z.object({
      question: z.string().describe(`Short, as a roommate would ask: "Add Trash run, every 3 days, Sreyas first?"`),
      tool: z.string().describe("The tool id to run on ✅, e.g. chore_add or log_expense"),
      input: z.record(z.string(), z.unknown()).describe("That tool's full input, exactly as you'd call it"),
    }),
    execute: async ({ question, tool, input }, context) => {
      const ctx = ctxOf(context);
      const rc = (context as { requestContext?: { get(key: string): unknown } } | undefined)?.requestContext;
      if (ctx.source !== "chat" || rc?.get("isPrivate") === true) return { asked: false, say: "Group decisions are asked in the group chat. Just ask this person, or do it if they asked." };
      try {
        await askGroupDecision(ctx, { question, toolId: tool, input });
      } catch (e) {
        if (e instanceof GroupDecisionError) return { asked: false, refused: e.message };
        throw e;
      }
      return {
        asked: true,
        say: "The poll is in the chat and nothing has changed yet. Say so in a few words at most (or nothing); don't repeat the question and don't do the action yourself: the first ✅ does it.",
      };
    },
  }),
  set_nudges: createTool({
    id: "set_nudges",
    description:
      "'roomie stop nudging me' (on: false) or 'nudge me again' (on: true): the sender's own private nudges (settle up, restock). Reminders they set still arrive. Confirm in one line.",
    inputSchema: z.object({ on: z.boolean() }),
    execute: async ({ on }, context) => {
      const r = await members.setNudges(ctxOf(context), { on });
      return { nudges: r.nudges, note: on ? "Nudges are back on." : "No more nudges. Reminders you set still come." };
    },
  }),
};
