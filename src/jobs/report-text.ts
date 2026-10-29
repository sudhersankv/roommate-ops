// The Group Report's text, the same for the weekly post and group_report: the services' numbers, formatted in the
// Group's look (sentences instead of a list when its style note says the chat is casual).
import { isCasualStyle } from "@/lib/style-note";
import { formatGroupReport, groupReport } from "@/services/report";

// Memory is loaded on first use, not at import: importing it builds the Postgres store, and this module sits under the
// toolkits, which unit tests load without a DATABASE_URL.
const groupStyle = async (groupId: string) => (await import("@/mastra/memory")).groupStyle(groupId);

export async function groupReportText(groupId: string, now = new Date()): Promise<string> {
  const [r, style] = await Promise.all([groupReport({ groupId }, now), groupStyle(groupId)]);
  return formatGroupReport(r, { casual: isCasualStyle(style) });
}
