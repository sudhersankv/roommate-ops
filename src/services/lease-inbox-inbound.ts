// What arrives in a Group's Lease Inbox, end to end (ADR 0016 decision 4): the webhook's event (received, then
// processed: claimMailEvent / finishMailEvent) -> the stored email (lease-inbox.ts storeInbound, once per message id) -> its attachments as Documents -> classifyInbound with the
// hooks wired to the core slots and Money -> the one chat line. Each hook is a thin call; what a class does is still
// decided in lease-inbox.ts. Webhook JSON is snake_case and parsed here (parseMailEvent, pure).
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { deliver } from "@/channels";
import { CantMessagePrivatelyError } from "@/channels/types";
import { db, schema } from "@/db";
import { mailClient, type MailAttachment, type MailMessage } from "@/integrations/mail";
import { addressOf } from "@/lib/forwarded";
import { inQuietHours, nextAllowed } from "@/lib/quiet-hours";
import { leaseInbox as manifest } from "@/toolkits/lease-inbox/manifest";
import { logMessage } from "./chatlog";
import { fileDocument, stableDocId } from "./documents";
import { postStartHint } from "./dm";
import { enabledToolkits } from "./groups";
import { claimMailEvent, classifyInbound, finishMailEvent, knownSenders, storeInbound, widestTrust, type ClassifyResult, type InboundHooks } from "./lease-inbox";
import { attachmentKind } from "./lease-inbox-rules";
import { extractDocumentText } from "./lease-text";
import { admins } from "./members";
import { sendNudge } from "./nudges";
import { dbMoments } from "./pet";
import { prefillAmount } from "./recurring";
import { setReminder } from "./reminders";
import { getRent, shortMoney } from "./rent";
import { DEFAULT_TIMEZONE } from "./schedule";
import { postUrgent } from "./urgent";

const { groups, groupInboxes, mailMessages, documents, pendingPosts, reminders } = schema;

/* ---------- the webhook's event (pure) ---------- */

const nullish = <T extends z.ZodType>(t: T) => t.nullish().transform((v) => v ?? undefined);
const AttachmentJson = z.object({
  attachment_id: z.string(),
  filename: nullish(z.string()),
  content_type: nullish(z.string()),
  size: z.number().default(0),
});
const MessageJson = z.object({
  inbox_id: z.string(),
  thread_id: z.string(),
  message_id: z.string(),
  from: z.string(),
  to: z.array(z.string()).default([]),
  subject: nullish(z.string()),
  text: nullish(z.string()),
  extracted_text: nullish(z.string()),
  html: nullish(z.string()),
  timestamp: nullish(z.string()),
  created_at: nullish(z.string()),
  labels: z.array(z.string()).default([]),
  attachments: z.array(AttachmentJson).default([]),
  body_url: nullish(z.string()),
});
const EventJson = z.object({ event_type: z.string(), event_id: z.string(), message: MessageJson.optional() });

export type MailEvent = {
  eventId: string;
  inboxId: string;
  messageId: string;
  /** The message as the event carried it; null when the body was too large and must be fetched (body_url). */
  message: MailMessage | null;
};

/** Received mail only; spam and blocked deliveries are dropped. "unauthenticated" is kept, labelled so (never trusted). */
const RECEIVED = new Set(["message.received", "message.received.unauthenticated"]);

/** AgentMail's webhook JSON -> one received email, or null for anything else (other events, malformed bodies). */
export function parseMailEvent(json: unknown): MailEvent | null {
  const e = EventJson.safeParse(json);
  if (!e.success || !RECEIVED.has(e.data.event_type) || !e.data.message) return null;
  const m = e.data.message;
  const labels = e.data.event_type.endsWith(".unauthenticated") && !m.labels.includes("unauthenticated") ? [...m.labels, "unauthenticated"] : m.labels;
  const base = { eventId: e.data.event_id, inboxId: m.inbox_id, messageId: m.message_id };
  if (m.body_url) return { ...base, message: null };
  const at = new Date(m.timestamp ?? m.created_at ?? Date.now());
  return {
    ...base,
    message: {
      inboxId: m.inbox_id,
      messageId: m.message_id,
      threadId: m.thread_id,
      from: m.from,
      to: m.to,
      subject: m.subject ?? "",
      text: m.text ?? m.extracted_text ?? "",
      html: m.html ?? null,
      receivedAt: Number.isNaN(at.getTime()) ? new Date() : at,
      attachments: m.attachments.map((a): MailAttachment => ({ attachmentId: a.attachment_id, filename: a.filename ?? null, contentType: a.content_type ?? null, size: a.size })),
      labels,
    },
  };
}

/* ---------- posting ---------- */

async function groupFacts(groupId: string) {
  const [g] = await db.select({ tz: groups.timezone, pausedAt: groups.pausedAt }).from(groups).where(eq(groups.id, groupId));
  return { tz: g?.tz ?? DEFAULT_TIMEZONE, paused: !g || !!g.pausedAt };
}

