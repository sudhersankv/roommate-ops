import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { deliverPrivate } from "@/channels";
import { CantMessagePrivatelyError } from "@/channels/types";
import { claims } from "@/services";
import { ctxOf } from "../util";

export const dashboardTools = {
  get_dashboard_link: createTool({
    id: "get_dashboard_link",
    description:
      "The sender asked for the dashboard (or to sign in / see it on their phone). New people get a private, single-use sign-in link (a Claim link) in a 1:1 message; people already signed in get a button. Only for the sender. Tell them where it went; never paste links. If it comes back with sentPrivately: false, tell them `message` (what to do first) instead.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = ctxOf(context);
      const link = await claims.issueDashboardLink(ctx);
      if (link.kind === "dashboard") return { kind: "dashboard", links: [{ text: "Open dashboard", url: link.url }] };
      if (ctx.source === "ui") return { kind: "claim", links: [{ text: "Connect your Account", url: link.url }] };
      // Claim links are private (ADR 0003): never into the group chat, not even when the DM fails.
      try {
        await deliverPrivate(ctx.memberId, { text: "Here's your link to the group's dashboard. It works once and expires in 24 hours.", buttons: [{ text: "Open dashboard", url: link.url }] });
      } catch (err) {
        if (err instanceof CantMessagePrivatelyError) return { kind: "claim", sentPrivately: false, message: err.message };
        console.error("[get_dashboard_link] private send failed", err);
        return { kind: "claim", sentPrivately: false, message: "I couldn't DM you just now. Ask me again in a minute." };
      }
      return { kind: "claim", sentPrivately: true, expiresIn: "24 hours" };
    },
  }),
};
