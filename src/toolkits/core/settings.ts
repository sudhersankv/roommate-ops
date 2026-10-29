import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { GROUP_PURPOSES } from "@/db/schema";
import { ARCHETYPE_IDS, MAX_QUIRKS } from "@/lib/personality";
import { WEEKDAY_NAMES } from "@/lib/time";
import { groups, personality, schedule } from "@/services";
import { TOOLKIT_IDS } from "../types";
import { ctxOf } from "../util";

export const settingsTools = {
  set_group_settings: createTool({
    id: "set_group_settings",
    description:
      "Admin only: change the group's settings, including the Onboarding answers ('roommates, USD, Chicago, hype'). Only pass what changed. The first purpose picks default Toolkits unless you pass toolkits; roommates and family also get three starter chores and the usual upkeep items. Also the daily chores nudge hour and the weekly report's day and hour. personality: your vibe (base), the name the group calls you, and up to 3 quirks (the full list).",
    inputSchema: z.object({
      name: z.string().optional().describe("The group's name (not yours: yours is personality.name)"),
      purpose: z.enum(GROUP_PURPOSES).optional(),
      currency: z.string().length(3).optional().describe("ISO code, e.g. USD, EUR, INR"),
      timezone: z.string().optional().describe("IANA name (America/Chicago) or what they said: 'Chicago', 'CST', 'India', 'Berlin'"),
      chattiness: z.enum(["quiet", "normal", "chatty"]).optional(),
      simplifyDebts: z.boolean().optional(),
      toolkits: z.array(z.enum(TOOLKIT_IDS)).optional().describe("The full list of Toolkits to have on"),
      choresNudgeHour: z.number().int().min(0).max(23).nullable().optional().describe("Local hour (0-23) of the daily chores nudge; null = off"),
      reportDay: z.enum(WEEKDAY_NAMES).optional().describe("Weekday of the weekly report"),
      reportHour: z.number().int().min(0).max(23).optional().describe("Local hour (0-23) of the weekly report"),
      personality: z
        .object({
          base: z.enum(ARCHETYPE_IDS).optional().describe("Your vibe"),
          name: z.string().optional().describe("What the group calls you, e.g. Dino"),
          quirks: z.array(z.string()).max(MAX_QUIRKS).optional().describe("Short traits, e.g. 'obsessed with the plant'"),
        })
        .optional(),
    }),
    execute: async ({ choresNudgeHour, reportDay, reportHour, personality: pet, ...input }, context) => {
      const ctx = ctxOf(context);
      const before = await groups.getGroup(ctx.groupId);
      const wantsSchedule = choresNudgeHour !== undefined || reportDay !== undefined || reportHour !== undefined;
      // A vibe-only answer during Onboarding still ends it (an empty patch does that).
      const hasSettings = Object.values(input).some((v) => v !== undefined) || (!!pet && !before?.onboardedAt);
      const res = hasSettings ? await groups.updateGroupSettings(ctx, input) : null;
      const sched = wantsSchedule
        ? await schedule.updateSchedule(ctx, {
            ...(choresNudgeHour !== undefined ? { nudgeHour: choresNudgeHour } : {}),
            ...(reportDay ? { reportWeekday: WEEKDAY_NAMES.indexOf(reportDay) } : {}),
            ...(reportHour !== undefined ? { reportHour } : {}),
          })
        : await schedule.getSchedule(ctx);
      const p = pet && Object.keys(pet).length ? await personality.updatePersonality(ctx, pet) : await personality.getPersonality(ctx);
      const group = res?.group ?? before!;
      const toolkits = res?.toolkits ?? (await groups.enabledToolkits(ctx));
      return {
        name: group.name,
        purpose: group.purpose,
        currency: group.currency,
        timezone: group.timezone,
        chattiness: group.chattiness,
        simplifyDebts: group.simplifyDebts,
        toolkits,
        ...schedule.describeSchedule(sched),
        ...(res?.starters ? { added: `${res.starters.chores} starter chores, ${res.starters.upkeep} upkeep items` } : {}),
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
