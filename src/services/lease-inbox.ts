// Lease Inbox (ADR 0016): the Group's own email address, what arrives in it, work orders, and mail Roomie sends for a
// Member. The pure rules live next door (send-rule.ts, lease-inbox-rules.ts, lib/forwarded.ts); this module is the
// DB and the mail client around them. The classifier is injected (setClassifier, like setReceiptReader).
//
// Refining ADR 0016 decision 3: a forward teaches the landlord only when a known Member sent it (their Account
// email); a sender on a public mail domain (gmail.com, outlook.com...) is trusted by exact address, never its domain.
//
// What a class *does* beyond this module (a Reminder row, the urgent slot, Documents, the Admin's DM, the rent
// proposal, a utility prefill) goes through `InboundHooks`; lease-inbox-inbound.ts processInbound wires each one to
// its slot (reminders, urgent, documents, nudges, rent, recurring). Unset here, a hook is a no-op.
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { MAIL_CLASSES } from "@/db/enums";
import { mailClient, type MailMessage } from "@/integrations/mail";
import { addressOf, domainOf, parseForwarded } from "@/lib/forwarded";
import { addDaysToDay, zonedTimeToUtc } from "@/lib/time";
import { recordFor } from "./activity";
import { NotAllowedError, requireActive, requireAdmin } from "./authz";
import { isUrgent, mailLine, nextStatus, pickWorkOrder, saysYes, senderName, type WorkOrderReply, type WorkOrderState } from "./lease-inbox-rules";
import { keywordClassifier, smallModelClassifier } from "./mail-classifier";
import { CONFLICT_WINDOW_MS, sendRule, signature, type OtherInstruction, type SendIntent } from "./send-rule";
import type { Ctx, GroupCtx } from "./types";

const { groupInboxes, mailEvents, mailMessages, landlordSenders, workOrders, sentMail, members, accounts, groups } = schema;

export const NO_INBOX = 'There\'s no Lease Inbox here yet. An admin can say "roomie, learn lease inbox".';
const NO_LANDLORD = "Who should I send it to? Forward me an email from the landlord first, or tell me their address.";

/* ---------- the inbox ---------- */

/** "Apt 4B" -> "apt-4b": AgentMail usernames are lowercase letters, digits and dashes. */
export function inboxSlug(groupName: string): string {
  const slug = groupName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");
  return slug || "home";
}

const randomTail = () => {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  return [...randomBytes(4)].map((b) => abc[b % abc.length]).join("");
};

export async function inboxOf(groupId: string) {
  const [row] = await db.select().from(groupInboxes).where(eq(groupInboxes.groupId, groupId));
  return row ?? null;
}

/** The Group's address, made on first ask (teaching Lease Inbox). Asking again returns the same one. */
export async function ensureInbox(ctx: Ctx): Promise<{ inboxId: string; address: string; created: boolean }> {
  await requireActive(ctx);
  const have = await inboxOf(ctx.groupId);
  if (have) return { inboxId: have.inboxId, address: have.address, created: false };
  const [group] = await db.select({ name: groups.name }).from(groups).where(eq(groups.id, ctx.groupId));
  // AgentMail dedupes on clientId = the Group, so a retry after a crash gets the same inbox back.
  const made = await mailClient().createInbox(ctx.groupId, `${inboxSlug(group?.name ?? "")}-${randomTail()}`);
  const inserted = await db
    .insert(groupInboxes)
    .values({ groupId: ctx.groupId, inboxId: made.inboxId, address: made.address })
    .onConflictDoNothing({ target: groupInboxes.groupId })
    .returning();
  if (inserted.length) await recordFor(ctx, "lease.inbox", `set up the Lease Inbox: ${made.address}`);
  const row = inserted[0] ?? (await inboxOf(ctx.groupId))!;
  return { inboxId: row.inboxId, address: row.address, created: inserted.length > 0 };
}

/**
 * Internal (deleting a Group or its data): the AgentMail inbox, then the group_inboxes row. Best-effort: a failure is
 * logged with the inbox id (so an operator can release it by hand) and never thrown. Returns the released address.
 */
