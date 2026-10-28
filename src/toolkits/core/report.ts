import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { report } from "@/services";
import { ctxOf } from "../util";

export const reportTools = {
  group_report: createTool({
    id: "group_report",
    description:
      "The full Group Report: balances, settle plan, chores, Hall of Shame, upcoming reminders, upkeep. Returns ready-to-post text; reply with it verbatim.",
    inputSchema: z.object({}),
    execute: async (_input, context) => ({ text: report.formatGroupReport(await report.groupReport(ctxOf(context))) }),
  }),
};