/** The Lease Inbox's one line in the Chat: nothing in a paused Group, held to 08:00 inside quiet hours. */
export async function postLine(groupId: string, text: string, now = new Date()): Promise<"posted" | "held" | "paused"> {
  const { tz, paused } = await groupFacts(groupId);
  if (paused) return "paused";
  if (inQuietHours(now, tz)) {
    await db.insert(pendingPosts).values({ groupId, kind: "line", text, dueAt: nextAllowed(now, tz), createdAt: now });
    return "held";
  }
  await deliver(groupId, { text });
  await logMessage(groupId, null, text);
  return "posted";
}

/** A private note to a Member (sendNudge); no DM path yet -> the neutral Start hint, never the content. */
async function tellPrivately(memberId: string, groupId: string, text: string, now: Date): Promise<void> {
  try {
    await sendNudge(memberId, { text }, now);
  } catch (e) {
    if (!(e instanceof CantMessagePrivatelyError)) throw e;
    await postStartHint(memberId, groupId, now);
  }
}

async function tellAdmins(groupId: string, text: string, now: Date): Promise<number> {
  const list = await admins({ groupId });
  for (const a of list) await tellPrivately(a.id, groupId, text, now).catch((e) => console.warn(`[mail] couldn't tell admin ${a.id}`, e));
  return list.length;
}

/* ---------- the hooks ---------- */

/**
 * The email's attachments as Documents (kind from its class: lease / notice / bill / email), linked back to the email
 * (source mail_messages) and listed on it (document_ids). A lease or notice gets its text read for ask_lease (a failed
 * read is tried again when someone asks: lease-text.ts currentLease). One
 * attachment failing doesn't stop the rest. The same attachment delivered twice is one Document (stableDocId).
 */
export async function fileAttachments(groupId: string, mailId: string, attachments: readonly MailAttachment[]): Promise<string[]> {
  if (!attachments.length) return [];
  const [m] = await db.select().from(mailMessages).where(and(eq(mailMessages.groupId, groupId), eq(mailMessages.id, mailId)));
  if (!m) return [];
  const client = mailClient();
  const ids: string[] = [];
  for (const a of attachments) {
    try {
      const link = await client.getAttachment(m.inboxId, m.messageId, a.attachmentId);
      const bytes = await client.fetchAttachment(link.downloadUrl);
      const kind = attachmentKind(m.class, m.utility, a.filename);
      const doc = await fileDocument(
        { groupId },
        {
          id: stableDocId(groupId, `mail:${m.messageId}:${a.attachmentId}`),
          kind,
          title: (a.filename ?? m.subject ?? "Attachment").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_]+/g, " "),
          bytes,
          contentType: a.contentType ?? "application/octet-stream",
          source: { table: "mail_messages", id: m.id },
          uploadedBy: m.forwardedBy,
        },
      );
      ids.push(doc.id);
      if (kind === "lease" || kind === "notice") {
        const text = await extractDocumentText({ textUrl: link.textUrl, bytes, contentType: a.contentType, filename: a.filename }).catch((e) => {
          console.warn(`[mail] couldn't read ${a.filename ?? a.attachmentId}`, e);
          return null;
        });
        if (text) await db.update(documents).set({ text }).where(eq(documents.id, doc.id));
      }
    } catch (e) {
      console.warn(`[mail] attachment ${a.attachmentId} of ${m.messageId} wasn't filed`, e);
    }
  }
  if (ids.length) await db.update(mailMessages).set({ documentIds: [...new Set([...m.documentIds, ...ids])] }).where(eq(mailMessages.id, m.id));
  return ids;
}

/** The rent proposal for the Admin (private): the landlord's line, and the exact words that update the rent. */
export function rentProposalText(summary: string, amountCents: number | null, currentCents: number | null, currency = "USD"): string {
  const now = currentCents ? ` (it's ${shortMoney(currentCents, currency)} now)` : "";
  const ask = amountCents
    ? `If the rent is now ${shortMoney(amountCents, currency)}${now}, say "roomie, update the rent to ${shortMoney(amountCents, currency)}" and I'll change it.`
    : `Tell me the new amount ("roomie, update the rent to ...") and I'll change it${now}.`;
  return `The landlord emailed about the rent or the lease: ${summary}. ${ask} Nothing changes until you say so.`;
}

type Posted = "posted" | "held" | "paused" | "urgent" | null;
export type InboundResult = (ClassifyResult & { mailId: string; duplicate: false; posted: Posted }) | { duplicate: true };

/**
 * One received email, start to finish. Each class's side effects are the core's hooks (InboundHooks), wired here:
 * notice -> a whole-group Reminder at 20:00 the evening before ("Reminder: water's off tomorrow, 9 to 11. Shower
 * tonight.", notice-window.ts; set as whoever forwarded it, else the first Admin)
 * and, within 72 hours, the urgent slot; rent-lease -> a private note to each Admin with the words that run set_rent
 * (their own "update the rent to $X" goes through set_rent's admin ask, nothing new); a utility bill -> the variable
 * Expense's prefill; a new sender -> one private question to the Admins per domain; a work-order reply is advanced by
 * the core. Then the class's one line, unless the urgent slot already posted (or held) it. A forward that taught
 * Roomie the landlord gets the intro offer (once per domain).
 */
