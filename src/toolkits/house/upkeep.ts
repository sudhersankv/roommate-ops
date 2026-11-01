import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { report, upkeep } from "@/services";
import type { MaintenanceItem } from "@/services/upkeep";
import { ctxOf } from "../util";

const brief = (m: MaintenanceItem) => ({
  item: m.item,
  every: `every ${m.everyDays} days`,
  status: m.status,
  due: m.dueIn < 0 ? report.dueWord(m.dueIn, m.dueDay) : m.dueIn === 0 ? "due today" : `due ${m.dueDay} (in ${m.dueIn} days)`,
  lastDone: m.lastDone ? "yes" : "never marked done",
  whoseTurn: m.whoseTurn,
});

export const upkeepTools = {
  upkeep_add: createTool({
    id: "upkeep_add",
    description:
      "Track recurring house care ('change the AC filter every 90 days', 'smoke detector batteries every 6 months'). Same name again updates the cadence. usual: true adds the usual five (filter, smoke alarms, dryer vent, coffee maker, fire extinguisher).",
    inputSchema: z.object({
      item: z.string().optional().describe("e.g. 'Replace HVAC filter'"),
      everyDays: z.number().int().positive().optional().describe("How often, in days (6 months = 180)"),
      usual: z.boolean().optional().describe("Add the usual five instead"),
    }),
    execute: async ({ item, everyDays, usual }, context) => {
      const ctx = ctxOf(context);
      if (usual) return { added: await upkeep.addDefaults(ctx) };
      if (!item) throw new Error("Which item, and how often?");
      return upkeep.addMaintenance(ctx, { item, everyDays: everyDays ?? 0 });
    },
  }),
  upkeep_done: createTool({
    id: "upkeep_done",
    description:
      "Mark an upkeep item done today by the sender ('changed the air filter', 'tested the smoke alarms'). Fuzzy name match; returns when it's due next and nextUp, whose turn it is next time.",
    inputSchema: z.object({ item: z.string().min(1) }),
    execute: async ({ item }, context) => upkeep.markDone(ctxOf(context), { item }),
  }),
  upkeep_skip: createTool({
    id: "upkeep_skip",
    description: "The sender passes their turn on an upkeep item ('can someone else do the air filter', 'pass on the smoke alarms'). Only whoever's turn it is can pass; returns nextUp.",
    inputSchema: z.object({ item: z.string().min(1) }),
    execute: async ({ item }, context) => upkeep.skipUpkeep(ctxOf(context), { item }),
  }),
  upkeep_status: createTool({
    id: "upkeep_status",
    description:
      "Upkeep items with when they're due (overdue / due soon = within 7 days / ok) and whoseTurn, soonest first. For 'what's due this week' use dueOnly; 'whose turn is the air filter' is this too.",
    inputSchema: z.object({ dueOnly: z.boolean().optional().describe("true = only overdue or due within 7 days") }),
    execute: async ({ dueOnly }, context) => {
      const ctx = ctxOf(context);
      const list = dueOnly ? await upkeep.dueMaintenance(ctx) : await upkeep.listMaintenance(ctx);
      return { items: list.map(brief), tracked: dueOnly ? undefined : list.length };
    },
  }),
  upkeep_remove: createTool({
    id: "upkeep_remove",
    description: "Admin only: stop tracking an upkeep item.",
    inputSchema: z.object({ item: z.string().min(1) }),
    execute: async ({ item }, context) => upkeep.removeMaintenance(ctxOf(context), { item }),
  }),
};
