import { houseBundleLine, houseReportParts, startHouse } from "@/services/house";
import { defineToolkit } from "../define";
import { choreTools } from "./chores";
import { house as manifest } from "./manifest";
import { upkeepTools } from "./upkeep";
import { skill } from "./skill";

export const house = defineToolkit(manifest, {
  skill,
  tools: { ...choreTools, ...upkeepTools },
  dashboard: {
    // Home: Today right after your standing (Money), before the Cart.
    home: () => import("./dashboard").then((m) => m.HouseHome),
    homeOrder: 15,
    settings: () => import("./dashboard").then((m) => m.HouseSettings),
  },
  // The three starter chores (only on an empty chart) and the usual five upkeep items (only the missing ones):
  // teaching it twice adds nothing.
  onEnable: async (ctx) => {
    if (ctx.memberId) await startHouse({ groupId: ctx.groupId, memberId: ctx.memberId });
  },
  bundle: (ctx, now) => houseBundleLine(ctx, now),
  report: (ctx, now) => houseReportParts(ctx, now),
});
