// The Group Report's text, the same for the weekly post and group_report: the services' numbers, formatted in the
// Group's look (sentences instead of a list when its style note says the chat is casual).
import { isCasualStyle } from "@/lib/style-note";
import { groupStyle } from "@/mastra/memory";
import { formatGroupReport, groupReport } from "@/services/report";

export async function groupReportText(groupId: string, now = new Date()): Promise<string> {
  const [r, style] = await Promise.all([groupReport({ groupId }, now), groupStyle(groupId)]);
  return formatGroupReport(r, { casual: isCasualStyle(style) });
}
