import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { reportIssue, sendIntro, type SendApproval } from "@/services/lease-inbox";
import { inboxStatus, noticeLine, releaseInbox, sendForMember, trustAsked, workOrderLine } from "@/services/lease-inbox-toolkit";
import { askLease } from "@/services/lease-text";
import { ctxOf } from "../util";

type ContextReader = { get(key: string): unknown };
const latestOf = (context: unknown): string | undefined => {
  const v = (context as { requestContext?: ContextReader } | undefined)?.requestContext?.get("latest");
  return typeof v === "string" ? v : undefined;
};

/**
 * The Member's own latest message, which the service reads for a yes to a send it held (never the model's say-so).
 * Without a message (test:tools, Studio) a held send can be released only with ROOMIE_ADMIN_ASK_OFF=1 outside
 * production, as the admin-only gate does.
 */
const approvalOf = (context: unknown): SendApproval | undefined => {
  const latest = latestOf(context);
  if (latest !== undefined) return { latest };
  return process.env.ROOMIE_ADMIN_ASK_OFF === "1" && process.env.NODE_ENV !== "production" ? { latest: "yes" } : undefined;
};

const sendOut = (r: Awaited<ReturnType<typeof sendForMember>>) =>
  r.sent ? { sent: true, say: r.line } : { sent: false, ask: r.ask, say: "Nothing was sent. Ask these in one message; when they say yes, call this again with the same words." };

export const leaseInboxTools = {
  report_issue: createTool({
    id: "report_issue",
    description:
      "\"The sink's leaking, tell them\": email the landlord a work order (a repair or a problem in the apartment) at once, signed with the sender's name, and follow it. `what` is the problem in a few words (\"the leaking kitchen sink\"). Returns `say` (post it as it is) or `ask` (nothing was sent: ask those questions; when they say yes, call it again the same way).",
    inputSchema: z.object({
      what: z.string().min(2).describe("The problem in a few words, e.g. 'the leaking kitchen sink'"),
      details: z.string().optional().describe("Anything else they said about it, in their words ('it's under the cabinet, getting worse'); no amounts or dates they didn't say"),
    }),
    execute: async ({ what, details }, context) => {
      const instruction = latestOf(context) ?? `tell them ${what}`;
      const r = await reportIssue(ctxOf(context), { what, details, instruction, approval: approvalOf(context) });
      return sendOut(r);
    },
  }),
  send_to_landlord: createTool({
    id: "send_to_landlord",
    description:
      "Email the landlord for the sender: intent 'reply' answers in the landlord's thread about `about` (\"move the inspection to Thursday\", \"tell them Tuesday works\", a follow-up on a work order); 'new' is a new email. `body` is the email in the sender's words, short and polite, no sign-off (the signature is added). Never add an amount, a date or a lease term they didn't say. Returns `say` (post it as it is) or `ask` (nothing was sent: ask those questions; when they say yes, call it again with the same body).",
    inputSchema: z.object({
      intent: z.enum(["reply", "new"]),
      about: z.string().optional().describe("What the thread is about: 'the inspection', 'the sink'"),
      body: z.string().min(2),
      summary: z.string().min(2).describe("What you did, for the chat: 'asked them to move the inspection to Thursday'"),
    }),
    execute: async (input, context) => {
      const instruction = latestOf(context) ?? input.body;
      const r = await sendForMember(ctxOf(context), { intent: input.intent, about: input.about, body: input.body, summary: input.summary, instruction, approval: approvalOf(context) });
      return sendOut(r);
    },
  }),
  work_order_status: createTool({
    id: "work_order_status",
    description: "\"What's up with the sink?\": the work order's status (sent, they've seen it, scheduled, done) and the landlord's last reply. `what` = what they asked about ('the sink'); leave it out for the newest. Say `line` as it is (with `choices` it asks which one).",
    inputSchema: z.object({ what: z.string().optional() }),
    execute: async ({ what }, context) => workOrderLine(ctxOf(context), what),
  }),
  trust_sender: createTool({
    id: "trust_sender",
    description: "Admins: \"yes\" to \"is this your building?\" (or \"treat leasing@brookfield.com as the landlord\"): mail from that sender's domain counts as the landlord's from now on. Leave `sender` out for the one Roomie asked about.",
    inputSchema: z.object({ sender: z.string().optional().describe("An email address or a domain") }),
    execute: async ({ sender }, context) => {
      const r = await trustAsked(ctxOf(context), sender);
      return { trusted: r.trusted, say: r.line };
    },
  }),
  send_intro: createTool({
    id: "send_intro",
    description: "\"Send the intro\": the one-time email telling the landlord this address reaches every resident, signed with everyone's first names. Once per landlord.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const r = await sendIntro(ctxOf(context));
      if (r.sent) return { sent: true, say: r.line };
      return { sent: false, say: r.reason === "no-landlord" ? "I don't know the landlord's address yet. Forward me one of their emails first." : "They already got the intro." };
    },
  }),
  ask_lease: createTool({
    id: "ask_lease",
    description: "A question about the lease (\"what's the notice period?\", \"are pets allowed?\"): answered from the lease Roomie has on file, with the clause it comes from.",
    inputSchema: z.object({ question: z.string().min(3) }),
    execute: async ({ question }, context) => {
      const ctx = ctxOf(context);
      const { address } = await inboxStatus(ctx);
      return askLease(ctx, { question }, { address });
    },
  }),
  notice_status: createTool({
    id: "notice_status",
    description:
      "\"Is the water back on?\", \"when's the power back?\", \"is the inspection today?\": answered from the landlord's latest notice about it and its time window. `about` = the thing they asked about ('water', 'power', 'elevator', 'inspection'). Say `line` as it is.",
    inputSchema: z.object({ about: z.string().optional().describe("What they asked about, in a word or two: 'water'") }),
    execute: async ({ about }, context) => noticeLine(ctxOf(context), about),
  }),
  inbox_status: createTool({
    id: "inbox_status",
    description: "The group's email address for the landlord and how to connect it (forward the lease, CC it, or give it to the leasing office). Say `line` as it is.",
    inputSchema: z.object({}),
    execute: async (_input, context) => inboxStatus(ctxOf(context)),
  }),
  release_inbox: createTool({
    id: "release_inbox",
    description: "Admins: give up the group's email address (mail to it bounces from then on). What was filed stays.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const r = await releaseInbox(ctxOf(context));
      return { released: !!r.released, say: r.released ? `Released ${r.released}. Mail sent there bounces now; everything filed stays.` : "There's no address to release." };
    },
  }),
};
