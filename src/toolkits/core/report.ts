import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { groups, report } from "@/services";
import { ctxOf } from "../util";

export const reportTools = {
  group_report: createTool({
    id: "group_report",
    description:
      "The full Group Report: balances, settle plan, chores, Hall of Shame, upcoming reminders, upkeep. Returns ready-to-post text; reply with it verbatim.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = ctxOf(context);
      const group = await groups.getGroup(ctx.groupId);
      return { text: report.formatGroupReport(await report.groupReport(ctx), { tz: group?.timezone }) };
    },
  }),
};
