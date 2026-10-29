import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { GROUP_PURPOSES } from "@/db/schema";
import { ARCHETYPE_IDS, MAX_QUIRKS } from "@/lib/personality";
import { groups, personality } from "@/services";
import { TOOLKIT_IDS } from "../types";
import { ctxOf } from "../util";

export const settingsTools = {
  set_group_settings: createTool({
    id: "set_group_settings",
    description:
      "Admin only: change the group's settings, including the Onboarding answers ('roommates, USD, Chicago, hype'). Only pass what changed. The first purpose picks default Toolkits unless you pass toolkits. personality: your vibe (base), the name the group calls you, and up to 3 quirks (the full list).",
    inputSchema: z.object({
      name: z.string().optional().describe("The group's name (not yours: yours is personality.name)"),
      purpose: z.enum(GROUP_PURPOSES).optional(),
      currency: z.string().length(3).optional().describe("ISO code, e.g. USD, EUR, INR"),
      timezone: z.string().optional().describe("IANA name, e.g. America/Chicago, Europe/London"),
      chattiness: z.enum(["quiet", "normal", "chatty"]).optional(),
      simplifyDebts: z.boolean().optional(),
      toolkits: z.array(z.enum(TOOLKIT_IDS)).optional().describe("The full list of Toolkits to have on"),
      personality: z
        .object({
          base: z.enum(ARCHETYPE_IDS).optional().describe("Your vibe"),
          name: z.string().optional().describe("What the group calls you, e.g. Dino"),
          quirks: z.array(z.string()).max(MAX_QUIRKS).optional().describe("Short traits, e.g. 'obsessed with the plant'"),
        })
        .optional(),
    }),
    execute: async ({ personality: pet, ...input }, context) => {
      const ctx = ctxOf(context);
      const { group, toolkits } = await groups.updateGroupSettings(ctx, input);
      const p = pet && Object.keys(pet).length ? await personality.updatePersonality(ctx, pet) : await personality.getPersonality(ctx);
      return {
        name: group.name,
        purpose: group.purpose,
        currency: group.currency,
        timezone: group.timezone,
        chattiness: group.chattiness,
        simplifyDebts: group.simplifyDebts,
        toolkits,
        personality: { vibe: p.base, yourName: p.name, quirks: p.quirks },
      };
    },
  }),
  toggle_toolkit: createTool({
    id: "toggle_toolkit",
    description: "Admin only: switch a Toolkit (splitting, groceries, chores, upkeep) on or off. Nothing is deleted.",
    inputSchema: z.object({ toolkit: z.enum(TOOLKIT_IDS), enabled: z.boolean() }),
    execute: async (input, context) => ({ toolkits: await groups.setToolkit(ctxOf(context), input) }),
  }),
};
