import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { members } from "@/services";
import { ctxOf, memberIdByName } from "../util";

const who = (m: { displayName: string; role: string; status: string }) => ({ name: m.displayName, role: m.role, status: m.status });

export const memberTools = {
  list_members: createTool({
    id: "list_members",
    description: "List the members of this group with their role (admin/member) and status (active/pending).",
    inputSchema: z.object({}),
    execute: async (_input, context) => (await members.listGroupMembers(ctxOf(context))).map(who),
  }),
  list_pending: createTool({
    id: "list_pending",
    description: "Members waiting for an admin to approve them.",
    inputSchema: z.object({}),
    execute: async (_input, context) => (await members.listGroupMembers(ctxOf(context))).filter((m) => m.status === "pending").map(who),
  }),
  approve_member: createTool({
    id: "approve_member",
    description: "Admin only: approve a pending member ('approve Priya'). After this Roomie logs things for them.",
    inputSchema: z.object({ name: z.string().min(1).describe("The pending member's name") }),
    execute: async ({ name }, context) => {
      const ctx = ctxOf(context);
      const m = await members.approveMember(ctx, { memberId: await memberIdByName(ctx, name, { includePending: true }) });
      return { approved: m.displayName };
    },
  }),
  decline_member: createTool({
    id: "decline_member",
    description: "Admin only: decline a pending member. They stay in the chat, but Roomie won't act for them.",
    inputSchema: z.object({ name: z.string().min(1) }),
    execute: async ({ name }, context) => {
      const ctx = ctxOf(context);
      const m = await members.declineMember(ctx, { memberId: await memberIdByName(ctx, name, { includePending: true }) });
      return { declined: m.displayName };
    },
  }),
  promote_member: createTool({
    id: "promote_member",
    description: "Admin only: make an active member an admin too.",
    inputSchema: z.object({ name: z.string().min(1) }),
    execute: async ({ name }, context) => {
      const ctx = ctxOf(context);
      const m = await members.promoteMember(ctx, { memberId: await memberIdByName(ctx, name, { includePending: true }) });
      return { promoted: m.displayName };
    },
  }),
  set_payment_handle: createTool({
    id: "set_payment_handle",
    description: "Save the sender's own Venmo, PayPal or Cash App handle ('my venmo is @maya-r') so Settle up can link to it. Empty handle removes it.",
    inputSchema: z.object({ app: z.enum(["venmo", "paypal", "cashapp"]), handle: z.string() }),
    execute: async ({ app, handle }, context) => ({ handles: (await members.setPaymentHandles(ctxOf(context), { [app]: handle })).handles ?? {} }),
  }),
  forget_me: createTool({
    id: "forget_me",
    description:
      "The sender asked Roomie to forget them ('roomie forget me'): deletes their chat history, Member note, Roomie's memory of them and their photos, and takes them out of the group here (they show as Former member; if they write again they're a new member an admin approves). Their expenses and shares stay so balances still add up. Only for the sender, never for someone else.",
    inputSchema: z.object({}),
    execute: async (_input, context) => ({ ...(await members.forgetMe(ctxOf(context))), keptLedger: true, removedFromGroup: true }),
  }),
};
