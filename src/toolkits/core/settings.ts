import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { GROUP_PURPOSES } from "@/db/schema";
import { groups, toolkits as toolkitsSvc } from "@/services";
import { CATALOG, CORE_MANIFEST, TOOLKIT_IDS } from "../manifests";
import { ctxOf, dashboardLinks } from "../util";

const NAMES = CATALOG.map((m) => m.id).join(", ");
const SWITCHABLE = CATALOG.filter((m) => m.status !== "coming-soon").map((m) => m.id).join(", ");
const SOON = CATALOG.filter((m) => m.status === "coming-soon").map((m) => m.id).join(", ");

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
