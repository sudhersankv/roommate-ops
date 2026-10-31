import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { reportIssue, sendIntro } from "@/services/lease-inbox";
import { saysYes } from "@/services/lease-inbox-rules";
import { inboxStatus, releaseInbox, sendForMember, trustAsked, workOrderLine } from "@/services/lease-inbox-toolkit";
import { askLease } from "@/services/lease-text";
import { ctxOf } from "../util";

type ContextReader = { get(key: string): unknown };
const latestOf = (context: unknown): string | undefined => {
  const v = (context as { requestContext?: ContextReader } | undefined)?.requestContext?.get("latest");
  return typeof v === "string" ? v : undefined;
};

/**
 * A complex send goes only when the Member's own latest message says yes (never the model's say-so). Without a message
 * (test:tools, Studio) only with ROOMIE_ADMIN_ASK_OFF=1 outside production, as the admin-only gate does.
 */
const confirmedBy = (context: unknown, asked: boolean | undefined): boolean => {
  if (!asked) return false;
  const latest = latestOf(context);
  if (latest === undefined) return process.env.ROOMIE_ADMIN_ASK_OFF === "1" && process.env.NODE_ENV !== "production";
  return saysYes(latest);
};

const sendOut = (r: Awaited<ReturnType<typeof sendForMember>>) =>
  r.sent ? { sent: true, say: r.line } : { sent: false, ask: r.ask, say: "Nothing was sent. Ask these in one message; send only after they say yes." };

export const leaseInboxTools = {
  report_issue: createTool({
    id: "report_issue",
    description:
      "\"The sink's leaking, tell them\": email the landlord a work order (a repair or a problem in the apartment) at once, signed with the sender's name, and follow it. `what` is the problem in a few words (\"the leaking kitchen sink\"). Returns `say` (post it as it is) or `ask` (nothing was sent: ask those questions).",
    inputSchema: z.object({
      what: z.string().min(2).describe("The problem in a few words, e.g. 'the leaking kitchen sink'"),
      confirmed: z.boolean().optional().describe("Only after you asked the questions from `ask` and they said yes"),
    }),
    execute: async ({ what, confirmed }, context) => {
      const instruction = latestOf(context) ?? `tell them ${what}`;
      const r = await reportIssue(ctxOf(context), { what, instruction, confirmed: confirmedBy(context, confirmed) });
      return sendOut(r);
    },
  }),
  send_to_landlord: createTool({
    id: "send_to_landlord",
    description:
      "Email the landlord for the sender: intent 'reply' answers in the landlord's thread about `about` (\"move the inspection to Thursday\", \"tell them Tuesday works\", a follow-up on a work order); 'new' is a new email. `body` is the email in the sender's words, short and polite, no sign-off (the signature is added). Never add an amount, a date or a lease term they didn't say. Returns `say` (post it as it is) or `ask` (nothing was sent: ask those questions, then call again with confirmed: true only after they say yes).",
    inputSchema: z.object({
      intent: z.enum(["reply", "new"]),
      about: z.string().optional().describe("What the thread is about: 'the inspection', 'the sink'"),
      body: z.string().min(2),
      summary: z.string().min(2).describe("What you did, for the chat: 'asked them to move the inspection to Thursday'"),
      confirmed: z.boolean().optional(),
    }),
    execute: async (input, context) => {
      const instruction = latestOf(context) ?? input.body;
      const r = await sendForMember(ctxOf(context), { intent: input.intent, about: input.about, body: input.body, summary: input.summary, instruction, confirmed: confirmedBy(context, input.confirmed) });
      return sendOut(r);
    },
  }),
  work_order_status: createTool({
    id: "work_order_status",
    description: "\"What's up with the sink?\": the work order's status (sent, they've seen it, scheduled, done) and the landlord's last reply. `what` = a word of it ('sink'); leave it out for the newest.",
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
