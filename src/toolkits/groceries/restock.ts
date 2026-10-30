// Restock tools: thin wrappers over services/restock. What's probably low comes from purchase history; no prices.
// In the group chat only shared items are named; a Member's own come up only in their DM (isPrivate).
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { lowFor, mute, unmute } from "@/services/restock";
import { restockLine } from "@/services/restock-math";
import { ctxOf } from "../util";

const inDm = (context: unknown) => (context as { requestContext?: { get(k: string): unknown } } | undefined)?.requestContext?.get("isPrivate") === true;

export const restockTools = {
  restock_status: createTool({
    id: "restock_status",
    description:
      "'What are we low on?' / 'anything we need?': what's probably running out, from how often the group buys it. Post `say` as it is. In a DM it includes the sender's own items. No prices.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = ctxOf(context);
      const low = await lowFor(ctx, { mine: inDm(context) });
      return { items: low.map((c) => c.item), say: restockLine(low) ?? "Nothing looks low right now." };
    },
  }),
  restock_mute: createTool({
    id: "restock_mute",
    description: "'We don't buy dish soap anymore' / 'stop mentioning X': Roomie stops calling it probably low. Post `say`.",
    inputSchema: z.object({ item: z.string().min(1).describe("The thing, e.g. 'dish soap'") }),
    execute: async ({ item }, context) => {
      const r = await mute(ctxOf(context), item);
      return { muted: r.item, say: `Got it, I'll stop mentioning ${r.item}.` };
    },
  }),
  restock_unmute: createTool({
    id: "restock_unmute",
    description: "'Actually we do buy dish soap': Roomie may call it probably low again. Post `say`.",
    inputSchema: z.object({ item: z.string().min(1) }),
    execute: async ({ item }, context) => {
      const r = await unmute(ctxOf(context), item);
      return { unmuted: r.unmuted, say: r.unmuted ? `OK, I'll mention ${r.item} again.` : `I wasn't skipping ${r.item}.` };
    },
  }),
};