export async function releaseGroupInbox(groupId: string): Promise<string | null> {
  try {
    const inbox = await inboxOf(groupId);
    if (!inbox) return null;
    await mailClient()
      .deleteInbox(inbox.inboxId)
      .catch((e) => console.warn(`[mail] couldn't release ${inbox.address} (inbox ${inbox.inboxId}) of Group ${groupId}:`, e instanceof Error ? e.message : e));
    await db.delete(groupInboxes).where(eq(groupInboxes.groupId, groupId));
    return inbox.address;
  } catch (e) {
    console.warn(`[mail] releasing the inbox of Group ${groupId} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/* ---------- who the landlord is ---------- */

/** Public mail providers: trusting the domain would trust everyone on it, so only the address counts. */
const SHARED_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "yandex.com", "zoho.com",
]);

type SenderSource = (typeof landlordSenders.$inferInsert)["source"];

/** The rows trusting `addressOrDomain`: the address and, unless it's a public mail provider, its whole domain. */
function trustRows(addressOrDomain: string): string[] {
  const address = addressOf(addressOrDomain);
  if (!address) {
    const domain = addressOrDomain.trim().toLowerCase().replace(/^@/, "");
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) && !SHARED_DOMAINS.has(domain) ? [domain] : [];
  }
  const domain = domainOf(address)!;
  return SHARED_DOMAINS.has(domain) ? [address] : [address, domain];
}

async function addTrusted(groupId: string, addressOrDomain: string, source: SenderSource): Promise<string[]> {
  const values = trustRows(addressOrDomain);
  if (!values.length) throw new Error(`"${addressOrDomain}" isn't an email address or a domain.`);
  await db
    .insert(landlordSenders)
    .values(values.map((value) => ({ groupId, value, source })))
    .onConflictDoNothing();
  return values;
}

/** An Admin's "yes, that's our building" (source admin), or the intro email's recipient. */
export async function trustSender(ctx: Ctx, addressOrDomain: string, source: SenderSource): Promise<{ trusted: string[]; line: string }> {
  if (source === "admin") await requireAdmin(ctx);
  else await requireActive(ctx);
  const trusted = await addTrusted(ctx.groupId, addressOrDomain, source);
  const widest = trusted.at(-1)!;
  await recordFor(ctx, "lease.trust", `marked ${widest} as the landlord`);
  return { trusted, line: `I'll treat ${widest} as the landlord from now on.` };
}

/** What trusting this sender would trust at its widest: the domain, or the address on a public mail provider. */
export const widestTrust = (addressOrDomain: string): string | null => trustRows(addressOrDomain).at(-1) ?? null;

/** The newest sender filed as new-sender that isn't trusted yet: who "is this your building?" asked about. */
export async function askedSender(groupId: string): Promise<string | null> {
  const rows = await db
    .select({ original: mailMessages.originalFrom, address: mailMessages.fromAddress })
    .from(mailMessages)
    .where(and(eq(mailMessages.groupId, groupId), eq(mailMessages.class, "new-sender")))
    .orderBy(desc(mailMessages.receivedAt))
    .limit(20);
  for (const r of rows) {
    const sender = r.original ?? r.address;
    if (!(await isTrusted(groupId, sender))) return sender;
  }
  return null;
}

export async function knownSenders(groupId: string): Promise<string[]> {
  const rows = await db.select({ value: landlordSenders.value }).from(landlordSenders).where(eq(landlordSenders.groupId, groupId)).orderBy(asc(landlordSenders.createdAt));
  return rows.map((r) => r.value);
}

export async function isTrusted(groupId: string, address: string): Promise<boolean> {
  const a = addressOf(address);
  if (!a) return false;
  const hits = await db
    .select({ value: landlordSenders.value })
    .from(landlordSenders)
    .where(and(eq(landlordSenders.groupId, groupId), inArray(landlordSenders.value, [a, domainOf(a)!])));
  return hits.length > 0;
}

/** Where a new email to the landlord goes: the first landlord address Roomie learned. */
async function landlordAddress(groupId: string): Promise<string | null> {
  return (await knownSenders(groupId)).find((v) => v.includes("@")) ?? null;
}

/* ---------- inbound ---------- */

export type StoreResult = { stored: boolean; duplicate: boolean; id?: string; sender?: string; trusted?: boolean };

/** The Member whose Account email sent this (a Member forwarding mail), if any. */
async function memberByEmail(groupId: string, address: string) {
  const [m] = await db
    .select({ id: members.id, status: members.status })
    .from(members)
    .innerJoin(accounts, eq(accounts.id, members.accountId))
    .where(and(eq(members.groupId, groupId), sql`lower(${accounts.email}) = ${address}`));
  return m ?? null;
}

/** A delivery taken over this long ago and never processed is taken again by the next one (the run died or failed). */
export const MAIL_EVENT_RETRY_MS = 10 * 60_000;

/**
 * A webhook delivery's event_id: "fresh" (first time; process it), "retry" (taken over 10 minutes ago and never
 * processed: process it again), "done" (processed) or "busy" (another delivery is processing it right now). Taking
 * a stale event moves its created_at to now, in one statement, so two retries can't both take it.
 */
export async function claimMailEvent(groupId: string, eventId: string, now = new Date()): Promise<"fresh" | "retry" | "done" | "busy"> {
  const fresh = await db.insert(mailEvents).values({ eventId, groupId, createdAt: now }).onConflictDoNothing().returning({ id: mailEvents.eventId });
  if (fresh.length) return "fresh";
  const retaken = await db
    .update(mailEvents)
    .set({ createdAt: now })
    .where(and(eq(mailEvents.eventId, eventId), isNull(mailEvents.processedAt), lt(mailEvents.createdAt, new Date(now.getTime() - MAIL_EVENT_RETRY_MS))))
    .returning({ id: mailEvents.eventId });
  if (retaken.length) return "retry";
  const [row] = await db.select({ processedAt: mailEvents.processedAt }).from(mailEvents).where(eq(mailEvents.eventId, eventId));
  return row?.processedAt ? "done" : "busy";
}

/** The event's email was handled end to end: a later delivery of it is a duplicate. */
export async function finishMailEvent(eventId: string, now = new Date()): Promise<void> {
  await db.update(mailEvents).set({ processedAt: now }).where(eq(mailEvents.eventId, eventId));
}

/**
 * Keep an inbound email once (keyed by inbox + message id: a second store returns the same row as a duplicate). A
 * forward is judged by its original sender, and replies go to that sender (reply_to). When an active Member
 * forwarded it, that sender becomes a landlord sender, but only if the mail is authenticated: AgentMail's
 * "unauthenticated" label (SPF / DKIM / DMARC failed) means the envelope could be anyone, so such a forward teaches
 * nothing and is filed as a new sender. Untrusted mail is filed as new-sender.
 */
export async function storeInbound(groupId: string, message: MailMessage): Promise<StoreResult> {
  const envelope = addressOf(message.from) ?? message.from.toLowerCase();
  const authenticated = !message.labels.includes("unauthenticated");
  const forwarded = parseForwarded(message.text, message.html);
  const forwarder = forwarded ? await memberByEmail(groupId, envelope) : null;
  const sender = forwarded?.from ?? envelope;
  if (forwarded && authenticated && forwarder?.status === "active") await addTrusted(groupId, sender, "forward");
  const trusted = authenticated && (await isTrusted(groupId, sender));

  const [row] = await db
    .insert(mailMessages)
    .values({
      groupId,
      inboxId: message.inboxId,
      messageId: message.messageId,
      threadId: message.threadId,
      fromHeader: message.from,
      fromAddress: envelope,
      originalFrom: forwarded?.from ?? null,
      forwardedBy: authenticated ? (forwarder?.id ?? null) : null,
      replyTo: forwarded?.from ?? null,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      receivedAt: message.receivedAt,
      class: trusted ? null : "new-sender",
      trusted,
    })
    .onConflictDoNothing()
    .returning({ id: mailMessages.id });
  if (row) return { stored: true, duplicate: false, id: row.id, sender, trusted };
  const [have] = await db
    .select({ id: mailMessages.id, trusted: mailMessages.trusted })
    .from(mailMessages)
    .where(and(eq(mailMessages.groupId, groupId), eq(mailMessages.messageId, message.messageId)));
  return { stored: false, duplicate: true, id: have?.id, sender, trusted: have?.trusted ?? false };
}

/* ---------- classification ---------- */

export const ClassificationSchema = z.object({
  class: z.enum(["notice", "rent-lease", "work-order", "other"]),
  /** The notice's or the visit's date: local "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" in the Group's zone. */
  date: z.string().optional(),
  amountCents: z.number().int().nonnegative().optional(),
  utility: z.string().optional(),
  /** For a work-order reply: how far it says the repair got. */
  reply: z.enum(["acknowledged", "scheduled", "done", "other"]).optional(),
  summary: z.string().min(1),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export type ClassifyInput = { from: string; subject: string; text: string; timezone: string; now: Date; workOrderTitle: string | null };
export interface MailClassifier {
  classify(input: ClassifyInput): Promise<Classification>;
}

/** The small model on the gateway (mail-classifier.ts: strict JSON, one retry, `other` on failure); keywords with MAIL_CLASSIFIER_FAKE=1. */
export const gatewayClassifier: MailClassifier = {
  classify: (input) => (process.env.MAIL_CLASSIFIER_FAKE === "1" ? keywordClassifier : smallModelClassifier).classify(input),
};

let classifier: MailClassifier | null = null;
/** Tests swap the classifier; null goes back to the gateway one. */
export function setClassifier(c: MailClassifier | null) {
  classifier = c;
}

/**
 * Side effects of a class that belong to other Tricks and slots. Every one defaults to a no-op; lease-inbox-inbound.ts
 * processInbound wires them.
 */
export type InboundHooks = {
  /** A whole-group Reminder (services/reminders.ts) at `at`. */
  remind?(groupId: string, at: Date, text: string): Promise<void>;
  /** The day's urgent slot (services/urgent.ts) for `line`. */
  urgent?(groupId: string, line: string): Promise<void>;
  /** Documents from the attachments, ids into mail_messages.document_ids. */
  fileDocuments?(groupId: string, mailId: string): Promise<void>;
  /** A private question to the Admins, once per domain (pet_moments "new-sender"); "yes" -> trust_sender. */
  askAdmin?(groupId: string, text: string): Promise<void>;
  /** The Admins privately: the words that run set_rent; nothing changes until they say them. */
  proposeRent?(groupId: string, mailId: string, amountCents: number | null): Promise<void>;
  /** pending_amounts.prefill for the matching variable Expense (recurring.prefillAmount). */
  prefillUtility?(groupId: string, utility: string, amountCents: number): Promise<void>;
};

export type ClassifyResult = {
  class: (typeof MAIL_CLASSES)[number];
  /** One line for the group chat, or null for nothing. */
  line: string | null;
  urgent: boolean;
  reminderAt: Date | null;
  /** For a new sender: the private question to the Admin. */
  adminAsk: string | null;
  workOrderId: string | null;
};

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A notice's Reminder: 18:00 local on the day before its date. */
export function eveningBefore(noticeDate: string, timezone: string): Date | null {
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(noticeDate.trim())?.[1];
  if (!day) return null;
  const [y, m, d] = addDaysToDay(day, -1).split("-").map(Number);
  return zonedTimeToUtc(timezone, { year: y, month: m, day: d, hour: 18, minute: 0, second: 0 });
}

/** Read one stored email and do what its class says. Untrusted mail is never classified: the Admin is asked. */
export async function classifyInbound(groupId: string, mailId: string, opts: { now?: Date; hooks?: InboundHooks } = {}): Promise<ClassifyResult> {
  const now = opts.now ?? new Date();
  const hooks = opts.hooks ?? {};
  const [m] = await db.select().from(mailMessages).where(and(eq(mailMessages.groupId, groupId), eq(mailMessages.id, mailId)));
  if (!m) throw new Error(`No such email: ${mailId}`);
  const none = { line: null, urgent: false, reminderAt: null, adminAsk: null, workOrderId: null };

  if (!m.trusted) {
    const subject = parseForwarded(m.text, m.html)?.subject ?? m.subject;
    const adminAsk = `${m.originalFrom ?? m.fromAddress} emailed about "${subject}": is that your building?`;
    await hooks.askAdmin?.(groupId, adminAsk);
    return { ...none, class: "new-sender", adminAsk };
  }

  const [group] = await db.select({ timezone: groups.timezone }).from(groups).where(eq(groups.id, groupId));
  const timezone = group?.timezone ?? "America/Chicago";
  const [order] = await db.select().from(workOrders).where(and(eq(workOrders.groupId, groupId), eq(workOrders.threadId, m.threadId))).orderBy(desc(workOrders.createdAt)).limit(1);
  const raw = await (classifier ?? gatewayClassifier).classify({ from: m.fromHeader, subject: m.subject, text: m.text, timezone, now, workOrderTitle: order?.title ?? null });
  const c = ClassificationSchema.parse(raw);

  await db
    .update(mailMessages)
    .set({ class: c.class, summary: c.summary, noticeDate: c.date ?? null, amountCents: c.amountCents ?? null, utility: c.utility ?? null })
    .where(eq(mailMessages.id, m.id));
  await hooks.fileDocuments?.(groupId, m.id);
  if (c.utility && c.amountCents !== undefined) await hooks.prefillUtility?.(groupId, c.utility, c.amountCents);

  // A forward's From is the Member who forwarded it, so it reads as the landlord.
  const sender = senderName(m.originalFrom ? null : m.fromHeader);
  if (c.class === "notice") {
    const line = mailLine({ class: "notice", sender, summary: c.summary });
    const reminderAt = c.date ? eveningBefore(c.date, timezone) : null;
    if (reminderAt && reminderAt > now) await hooks.remind?.(groupId, reminderAt, capitalized(c.summary));
    const urgent = !!c.date && isUrgent(c.date, now, timezone);
    if (urgent) await hooks.urgent?.(groupId, line);
    return { ...none, class: "notice", line, urgent, reminderAt };
  }
  if (c.class === "rent-lease") {
    await hooks.proposeRent?.(groupId, m.id, c.amountCents ?? null);
    return { ...none, class: "rent-lease", line: mailLine({ class: "rent-lease", sender, summary: c.summary }) };
  }
  if (c.class === "work-order" && order) {
    const reply: WorkOrderReply = c.reply === "scheduled" ? { kind: "scheduled", date: c.date ?? "" } : { kind: c.reply ?? "other" };
    await advanceWorkOrder(groupId, order.id, reply, c.summary, now);
    return { ...none, class: "work-order", line: mailLine({ class: "work-order", sender, summary: c.summary, title: order.title }), workOrderId: order.id };
  }
  // Everything else from the landlord is one line too (and filed), like a notification. A utility bill isn't: its
  // payer is asked privately, with the amount pre-filled.
  return { ...none, class: c.class, line: c.summary && !c.utility ? mailLine({ class: "other", sender, summary: c.summary }) : null };
}

/* ---------- work orders ---------- */

export async function createWorkOrder(ctx: Ctx, input: { title: string; threadId: string }) {
  await requireActive(ctx);
  const [row] = await db.insert(workOrders).values({ groupId: ctx.groupId, title: input.title, reportedBy: ctx.memberId, threadId: input.threadId }).returning();
  await recordFor(ctx, "lease.work_order", `reported ${input.title}`, { table: "work_orders", id: row.id });
  return row;
}

/** A landlord reply moves the work order (nextStatus); the reply's gist is kept either way. */
export async function advanceWorkOrder(groupId: string, workOrderId: string, reply: WorkOrderReply, lastReply: string, now = new Date()) {
  const [row] = await db.select().from(workOrders).where(and(eq(workOrders.groupId, groupId), eq(workOrders.id, workOrderId)));
  if (!row) throw new Error(`No such work order: ${workOrderId}`);
  const next = nextStatus({ status: row.status, scheduledFor: row.scheduledFor } satisfies WorkOrderState, reply);
  const [updated] = await db
    .update(workOrders)
    .set({ status: next.status, scheduledFor: next.scheduledFor, lastReply, lastActivityAt: now })
    .where(eq(workOrders.id, row.id))
    .returning();
  return { ...updated, changed: next.changed };
}

export type WorkOrderStatus = { id: string; title: string; status: WorkOrderState["status"]; scheduledFor: string | null; lastReply: string | null; lastActivityAt: Date };

/**
 * "What's up with the sink?": the work order it means (pickWorkOrder: the only open one, else a whole-word match on
 * the title), `{ choices }` (the open ones' titles) when it could be several, or null.
 */
export async function workOrderStatus(ctx: GroupCtx, input: { what?: string }): Promise<WorkOrderStatus | { choices: string[] } | null> {
  const rows = await db.select().from(workOrders).where(eq(workOrders.groupId, ctx.groupId)).orderBy(desc(workOrders.createdAt));
  const pick = pickWorkOrder(rows, input.what);
  if (!pick) return null;
  if ("choices" in pick) return { choices: pick.choices.map((o) => o.title) };
  const hit = pick.order;
  return { id: hit.id, title: hit.title, status: hit.status, scheduledFor: hit.scheduledFor, lastReply: hit.lastReply, lastActivityAt: hit.lastActivityAt };
}

/* ---------- sending ---------- */

/**
 * How a Member says yes to a send Roomie asked about: their own latest message (chat, a DM, the dashboard's Ask) or
 * the dashboard's "Send anyway" with the token the ask came back with. Neither sends by itself: only with a held send
 * for the same recipient and draft that hasn't expired.
 */
export type SendApproval = { latest: string } | { token: string };

export type SendInput = {
  intent: SendIntent;
  /** Reply in this thread (to its newest landlord email); otherwise a new email to `to` or the landlord. */
  threadId?: string;
  to?: string;
  subject?: string;
  body: string;
  /** What the Member said, word for word (the send rule reads it). */
  instruction: string;
  /** The gist for the chat line: "asked them to move the inspection to Thursday". */
  summary: string;
  approval?: SendApproval;
  workOrderId?: string;
};

export type SendResult = { sent: true; line: string; threadId: string; messageId: string; sentMailId: string } | { sent: false; ask: string[]; confirmToken?: string };

const idempotencyKey = (...parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 40);

/* ---------- held sends: the "question or two first" ---------- */

/** How long a held send waits for the Member's yes (as long as the admin ask's confirmation). */
export const HELD_SEND_TTL_MS = 10 * 60_000;

/**
 * A send the rule asked about, held for the Member Roomie asked: the recipient and a hash of the exact draft, the
 * questions, what the Member first said (sent_mail keeps that, not their "yes"), the dashboard's token, until when.
 * In this process's memory, like the admin ask's confirmations (toolkits/registry.ts): one server process, and a
 * restart only means the questions come again.
 */
type HeldSend = { to: string; draft: string; questions: string[]; instruction: string; token: string; until: number };
const heldSends = (): Map<string, HeldSend> => {
  const g = globalThis as { __roomieHeldSends?: Map<string, HeldSend> };
  return (g.__roomieHeldSends ??= new Map());
};
const heldKey = (ctx: Ctx) => `${ctx.groupId}:${ctx.memberId}`;

/** The draft as it would go, however the model spaces or capitalises it: thread, subject and body. */
const draftHash = (to: string, threadId: string | undefined, subject: string | undefined, body: string) =>
  idempotencyKey(to.trim().toLowerCase(), threadId ?? "", (subject ?? "").trim().toLowerCase(), body.replace(/\s+/g, " ").trim().toLowerCase());

/** The held send this approval releases (taken: it can't release a second email), or null. */
function takeHeld(ctx: Ctx, to: string, draft: string, approval: SendApproval | undefined, now: Date): HeldSend | null {
  if (!approval) return null;
  const held = heldSends().get(heldKey(ctx));
  if (!held || held.until <= now.getTime() || held.to !== to.trim().toLowerCase() || held.draft !== draft) return null;
  if ("token" in approval ? approval.token !== held.token : !saysYes(approval.latest)) return null;
  heldSends().delete(heldKey(ctx));
  return held;
}

function hold(ctx: Ctx, send: Omit<HeldSend, "token" | "until">, now: Date): string {
  const token = randomBytes(12).toString("base64url");
  const all = heldSends();
  all.set(heldKey(ctx), { ...send, token, until: now.getTime() + HELD_SEND_TTL_MS });
  if (all.size > 5_000) for (const [k, h] of all) if (h.until <= now.getTime()) all.delete(k);
  return token;
}

/** Other Members' replies in this thread within the hour: the send rule asks when they said something else. */
async function othersInThread(groupId: string, threadId: string, now: Date): Promise<OtherInstruction[]> {
  const rows = await db
    .select({ memberId: sentMail.memberId, name: members.displayName, text: sentMail.instruction, at: sentMail.createdAt })
    .from(sentMail)
    .leftJoin(members, eq(members.id, sentMail.memberId))
    .where(and(eq(sentMail.groupId, groupId), eq(sentMail.threadId, threadId), eq(sentMail.intent, "reply"), gte(sentMail.createdAt, new Date(now.getTime() - CONFLICT_WINDOW_MS))));
  return rows.map((r) => ({ memberId: r.memberId ?? "", name: r.name ?? "Someone", text: r.text, at: r.at }));
}

export const ONLY_THE_LANDLORD = 'I only reply to the landlord. If that sender is them, an admin can say "roomie, treat them as the landlord" first.';

/**
 * Email the landlord for a Member. A reply in a thread goes to its newest email's sender (a forward's original
 * sender: reply_to), and only when that sender is a trusted landlord sender now: anyone else is refused whatever
 * the caller says (trust_sender first). The send rule decides: simple mail goes at once; anything else is held and
 * comes back as the questions (and a token for the dashboard), and goes only when the same Member approves the same
 * recipient and draft within 10 minutes (SendApproval). Every email ends with the signature naming the Member and is
 * recorded in sent_mail.
 */
export async function sendToLandlord(ctx: Ctx, input: SendInput, now = new Date()): Promise<SendResult> {
  const actor = await requireActive(ctx);
  const inbox = await inboxOf(ctx.groupId);
  if (!inbox) throw new Error(NO_INBOX);
  const [group] = await db.select({ name: groups.name }).from(groups).where(eq(groups.id, ctx.groupId));

  let to: string | null;
  let replyTo: { messageId: string; to: string } | null = null;
  let intent = input.intent;
  if (input.threadId) {
    const [inbound] = await db
      .select({ messageId: mailMessages.messageId, from: mailMessages.fromHeader, replyTo: mailMessages.replyTo })
      .from(mailMessages)
      .where(and(eq(mailMessages.groupId, ctx.groupId), eq(mailMessages.threadId, input.threadId)))
      .orderBy(desc(mailMessages.receivedAt))
      .limit(1);
    const [ours] = inbound
      ? []
      : await db.select().from(sentMail).where(and(eq(sentMail.groupId, ctx.groupId), eq(sentMail.threadId, input.threadId))).orderBy(desc(sentMail.createdAt)).limit(1);
    if (!inbound && !ours) throw new Error("I can't find that email thread.");
    to = inbound ? (inbound.replyTo ?? inbound.from) : ours!.to;
    if (inbound && !(await isTrusted(ctx.groupId, to))) throw new NotAllowedError(ONLY_THE_LANDLORD, "not-yours");
    replyTo = { messageId: inbound?.messageId ?? ours!.messageId, to };
    // "reply" is simple only in a thread the landlord wrote in; a follow-up on our own work order is still one.
    if (intent === "reply" && !inbound) intent = ours?.intent === "maintenance" ? "maintenance" : "other";
  } else {
    to = input.to ?? (await landlordAddress(ctx.groupId));
    if (!to) return { sent: false, ask: [NO_LANDLORD] };
  }

  const verdict = sendRule(
    { to, body: input.body },
    {
      intent,
      knownSenders: await knownSenders(ctx.groupId),
      memberText: input.instruction,
      memberId: ctx.memberId,
      others: input.threadId ? await othersInThread(ctx.groupId, input.threadId, now) : [],
      now,
    },
  );
  let instruction = input.instruction;
  if (!verdict.ok) {
    const draft = draftHash(to, input.threadId, input.subject, input.body);
    const held = takeHeld(ctx, to, draft, input.approval, now);
    if (!held) {
      const confirmToken = hold(ctx, { to: to.trim().toLowerCase(), draft, questions: verdict.ask, instruction: input.instruction }, now);
      return { sent: false, ask: verdict.ask, confirmToken };
    }
    instruction = held.instruction;
  }

  const text = `${input.body.trim()}\n\n${signature(group?.name ?? "the apartment", actor.displayName)}`;
  const headers = { "Idempotency-Key": idempotencyKey(ctx.groupId, input.threadId ?? "", to, text) };
  const subject = input.subject ?? `From the residents of ${group?.name ?? "the apartment"}`;
  const client = mailClient();
  const ref = replyTo
    ? await client.reply(inbox.inboxId, replyTo.messageId, { text, to: replyTo.to, headers })
    : await client.send(inbox.inboxId, { to, subject, text, headers });

  const [row] = await db
    .insert(sentMail)
    .values({
      groupId: ctx.groupId,
      memberId: ctx.memberId,
      intent: input.intent,
      to,
      subject,
      instruction,
      summary: input.summary,
      messageId: ref.messageId,
      threadId: ref.threadId,
      workOrderId: input.workOrderId ?? null,
    })
    .returning({ id: sentMail.id });
  await recordFor(ctx, "lease.sent", `emailed the landlord: ${input.summary}`, { table: "sent_mail", id: row.id });
  return { sent: true, line: `Sent: ${input.summary}.`, threadId: ref.threadId, messageId: ref.messageId, sentMailId: row.id };
}
/** "The sink's leaking, tell them": a work order emailed to the landlord, and followed from then on. */
export async function reportIssue(ctx: Ctx, input: { what: string; details?: string; instruction: string; approval?: SendApproval }): Promise<SendResult & { workOrderId?: string }> {
  await requireActive(ctx);
  const [group] = await db.select({ name: groups.name }).from(groups).where(eq(groups.id, ctx.groupId));
  const what = input.what.trim();
  // The model's part is `details` (what the Member said about it, in their words); the send rule reads it like any body.
  const details = input.details?.trim() ? `\n\n${input.details.trim()}` : "";
  const body = `Hi,\n\nWe'd like to put in a work order for ${group?.name ?? "our apartment"}: ${what}.${details}\nCould someone take a look?\n\nThanks.`;
  const r = await sendToLandlord(ctx, { intent: "maintenance", subject: `Work order: ${what}`, body, instruction: input.instruction, summary: `reported ${what}`, approval: input.approval });
  if (!r.sent) return r;
  const order = await createWorkOrder(ctx, { title: what, threadId: r.threadId });
  await db.update(sentMail).set({ workOrderId: order.id }).where(eq(sentMail.id, r.sentMailId));
  return { ...r, workOrderId: order.id };
}

const joinNames = (n: string[]) => (n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`);

/**
 * The one-time intro email to the landlord, signed with every active Member's first name. Once per landlord domain.
 * Offered to the Admins once (pet_moments "lease-intro") when a forward teaches the landlord (lease-inbox-inbound.ts).
 */
export async function sendIntro(ctx: Ctx): Promise<{ sent: true; line: string } | { sent: false; reason: "no-landlord" | "already-sent" }> {
  await requireActive(ctx);
  const to = await landlordAddress(ctx.groupId);
  if (!to) return { sent: false, reason: "no-landlord" };
  const already = await db
    .select({ id: sentMail.id })
    .from(sentMail)
    .where(and(eq(sentMail.groupId, ctx.groupId), eq(sentMail.intent, "intro"), like(sentMail.to, `%@${domainOf(to)}`)));
  if (already.length) return { sent: false, reason: "already-sent" };

  const [group] = await db.select({ name: groups.name }).from(groups).where(eq(groups.id, ctx.groupId));
  const people = await db
    .select({ name: members.displayName })
    .from(members)
    .where(and(eq(members.groupId, ctx.groupId), eq(members.status, "active")))
    .orderBy(asc(members.joinedAt));
  const names = joinNames(people.map((p) => p.name.trim().split(/\s+/)[0]));
  const body = `Hi,\n\nThis is the shared email address for the residents of ${group?.name ?? "our apartment"}: ${names}. Mail sent here reaches all of us, so it's the best place for repairs, building news and anything about the apartment.\n\nThanks,\n${names}`;
  const r = await sendToLandlord(ctx, { intent: "intro", to, subject: `Our shared address for ${group?.name ?? "the apartment"}`, body, instruction: "send the intro email", summary: "introduced the shared inbox to the landlord" });
  if (!r.sent) throw new Error(`The intro email was refused: ${r.ask.join(" ")}`);
  return { sent: true, line: r.line };
}
