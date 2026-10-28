// Splitwise from the chat (ADR 0004): Roomie's own tools over services/splitwise.ts; raw Composio actions are never
// exposed. "Not connected" (no key, a bad key, nobody connected yet) comes back as text for Roomie to relay.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { splitwise } from "@/services";
import type { Ctx } from "@/services/types";
import { ctxOf, dashboardLinks } from "../util";

async function friendly<T>(fn: () => Promise<T>): Promise<T | { notConnected: true; message: string }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof splitwise.SplitwiseNotConnectedError) return { notConnected: true, message: e.message };
    throw e;
  }
}

async function groupIdByName(ctx: Ctx, name: string): Promise<string> {
  const list = await splitwise.listSplitwiseGroups(ctx);
  const q = name.trim().toLowerCase();
  const hit = list.find((g) => g.id === name || g.name.toLowerCase() === q) ?? list.find((g) => g.name.toLowerCase().includes(q));
  if (!hit) throw new Error(`No Splitwise group called "${name}". Groups: ${list.map((g) => g.name).join(", ") || "none"}.`);
  return hit.id;
}

export const splitwiseTools = {
  splitwise_status: createTool({
    id: "splitwise_status",
    description: "Splitwise for this group: connected or not, the linked Splitwise group, live mirror on/off, and (for admins) the Splitwise groups they can import.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = ctxOf(context);
      const s = await splitwise.splitwiseState(ctx);
      const groups = s.connected ? await friendly(() => splitwise.listSplitwiseGroups(ctx)).catch(() => null) : null;
      return {
        available: s.availability.ready,
        ...(s.availability.ready ? {} : { why: s.availability.hint }),
        connected: s.connected,
        connectedBy: s.connectedByName,
        linkedGroup: s.splitwiseGroup?.name ?? null,
        mirror: s.mode === "mirror",
        pendingPushes: s.pendingPushes,
        ...(Array.isArray(groups) ? { splitwiseGroups: groups.map((g) => g.name) } : {}),
      };
    },
  }),
  splitwise_connect: createTool({
    id: "splitwise_connect",
    description: "Admin only: connect the sender's own Splitwise account. Returns a sign-in button (attached for you), or says it's already connected.",
    inputSchema: z.object({}),
    execute: async (_input, context) =>
      friendly(async () => {
        const ctx = ctxOf(context);
        const r = await splitwise.connectSplitwise(ctx);
        if (r.connected) return { connected: true };
        return { connected: false, signIn: "Tap the button to connect Splitwise.", links: [{ text: "Connect Splitwise", url: r.url }] };
      }),
  }),
  splitwise_import: createTool({
    id: "splitwise_import",
    description: "Admin only: import a Splitwise group's people and full expense history into this group. Safe to run again (nothing is duplicated).",
    inputSchema: z.object({ group: z.string().min(1).describe("The Splitwise group's name") }),
    execute: async ({ group }, context) =>
      friendly(async () => {
        const ctx = ctxOf(context);
        const r = await splitwise.importSplitwiseGroup(ctx, { splitwiseGroupId: await groupIdByName(ctx, group) });
        return { ...r, ...dashboardLinks("See expenses", `/g/${ctx.groupId}/money?tab=expenses`) };
      }),
  }),
  splitwise_export: createTool({
    id: "splitwise_export",
    description: "Admin only: copy this group's expenses and payments that Splitwise doesn't have yet into a Splitwise group, once.",
    inputSchema: z.object({ group: z.string().optional().describe("The Splitwise group's name; omit to use the linked one") }),
    execute: async ({ group }, context) =>
      friendly(async () => {
        const ctx = ctxOf(context);
        return splitwise.exportToSplitwise(ctx, group ? { splitwiseGroupId: await groupIdByName(ctx, group) } : {});
      }),
  }),
  splitwise_mirror: createTool({
    id: "splitwise_mirror",
    description: "Admin only: live mirror on (every expense added, changed or deleted here is copied to Splitwise in the background) or off. One-way; Splitwise changes don't come back.",
    inputSchema: z.object({ on: z.boolean(), group: z.string().optional().describe("Splitwise group name, if none is linked yet") }),
    execute: async ({ on, group }, context) =>
      friendly(async () => {
        const ctx = ctxOf(context);
        return splitwise.setSplitwiseMirror(ctx, { on, ...(group ? { splitwiseGroupId: await groupIdByName(ctx, group) } : {}) });
      }),
  }),
};
