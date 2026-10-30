import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { deliverPrivate } from "@/channels";
import { CantMessagePrivatelyError } from "@/channels/types";
import { claims, joins } from "@/services";
import { ctxOf, memberIdByName } from "../util";

export const dashboardTools = {
  get_dashboard_link: createTool({
    id: "get_dashboard_link",
    description:
      "The dashboard. For the whole group ('send us the dashboard', 'where can everyone see it', 'link for the group') pass forEveryone: true: the result's `say` is the group's Join link line; post it exactly as it is, the link included (the one link you write out yourself; it's safe in the chat and binds nobody). For the sender only ('send me the dashboard', 'I can't sign in'): new people get a private, single-use sign-in link (a Claim link) in a 1:1 message; people already signed in get a button that only works for them. Tell them where it went; never paste a Claim link. If it comes back with sentPrivately: false, tell them `message`, and you may offer `alternative`.",
    inputSchema: z.object({ forEveryone: z.boolean().optional().describe("true when they asked for the whole group, not just themselves") }),
    execute: async ({ forEveryone }, context) => {
      const ctx = ctxOf(context);
      if (forEveryone) {
        const url = await joins.joinLink(ctx.groupId);
        return { kind: "join", say: joins.joinLine(url), note: "Post `say` as it is. Each person signs in with Google and picks their name; never a Claim link in the group." };
      }
      const link = await claims.issueDashboardLink(ctx);
      if (link.kind === "dashboard") {
        return {
          kind: "dashboard",
          forSenderOnly: true,
          note: "This button opens the sender's own dashboard. For everyone, the group's Join link (forEveryone: true).",
          links: [{ text: "Open dashboard", url: link.url }],
        };
      }
      if (ctx.source === "ui") return { kind: "claim", links: [{ text: "Connect your Account", url: link.url }] };
      // Claim links are private (ADR 0003): never into the group chat, not even when the DM fails. The Join link is.
      const alternative = async () => `Or open the group's Join link, sign in with Google and pick your name: ${await joins.joinLink(ctx.groupId)}`;
      try {
        await deliverPrivate(ctx.memberId, { text: "Here's your link to the group's dashboard. It works once and expires in 24 hours.", buttons: [{ text: "Open dashboard", url: link.url }] });
      } catch (err) {
        if (err instanceof CantMessagePrivatelyError) return { kind: "claim", sentPrivately: false, message: err.message, alternative: await alternative() };
        console.error("[get_dashboard_link] private send failed", err);
        return { kind: "claim", sentPrivately: false, message: "I couldn't DM you just now. Ask me again in a minute.", alternative: await alternative() };
      }
      return { kind: "claim", sentPrivately: true, expiresIn: "24 hours" };
    },
  }),
  rotate_join_link: createTool({
    id: "rotate_join_link",
    description:
      "Admin only: a new Join link for the group ('rotate the join link', 'reset the dashboard link'); the old one stops working at once. Say the result's `say` as it is, the new link included.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const { url } = await joins.rotateJoinCode(ctxOf(context));
      return { rotated: true, say: `New Join link: ${url}. The old one doesn't work anymore.` };
    },
  }),
  set_join_policy: createTool({
    id: "set_join_policy",
    description:
      "Admin only: who gets in from the Join link. free = anyone in the chat signs in and picks their name (connects at once while there are free seats); approve_all = an Admin approves every join ('approve every join', 'let people pick their own name').",
    inputSchema: z.object({ policy: z.enum(["free", "approve_all"]) }),
    execute: async ({ policy }, context) => {
      const set = await joins.setJoinPolicy(ctxOf(context), { policy });
      return { policy: set, now: joins.JOIN_POLICY_LABEL[set] };
    },
  }),
  revoke_seat: createTool({
    id: "revoke_seat",
    description:
      "Admin only: disconnect the Google account on someone's dashboard seat ('that's not Sam on the dashboard, disconnect them'). The Member stays; their seat is open to pick again from the Join link.",
    inputSchema: z.object({ name: z.string().min(1).describe("The Member whose seat to disconnect") }),
    execute: async ({ name }, context) => {
      const ctx = ctxOf(context);
      const m = await joins.revokeSeat(ctx, { memberId: await memberIdByName(ctx, name) });
      return { disconnected: m.displayName, next: `${m.displayName}'s seat is open again on the Join link.` };
    },
  }),
};
