import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { groupReportText } from "@/jobs/report-text";
import { ctxOf } from "../util";

export const reportTools = {
  group_report: createTool({
    id: "group_report",
    description:
      "The Group Report, only when someone asks for the report ('weekly report', 'group report', 'how are we doing overall'): who owes whom, chores this week, streaks, the chart, upkeep due soon, the Cart, what's coming up. Returns ready-to-post text: reply with exactly that text, nothing before or after. For 'what's due' use chore_status and upkeep_status instead.",
    inputSchema: z.object({}),
    execute: async (_input, context) => ({ text: await groupReportText(ctxOf(context).groupId) }),
  }),
};
