// P3 · Sudhersan.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { chores } from "@/services";
import { ctxOf, memberIdByName } from "../util";

export const choreTools = {
  log_chore: createTool({
    id: "log_chore",
    description:
      "Record a chore someone did ('I did the dishes', 'took out trash', 'mark the trash as done for Alex'). Free-text chore name; it's fuzzy-matched to the chart and added if new. Default doer = sender.",
    inputSchema: z.object({
      chore: z.string().min(1).describe("Free text, e.g. 'the dishes', 'trash'"),
      who: z.string().optional().describe("Member name if not the sender"),
    }),
    execute: async ({ chore, who }, context) => {
      const ctx = ctxOf(context);
      return chores.logChore(ctx, { chore, memberId: who ? await memberIdByName(ctx, who) : undefined });
    },
  }),
  add_chore: createTool({
    id: "add_chore",
    description: "Put a recurring chore on the chart ('add vacuuming every 7 days'). Same name again just updates the cadence.",
    inputSchema: z.object({
      name: z.string().min(1),
      everyDays: z.number().int().positive().optional().describe("How often, in days. Default 7."),
    }),
    execute: async ({ name, everyDays }, context) => {
      await chores.addChore(ctxOf(context), { name, everyDays: everyDays ?? 7 });
      return { ok: true, chore: name.trim(), everyDays: everyDays ?? 7 };
    },
  }),
  chore_status: createTool({
    id: "chore_status",
    description: "Chores: last done, overdue, whose turn, and the Hall of Shame (worst first).",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = ctxOf(context);
      return { chores: await chores.choreStatus(ctx), shame: await chores.hallOfShame(ctx) };
    },
  }),
};
