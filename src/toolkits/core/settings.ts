import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { GROUP_PURPOSES } from "@/db/schema";
import { ARCHETYPE_IDS, MAX_QUIRKS } from "@/lib/personality";
import { WEEKDAY_NAMES } from "@/lib/time";
import { groups, personality, schedule, toolkits as toolkitsSvc } from "@/services";
import { learnedLine } from "@/onboarding";
import { CATALOG, CORE_MANIFEST, TOOLKIT_IDS } from "../manifests";
import { ctxOf } from "../util";

const listNames = (n: string[]) => (n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`);

const NAMES = CATALOG.map((m) => m.id).join(", ");
const SWITCHABLE = CATALOG.filter((m) => m.status !== "coming-soon").map((m) => m.id).join(", ");
const SOON = CATALOG.filter((m) => m.status === "coming-soon").map((m) => m.id).join(", ");

export const settingsTools = {
  set_group_settings: createTool({
    id: "set_group_settings",
    description:
      "Admin only: change the group's settings, including the Onboarding answers ('roommates, USD, Chicago, hype'). Only pass what changed. The first purpose picks the Tricks you learn unless you pass toolkits; roommates and family also get three starter chores and the usual upkeep items. When setup finishes the result has `learned`: one ready-to-say line naming the Tricks you learned. Also the daily chores nudge hour and the weekly report's day and hour. personality: your vibe (base), the name the group calls you, and up to 3 quirks (the full list).",
    inputSchema: z.object({
      name: z.string().optional().describe("The group's name (not yours: yours is personality.name)"),
      purpose: z.enum(GROUP_PURPOSES).optional(),
      currency: z.string().length(3).optional().describe("ISO code, e.g. USD, EUR, INR"),
      timezone: z.string().optional().describe("IANA name (America/Chicago) or what they said: 'Chicago', 'CST', 'India', 'Berlin'"),
      chattiness: z.enum(["quiet", "normal", "chatty"]).optional(),
      simplifyDebts: z.boolean().optional(),
      toolkits: z.array(z.enum(TOOLKIT_IDS)).optional().describe("The full list of Tricks to know"),
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
      const finishedSetup = !before?.onboardedAt && !!group.onboardedAt;
      return {
        ...(finishedSetup ? { learned: learnedLine(toolkits, { defaulted: !group.purpose && !input.toolkits }) } : {}),
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
    description: `Admin only: learn or forget a Trick by name ("roomie, learn chores" = enabled true; "forget groceries" = enabled false; "turn on/off ..." means the same). Learnable: ${SWITCHABLE}. Coming soon, can't be learned yet: ${SOON}. Forgetting deletes nothing. Coming-soon ones and ones missing something they need come back with notAvailable + message: relay it, and don't offer another coming-soon one instead. Otherwise say the result's \`say\` line in your voice (it says what you learned or forgot, with something to try).`,
    inputSchema: z.object({ toolkit: z.string().describe(`The Trick, one of: ${NAMES}`), enabled: z.boolean().describe("true = learn, false = forget") }),
    execute: async (input, context) => {
      try {
        const r = await toolkitsSvc.setToolkit(ctxOf(context), input);
        const say = r.enabled
          ? `${r.changed ? "Learned" : "Already know"} ${r.name}.${r.tryThis ? ` Try: "roomie, ${r.tryThis}"` : ""}`
          : `${r.changed ? "Forgot" : "Didn't know"} ${r.name}${r.changed ? `. Nothing's deleted: "roomie, learn ${r.name.toLowerCase()}" brings it back.` : " here anyway."}`;
        return { ...r, say };
      } catch (e) {
        if (e instanceof toolkitsSvc.ToolkitUnavailableError) return { notAvailable: true, reason: e.code, message: e.message };
        throw e;
      }
    },
  }),
  list_toolkits: createTool({
    id: "list_toolkits",
    description:
      "What Roomie can do in this group ('what can you do?', 'help', 'what tricks do you know?'): the Tricks you know here (with things to try), the ones an Admin could teach you, and what's coming soon. Answer in your own voice, in 1-3 lines, built on `say`: the Tricks you know with an example or two, then what you could learn. A button to the Tricks page is attached.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = ctxOf(context);
      const all = await toolkitsSvc.catalogFor(ctx);
      const line = (s: (typeof all)[number]) => ({ name: s.manifest.name, what: s.manifest.summary, ...(s.enabled ? { try: s.manifest.gate.examples.slice(0, 2) } : {}) });
      const known = all.filter((s) => s.enabled).map(line);
      const couldLearn = all.filter((s) => !s.enabled && s.manifest.status !== "coming-soon").map(line);
      const comingSoon = all.filter((s) => s.manifest.status === "coming-soon").map((s) => s.manifest.name);
      const say = [
        `Tricks I know here: ${listNames(known.map((t) => t.name)) || "none yet"}.`,
        couldLearn.length ? `Could learn: ${listNames(couldLearn.map((t) => t.name))}.` : "",
        comingSoon.length ? `Coming soon: ${listNames(comingSoon)}.` : "",
      ].filter(Boolean).join(" ");
      return {
        say,
        known,
        couldLearn,
        comingSoon,
        always: CORE_MANIFEST.summary,
        whoCanTeach: "Admins teach Roomie a Trick: in the chat ('roomie, learn chores', 'roomie, forget chores') or on the dashboard's Tricks page.",
      };
    },
  }),
};
