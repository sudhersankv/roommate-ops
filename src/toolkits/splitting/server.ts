import { getSettlePlan, settleReportParts } from "@/services/money";
import { rentBundleLine, rentDmJob, rentOfferReportParts } from "@/services/rent";
import { nudgeableDebts, settleNudgeJob } from "@/services/settle-nudge";
import { defineToolkit } from "../define";
import { splitting as manifest } from "./manifest";
import { moneyTools } from "./money";
import { receiptTools } from "./receipts";
import { rentTools } from "./rent";
import { splitwiseTools } from "./splitwise";
import { skill } from "./skill";

export const splitting = defineToolkit(manifest, {
  skill,
  tools: { ...moneyTools, ...rentTools, ...receiptTools, ...splitwiseTools },
  dashboard: {
    home: () => import("./dashboard").then((m) => m.SplittingHome),
    settings: () => import("./dashboard").then((m) => m.SplittingSettings),
    mood: () => import("./dashboard").then((m) => m.splittingMood),
  },
  // The rent line. The private DMs go out from here too, only in the Bundle's hour: the rent DMs once a month
  // (claimed as rent.ahead) and the Settle nudge per debt (claimed as nudge.settle per day and pair, ADR 0021).
  bundle: async (ctx, now) => {
    await rentDmJob(ctx, now).catch((e) => console.error("[money] rent DMs failed", e));
    await settleNudgeJob(ctx, now).catch((e) => console.error("[money] settle nudge failed", e));
    return rentBundleLine(ctx, now);
  },
  // The weekly report opens with the open balances as a count (never names), then the rent offer once while there's no rent.
  report: async (ctx) => {
    const [plan, nudgeable] = await Promise.all([getSettlePlan(ctx), nudgeableDebts(ctx)]);
    return [...settleReportParts(plan, { nudged: nudgeable.length > 0 }), ...(await rentOfferReportParts(ctx))];
  },
});
