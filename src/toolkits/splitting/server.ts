import { getSettlePlan, settleReportParts } from "@/services/money";
import { defineToolkit } from "../define";
import { splitting as manifest } from "./manifest";
import { moneyTools } from "./money";
import { receiptTools } from "./receipts";
import { splitwiseTools } from "./splitwise";

export const splitting = defineToolkit(manifest, {
  tools: { ...moneyTools, ...receiptTools, ...splitwiseTools },
  dashboard: {
    home: () => import("./dashboard").then((m) => m.SplittingHome),
    settings: () => import("./dashboard").then((m) => m.SplittingSettings),
    mood: () => import("./dashboard").then((m) => m.splittingMood),
  },
  // The weekly report opens with the Settle plan.
  report: async (ctx) => settleReportParts(await getSettlePlan(ctx)),
});
