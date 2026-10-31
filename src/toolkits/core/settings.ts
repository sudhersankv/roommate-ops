import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { GROUP_PURPOSES } from "@/db/schema";
import { WEEKDAY_NAMES } from "@/lib/time";
import { groups, joins, schedule, toolkits as toolkitsSvc } from "@/services";
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
      "Admin only: change the group's settings, including the Onboarding answers ('roommates, USD, Chicago'). Only pass what changed. The first purpose picks the Tricks you learn unless you pass toolkits (each Trick sets itself up: a chore chart, a Pantry). When setup finishes the result has `say`: two ready lines (the Tricks you learned, then the group's Join link for everyone's dashboard); post `say` exactly as it is, the link included, nothing else about links. With postedInGroup (they answered in a DM) it's already in the group chat: say it here too. Also the hour of Roomie's morning post and the weekly report's day and hour.",
    inputSchema: z.object({
      name: z.string().optional().describe("The group's name"),
      purpose: z.enum(GROUP_PURPOSES).optional(),
      currency: z.string().length(3).optional().describe("ISO code, e.g. USD, EUR, INR"),
      timezone: z.string().optional().describe("IANA name (America/Chicago) or what they said: 'Chicago', 'CST', 'India', 'Berlin'"),
      chattiness: z.enum(["quiet", "normal", "chatty"]).optional(),
      simplifyDebts: z.boolean().optional(),
      toolkits: z.array(z.enum(TOOLKIT_IDS)).optional().describe("The full list of Tricks to know"),
      choresNudgeHour: z.number().int().min(0).max(23).nullable().optional().describe("Local hour (0-23) of Roomie's morning post (the chores nudge); null = off"),
      reportDay: z.enum(WEEKDAY_NAMES).optional().describe("Weekday of the weekly report"),
      reportHour: z.number().int().min(0).max(23).optional().describe("Local hour (0-23) of the weekly report"),
    }),
    execute: async ({ choresNudgeHour, reportDay, reportHour, ...input }, context) => {
      const ctx = ctxOf(context);
      const before = await groups.getGroup(ctx.groupId);
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
      const group = res?.group ?? before!;
      const toolkits = res?.toolkits ?? (await groups.enabledToolkits(ctx));
      const finishedSetup = !before?.onboardedAt && !!group.onboardedAt;
      let setup = {};
      if (finishedSetup) {
        // The setup's last word (ADR 0014): the Tricks learned and the Group's Join link, one line each. Answered in a
        // DM, it goes to the group chat too, since that's where everyone needs the link.
        const learned = learnedLine(toolkits, { defaulted: !group.purpose && !input.toolkits });
        const say = `${learned}\n${joins.joinLine(await joins.joinLink(ctx.groupId))}`;
        const inDm = (context?.requestContext as { get(k: string): unknown } | undefined)?.get("isPrivate") === true;
        const posted = inDm
          ? await joins.postInChat(ctx.groupId, say).then(
              () => true,
              (e) => (console.warn("[set_group_settings] couldn't post the setup line in the group", e), false),
            )
          : undefined;
        setup = {
          learned,
          say,
          ...(posted === true ? { postedInGroup: true } : {}),
          ...(posted === false ? { postedInGroup: false, tellThem: "It didn't reach the group chat: ask them to post the Join link line there (it's in `say`)." } : {}),
        };
      }
      return {
        ...setup,
        name: group.name,
        purpose: group.purpose,
        currency: group.currency,
        timezone: group.timezone,
        chattiness: group.chattiness,
        simplifyDebts: group.simplifyDebts,
        toolkits,
        ...schedule.describeSchedule(sched),
      };
    },
  }),
  toggle_toolkit: createTool({
    id: "toggle_toolkit",
    description: `Admin only: learn or forget a Trick by name ("roomie, learn chores" = enabled true; "forget groceries" = enabled false; "turn on/off ..." means the same). Learnable: ${SWITCHABLE}. Coming soon, can't be learned yet: ${SOON}. Forgetting deletes nothing. Coming-soon ones and ones missing something they need come back with notAvailable + message: relay it, and don't offer another coming-soon one instead. Otherwise say the result's \`say\` line in your voice (it says what you learned or forgot); don't add a phrase for them to try.`,
    inputSchema: z.object({ toolkit: z.string().describe(`The Trick, one of: ${NAMES}`), enabled: z.boolean().describe("true = learn, false = forget") }),
    execute: async (input, context) => {
      try {
        const r = await toolkitsSvc.setToolkit(ctxOf(context), input);
        const say = r.enabled
          ? r.changed
            ? toolkitsSvc.learnedSay(r)
            : `Already know ${r.name}.`
          : `${r.changed ? "Forgot" : "Didn't know"} ${r.name}${r.changed ? ". Nothing's deleted, so it's all still there if an admin teaches me again." : " here anyway."}`;
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