export async function processInbound(groupId: string, message: MailMessage, opts: { eventId?: string; now?: Date } = {}): Promise<InboundResult> {
  const now = opts.now ?? new Date();
  // Received, then processed (mail_events): a delivery whose run failed or died is processed again by a later one.
  const claim = opts.eventId ? await claimMailEvent(groupId, opts.eventId, now) : "fresh";
  if (claim === "done" || claim === "busy") return { duplicate: true };
  const before = new Set(await knownSenders(groupId));
  const stored = await storeInbound(groupId, message);
  // The same email under another event id is a duplicate; under a retried event, it's this email's unfinished run.
  if (!stored.id || (stored.duplicate && claim !== "retry")) {
    if (opts.eventId) await finishMailEvent(opts.eventId, now);
    return { duplicate: true };
  }
  const mailId = stored.id;
  const learned = (await knownSenders(groupId)).filter((v) => !before.has(v));
  const state: { posted: Posted } = { posted: null };

  const hooks: InboundHooks = {
    async remind(gid, at, text) {
      const [m] = await db.select({ by: mailMessages.forwardedBy }).from(mailMessages).where(eq(mailMessages.id, mailId));
      const actor = m?.by ?? (await admins({ groupId: gid }))[0]?.id;
      if (!actor) return;
      const line = text;
      // A retried run (mail_events) finds the one it already set.
      const [have] = await db.select({ id: reminders.id }).from(reminders).where(and(eq(reminders.groupId, gid), eq(reminders.text, line), eq(reminders.dueAt, at)));
      if (have) return;
      await setReminder({ groupId: gid, memberId: actor, source: "chat" }, { text: line, dueAt: at }, now);
    },
    async urgent(gid, line) {
      const r = await postUrgent(gid, line, now);
      if (r.posted) {
        state.posted = "urgent";
        await logMessage(gid, null, line);
      } else if (r.reason === "quiet") state.posted = "held";
      else if (r.reason === "paused") state.posted = "paused";
    },
    async fileDocuments(gid, id) {
      await fileAttachments(gid, id, message.attachments);
    },
    async askAdmin(gid, text) {
      const key = widestTrust(stored.sender ?? "") ?? addressOf(stored.sender ?? "") ?? "unknown";
      if (!(await dbMoments.claim(gid, "new-sender", key))) return;
      await tellAdmins(gid, `${text} If it is, say "yes" and I'll treat ${key} as the landlord from now on.`, now);
    },
    async proposeRent(gid, id, amountCents) {
      const [m] = await db.select({ summary: mailMessages.summary, subject: mailMessages.subject }).from(mailMessages).where(eq(mailMessages.id, id));
      const rent = await getRent({ groupId: gid });
      await tellAdmins(gid, rentProposalText(m?.summary ?? m?.subject ?? "a change", amountCents, rent?.cents ?? null, rent?.currency), now);
    },
    async prefillUtility(gid, utility, cents) {
      await prefillAmount(gid, utility, cents, now);
    },
  };

  const result = await classifyInbound(groupId, mailId, { now, hooks });
  if (result.line && !state.posted) state.posted = await postLine(groupId, result.line, now);
  if (learned.length) await offerIntro(groupId, learned, now).catch((e) => console.warn("[mail] intro offer failed", e));
  if (opts.eventId) await finishMailEvent(opts.eventId, now);
  return { ...result, mailId, duplicate: false, posted: state.posted };
}

/** A forward taught Roomie the landlord: offer the Admins the one-time intro email, once per domain (ADR 0016 decision 7). */
async function offerIntro(groupId: string, learned: readonly string[], now: Date): Promise<void> {
  const widest = learned.find((v) => !v.includes("@")) ?? learned[0];
  if (!(await dbMoments.claim(groupId, "lease-intro", widest))) return;
  await tellAdmins(groupId, `Got it: ${widest} is the landlord now. Want me to send them a short intro from all of you, so they know this address reaches everyone? Say "roomie, send the intro", or ignore this to skip.`, now);
}

/* ---------- the webhook's handler ---------- */

export type EventOutcome = { handled: true; result: InboundResult } | { handled: false; reason: "unknown-inbox" | "off" };

/**
 * One webhook event: the Group by inbox id, nothing while the Trick is forgotten (it stops reading; what was filed
 * stays), the body fetched when the event didn't carry it, then processInbound.
 */
export async function handleMailEvent(event: MailEvent, now = new Date()): Promise<EventOutcome> {
  const [inbox] = await db.select({ groupId: groupInboxes.groupId }).from(groupInboxes).where(eq(groupInboxes.inboxId, event.inboxId));
  if (!inbox) return { handled: false, reason: "unknown-inbox" };
  if (!(await enabledToolkits({ groupId: inbox.groupId })).includes(manifest.id)) return { handled: false, reason: "off" };
  const message = event.message ?? (await mailClient().getMessage(event.inboxId, event.messageId));
  return { handled: true, result: await processInbound(inbox.groupId, message, { eventId: event.eventId, now }) };
}
