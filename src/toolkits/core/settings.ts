import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { GROUP_PURPOSES } from "@/db/schema";
import { WEEKDAY_NAMES } from "@/lib/time";
import { groups, schedule, toolkits as toolkitsSvc } from "@/services";
import { CATALOG, CORE_MANIFEST, TOOLKIT_IDS } from "../manifests";
import { ctxOf, dashboardLinks } from "../util";

const NAMES = CATALOG.map((m) => m.id).join(", ");
const SWITCHABLE = CATALOG.filter((m) => m.status !== "coming-soon").map((m) => m.id).join(", ");
const SOON = CATALOG.filter((m) => m.status === "coming-soon").map((m) => m.id).join(", ");

export const settingsTools = {
  set_group_settings: createTool({
    id: "set_group_settings",
    description:
      "Admin only: change the group's settings, including the Onboarding answers ('roommates, USD, Chicago'). Only pass what changed. The first purpose picks default Toolkits unless you pass toolkits; roommates and family also get three starter chores and the usual upkeep items. Also the daily chores nudge hour and the weekly report's day and hour.",
    inputSchema: z.object({
      name: z.string().optional(),
      purpose: z.enum(GROUP_PURPOSES).optional(),
      currency: z.string().length(3).optional().describe("ISO code, e.g. USD, EUR, INR"),
      timezone: z.string().optional().describe("IANA name (America/Chicago) or what they said: 'Chicago', 'CST', 'India', 'Berlin'"),
      chattiness: z.enum(["quiet", "normal", "chatty"]).optional(),
      simplifyDebts: z.boolean().optional(),
      toolkits: z.array(z.enum(TOOLKIT_IDS)).optional().describe("The full list of Toolkits to have on"),
      choresNudgeHour: z.number().int().min(0).max(23).nullable().optional().describe("Local hour (0-23) of the daily chores nudge; null = off"),
      reportDay: z.enum(WEEKDAY_NAMES).optional().describe("Weekday of the weekly report"),
      reportHour: z.number().int().min(0).max(23).optional().describe("Local hour (0-23) of the weekly report"),
    }),
    execute: async ({ choresNudgeHour, reportDay, reportHour, ...input }, context) => {
      const ctx = ctxOf(context);
      const wantsSchedule = choresNudgeHour !== undefined || reportDay !== undefined || reportHour !== undefined;
      const hasSettings = Object.values(input).some((v) => v !== undefined);
      const res = hasSettings ? await groups.updateGroupSettings(ctx, input) : null;
      const sched = wantsSchedule
        ? await schedule.updateSchedule(ctx, {
            ...(choresNudgeHour !== undefined ? { nudgeHour: choresNudgeHour } : {}),
            ...(reportDay ? { reportWeekday: WEEKDAY_NAMES.indexOf(reportDay) } : {}),
            ...(reportHour !== undefined ? { reportHour } : {}),
          })
        : await schedule.getSchedule(ctx);
      const group = res?.group ?? (await groups.getGroup(ctx.groupId))!;
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
      };
    },
  }),
  toggle_toolkit: createTool({
    id: "toggle_toolkit",
    description: `Admin only: switch a Toolkit on or off by name. Switchable: ${SWITCHABLE}. Coming soon, not switchable yet: ${SOON}. Nothing is deleted. Coming-soon ones and ones missing something they need come back with notAvailable + message: relay it, and don't offer another coming-soon one instead. When one goes on, mention tryThis as an example.`,
    inputSchema: z.object({ toolkit: z.string().describe(`One of: ${NAMES}`), enabled: z.boolean() }),
    execute: async (input, context) => {
      try {
        return await toolkitsSvc.setToolkit(ctxOf(context), input);
      } catch (e) {
        if (e instanceof toolkitsSvc.ToolkitUnavailableError) return { notAvailable: true, reason: e.code, message: e.message };
        throw e;
      }
    },
  }),
  list_toolkits: createTool({
    id: "list_toolkits",
    description:
      "What Roomie can do in this group ('what can you do?', 'help', 'which toolkits are there?'): the Toolkits that are on (with things to try), the ones an Admin could switch on, and what's coming soon. Answer in your own voice, in 1-3 lines: what's on with an example or two, then what else there is. A button to the Toolkits page is attached.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = ctxOf(context);
      const all = await toolkitsSvc.catalogFor(ctx);
      const line = (s: (typeof all)[number]) => ({ name: s.manifest.name, what: s.manifest.summary, ...(s.enabled ? { try: s.manifest.gate.examples.slice(0, 2) } : {}) });
      return {
        on: all.filter((s) => s.enabled).map(line),
        off: all.filter((s) => !s.enabled && s.manifest.status !== "coming-soon").map(line),
        comingSoon: all.filter((s) => s.manifest.status === "coming-soon").map((s) => s.manifest.name),
        always: CORE_MANIFEST.summary,
        whoCanChange: "Admins: in the chat ('turn on chores') or on the dashboard's Toolkits page.",
        ...dashboardLinks("Browse Toolkits", `/g/${ctx.groupId}/toolkits`),
      };
    },
  }),
};
