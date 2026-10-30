import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { chores, report } from "@/services";
import type { ChoreStatus } from "@/services/chores";
import { ctxOf, memberIdByName } from "../util";

const dueText = (c: ChoreStatus) => (c.dueIn < 0 ? report.dueWord(c.dueIn, c.dueDay) : c.dueIn === 0 ? "due today" : `due ${report.dueWord(c.dueIn, c.dueDay)}`);

/** What the model reads for one chore: plain words, no ids it could mix up. */
const brief = (c: ChoreStatus) => ({
  chore: c.name,
  every: c.everyDays === 1 ? "every day" : `every ${c.everyDays} days`,
  whoseTurn: c.whoseTurn,
  rotation: c.rotation ? c.order.map((p) => p.name) : "everyone, whoever did it least recently goes next",
  status: c.state,
  due: dueText(c),
  lastDone: c.lastDoneBy ? `${c.lastDoneBy} on ${c.lastDoneDay}` : "never",
  streak: c.lastDoneBy && c.streak > 1 ? `${c.lastDoneBy} ${c.streak} on time in a row` : undefined,
});

export const choreTools = {
  log_chore: createTool({
    id: "log_chore",
    description:
      "Record a chore someone did: 'I did the dishes' (the sender), 'Dev took out the trash' (who: Dev). Free-text chore name, fuzzy-matched to the chart and added if new. Returns whose turn is next.",
    inputSchema: z.object({
      chore: z.string().min(1).describe("Free text, e.g. 'the dishes', 'trash'"),
      who: z.string().optional().describe("Member name when someone else did it; omit for the sender"),
    }),
    execute: async ({ chore, who }, context) => {
      const ctx = ctxOf(context);
      return chores.logChore(ctx, { chore, memberId: who ? await memberIdByName(ctx, who) : undefined });
    },
  }),
  chore_add: createTool({
    id: "chore_add",
    description:
      "Put a recurring chore on the chart ('add vacuuming every 7 days', 'mopping every 3 days: Sam, then Dev, then me'). rotation = member names in turn order; omit it for everyone (least recent goes next). Same name again updates it.",
    inputSchema: z.object({
      name: z.string().min(1),
      everyDays: z.number().int().positive().optional().describe("How often, in days. Default 7."),
      rotation: z.array(z.string()).optional().describe("Member names in turn order ('me' = the sender)"),
    }),
    execute: async ({ name, everyDays, rotation }, context) => {
      const ctx = ctxOf(context);
      const ids = rotation ? await Promise.all(rotation.map((n) => (/^(me|myself|i)$/i.test(n.trim()) ? ctx.memberId : memberIdByName(ctx, n)))) : undefined;
      return chores.addChore(ctx, { name, everyDays, rotation: ids });
    },
  }),
  chore_remove: createTool({
    id: "chore_remove",
    description: "Admin only: take a chore off the chart (its history goes too).",
    inputSchema: z.object({ chore: z.string().min(1) }),
    execute: async ({ chore }, context) => chores.removeChore(ctxOf(context), { chore }),
  }),
  chore_status: createTool({
    id: "chore_status",
    description: "The chore chart: each chore's whose turn, rotation, due / overdue, last done and streak, latest first. For 'whose turn is trash', 'what's due', 'what's overdue'.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const list = await chores.choreStatus(ctxOf(context));
      return { chores: list.map(brief), dueOrOverdue: list.filter((c) => c.state !== "ok").map((c) => c.name) };
    },
  }),
  chore_skip: createTool({
    id: "chore_skip",
    description: "The sender passes their turn on a chore ('skip my turn on trash'); the next person in the rotation is up. Only for whoever's turn it is.",
    inputSchema: z.object({ chore: z.string().optional().describe("Which chore; omit when only one is on the sender right now") }),
    execute: async ({ chore }, context) => {
      const ctx = ctxOf(context);
      let name = chore;
      if (!name) {
        const mine = (await chores.choreStatus(ctx)).filter((c) => c.whoseTurnId === ctx.memberId);
        const due = mine.filter((c) => c.state !== "ok");
        const pick = due.length === 1 ? due[0] : mine.length === 1 ? mine[0] : undefined;
        if (!pick) throw new Error(mine.length ? `Which one? It's your turn on ${mine.map((c) => c.name).join(", ")}.` : "It isn't your turn on anything right now.");
        name = pick.name;
      }
      return chores.skipChore(ctx, { chore: name });
    },
  }),
  hall_of_shame: createTool({
    id: "hall_of_shame",
    description: "'The chart': who's done the fewest chores this week, worst first, with a ready-to-say line. For 'who's slacking', 'has Dev done anything this week'. Keep it friendly.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const rows = await chores.hallOfShame(ctxOf(context));
      return { line: chores.chartLine(rows), rows };
    },
  }),
};
