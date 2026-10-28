import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { GROUP_PURPOSES } from "@/db/schema";
import { groups } from "@/services";
import { TOOLKIT_IDS } from "../types";
import { ctxOf } from "../util";

export const settingsTools = {
  set_group_settings: createTool({
    id: "set_group_settings",
    description:
      "Admin only: change the group's settings, including the Onboarding answers ('roommates, USD, Chicago'). Only pass what changed. The first purpose picks default Toolkits unless you pass toolkits.",
    inputSchema: z.object({
      name: z.string().optional(),
      purpose: z.enum(GROUP_PURPOSES).optional(),
      currency: z.string().length(3).optional().describe("ISO code, e.g. USD, EUR, INR"),
      timezone: z.string().optional().describe("IANA name, e.g. America/Chicago, Europe/London"),
      chattiness: z.enum(["quiet", "normal", "chatty"]).optional(),
      simplifyDebts: z.boolean().optional(),
      toolkits: z.array(z.enum(TOOLKIT_IDS)).optional().describe("The full list of Toolkits to have on"),
    }),
    execute: async (input, context) => {
      const { group, toolkits } = await groups.updateGroupSettings(ctxOf(context), input);
      return { name: group.name, purpose: group.purpose, currency: group.currency, timezone: group.timezone, chattiness: group.chattiness, simplifyDebts: group.simplifyDebts, toolkits };
    },
  }),
  toggle_toolkit: createTool({
    id: "toggle_toolkit",
    description: "Admin only: switch a Toolkit (splitting, groceries, chores, upkeep) on or off. Nothing is deleted.",
    inputSchema: z.object({ toolkit: z.enum(TOOLKIT_IDS), enabled: z.boolean() }),
    execute: async (input, context) => ({ toolkits: await groups.setToolkit(ctxOf(context), input) }),
  }),
};
