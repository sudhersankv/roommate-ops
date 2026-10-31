import { getSettlePlan, settleReportParts } from "@/services/money";
import { rentBundleLine, rentDmJob, rentOfferReportParts } from "@/services/rent";
import { getNudgeSettings, settleNudgeCandidates, settleNudgeJob } from "@/services/settle-nudge";
import { defineToolkit } from "../define";
import { splitting as manifest } from "./manifest";
import { moneyTools } from "./money";
import { receiptTools } from "./receipts";
import { rentTools } from "./rent";
import { splitwiseTools } from "./splitwise";

export const splitting = defineToolkit(manifest, {
  tools: { ...moneyTools, ...rentTools, ...receiptTools, ...splitwiseTools },
  dashboard: {
    home: () => import("./dashboard").then((m) => m.SplittingHome),
    settings: () => import("./dashboard").then((m) => m.SplittingSettings),
    mood: () => import("./dashboard").then((m) => m.splittingMood),
  },
  // The rent line; the rent DMs go out from here too, once a month (claimed as rent.ahead, only in the Bundle's hour).
  bundle: async (ctx, now) => {
    await rentDmJob(ctx, now).catch((e) => console.error("[money] rent DMs failed", e));
    return rentBundleLine(ctx, now);
  },
  // The weekly report opens with the open balances as a count; the Settle nudge DMs each person from here (claimed as
  // nudge.settle, only in the report's hour), then the rent offer once while there's no rent.
  report: async (ctx, now) => {
    await settleNudgeJob(ctx, now).catch((e) => console.error("[money] settle nudge failed", e));
    const [plan, nudge, candidates] = await Promise.all([getSettlePlan(ctx), getNudgeSettings(ctx), settleNudgeCandidates(ctx, now)]);
    return [...settleReportParts(plan, { nudged: nudge.enabled && candidates.length > 0 }), ...(await rentOfferReportParts(ctx))];
  },
});
