// The Lease Inbox Trick around the core (lease-inbox.ts): teaching it (the address and the connect line), the
// address and the trusted senders as people see and manage them, sending for a Member with the thread found from
// what they said, the Bundle and report lines, the dashboard inbox, and forget me. Thin over the core and the pure
// rules (lease-inbox-rules.ts).
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { deliver } from "@/channels";
import { db, schema } from "@/db";
import type { MailClass } from "@/db/enums";
import { mailClient } from "@/integrations/mail";
import { formatInZone } from "@/lib/time";
import { recordFor } from "./activity";
import { requireAdmin } from "./authz";
import { logMessage } from "./chatlog";
import { askedSender, ensureInbox, inboxOf, knownSenders, NO_INBOX, sendToLandlord, trustSender, workOrderStatus, type SendResult } from "./lease-inbox";
import { leaseBundleText, leaseReportText, type QuietOrder } from "./lease-inbox-rules";
import { admins } from "./members";
import type { ReportPart } from "./report";
import { groupTimezone } from "./schedule";
import type { Ctx, GroupCtx } from "./types";

const { groupInboxes, landlordSenders, mailMessages, workOrders, sentMail, members } = schema;

/* ---------- teaching it ---------- */

/** What Roomie says with the address (ADR 0016 decision 2): three ways to connect, not a flow. */
export const connectLine = (address: string) =>
  `📬 Our email address is ${address}. To connect the landlord: forward me the lease or their last email, CC this address next time you email them, or give it to the leasing office.`;

/** The Trick's onEnable: the address (made once) and the connect line in the Chat. Teaching it twice adds nothing new. */
export async function startLeaseInbox(ctx: { groupId: string; memberId: string | null }): Promise<{ address: string } | null> {
  const memberId = ctx.memberId ?? (await admins({ groupId: ctx.groupId }))[0]?.id;
  if (!memberId) return null;
  const { address } = await ensureInbox({ groupId: ctx.groupId, memberId, source: "chat" });
  const text = connectLine(address);
  await deliver(ctx.groupId, { text });
  await logMessage(ctx.groupId, null, text);
  return { address };
}

/** "What's our email address?": the address, the landlord senders known, and the connect line. */
export async function inboxStatus(ctx: GroupCtx): Promise<{ address: string | null; landlord: string[]; line: string }> {
  const inbox = await inboxOf(ctx.groupId);
  if (!inbox) return { address: null, landlord: [], line: NO_INBOX };
  const landlord = await knownSenders(ctx.groupId);
  const who = landlord.length ? ` I know the landlord as ${landlord.filter((v) => !v.includes("@")).join(", ") || landlord[0]}.` : " I don't know the landlord yet.";
  return { address: inbox.address, landlord, line: `${connectLine(inbox.address)}${who}` };
}

/** Admin: give up the address. AgentMail's inbox goes, then the row; what was filed (mail, Documents) stays. */
export async function releaseInbox(ctx: Ctx): Promise<{ released: string | null }> {
  await requireAdmin(ctx);
  const inbox = await inboxOf(ctx.groupId);
  if (!inbox) return { released: null };
  await mailClient().deleteInbox(inbox.inboxId);
  await db.delete(groupInboxes).where(eq(groupInboxes.groupId, ctx.groupId));
  await recordFor(ctx, "lease.released", `released the Lease Inbox address ${inbox.address}`);
  return { released: inbox.address };
}

/** "Is this your building?" -> "yes": the sender named, else the newest one the Admins were asked about. */
export async function trustAsked(ctx: Ctx, sender?: string | null): Promise<{ trusted: string[]; line: string } | { trusted: []; line: string }> {
  await requireAdmin(ctx);
  const who = sender?.trim() || (await askedSender(ctx.groupId));
  if (!who) return { trusted: [], line: "I haven't asked about anyone. Who should I treat as the landlord?" };
  return trustSender(ctx, who, "admin");
}

/** Admin (Settings): stop treating an address or domain as the landlord. */
export async function removeSender(ctx: Ctx, value: string): Promise<{ removed: boolean }> {
  await requireAdmin(ctx);
  const rows = await db.delete(landlordSenders).where(and(eq(landlordSenders.groupId, ctx.groupId), eq(landlordSenders.value, value.trim().toLowerCase()))).returning();
  if (rows.length) await recordFor(ctx, "lease.untrust", `stopped treating ${value} as the landlord`);
  return { removed: rows.length > 0 };
}

/* ---------- sending for a Member ---------- */

const wordsOf = (s: string) => s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];

/** The thread "ask them to move the inspection" means: a work order by its words, else the landlord's email that matches, else their newest. */
export async function findThread(groupId: string, about: string | undefined): Promise<{ threadId: string; workOrderId: string | null } | null> {
  const words = wordsOf(about ?? "").filter((w) => !["the", "them", "landlord", "email", "about", "with"].includes(w));
  if (words.length) {
    const orders = await db.select({ id: workOrders.id, title: workOrders.title, threadId: workOrders.threadId }).from(workOrders).where(eq(workOrders.groupId, groupId)).orderBy(desc(workOrders.createdAt));
    const hit = orders.find((o) => words.some((w) => o.title.toLowerCase().includes(w)));
    if (hit) return { threadId: hit.threadId, workOrderId: hit.id };
  }
  const mail = await db
    .select({ threadId: mailMessages.threadId, subject: mailMessages.subject, summary: mailMessages.summary })
    .from(mailMessages)
    .where(and(eq(mailMessages.groupId, groupId), eq(mailMessages.trusted, true)))
    .orderBy(desc(mailMessages.receivedAt))
    .limit(30);
  const match = words.length ? mail.find((m) => words.some((w) => `${m.subject} ${m.summary ?? ""}`.toLowerCase().includes(w))) : undefined;
  const pick = match ?? mail[0];
  if (!pick) return null;
  const [order] = await db.select({ id: workOrders.id }).from(workOrders).where(and(eq(workOrders.groupId, groupId), eq(workOrders.threadId, pick.threadId)));
  return { threadId: pick.threadId, workOrderId: order?.id ?? null };
}

export type MemberSend = {
  /** reply = in the landlord's thread about `about`; new = a new email to the landlord. */
  intent: "reply" | "new";
  about?: string;
  body: string;
  summary: string;
  /** The Member's own words (the RequestContext's latest message). */
  instruction: string;
  confirmed?: boolean;
  /** A thread picked on the dashboard. */
  threadId?: string;
};

/** send_to_landlord and the dashboard's reply box: one rule (sendToLandlord), the thread found from what they said. */
export async function sendForMember(ctx: Ctx, input: MemberSend, now = new Date()): Promise<SendResult> {
  const thread = input.threadId ? { threadId: input.threadId, workOrderId: null as string | null } : input.intent === "reply" ? await findThread(ctx.groupId, input.about) : null;
  const order = thread?.workOrderId ?? (thread ? (await db.select({ id: workOrders.id }).from(workOrders).where(and(eq(workOrders.groupId, ctx.groupId), eq(workOrders.threadId, thread.threadId))))[0]?.id ?? null : null);
  const r = await sendToLandlord(
    ctx,
    {
      intent: thread ? "reply" : "other",
      ...(thread ? { threadId: thread.threadId } : {}),
      body: input.body,
      instruction: input.instruction,
      summary: input.summary.replace(/\.$/, ""),
      confirmed: input.confirmed,
      ...(order ? { workOrderId: order } : {}),
    },
    now,
  );
  // A follow-up counts as activity on the work order: the 5-day offer starts again.
  if (r.sent && order) await db.update(workOrders).set({ lastActivityAt: now }).where(eq(workOrders.id, order));
  return r;
}

/** "What's up with the sink?" as one line. */
export async function workOrderLine(ctx: GroupCtx, what?: string): Promise<{ found: boolean; line: string; status?: string; lastReply?: string | null; scheduledFor?: string | null }> {
  const s = await workOrderStatus(ctx, { what });
  if (!s) return { found: false, line: what ? `I haven't reported anything about ${what}.` : "No work orders yet." };
  const tz = await groupTimezone(ctx.groupId);
  const when = formatInZone(s.lastActivityAt, tz, { weekday: "short", month: "short", day: "numeric" });
  const state =
    s.status === "sent" ? `sent, no answer yet (since ${when})` : s.status === "acknowledged" ? `they've seen it (${when})` : s.status === "scheduled" ? `scheduled for ${s.scheduledFor}` : "done";
  return { found: true, status: s.status, lastReply: s.lastReply, scheduledFor: s.scheduledFor, line: `${s.title}: ${state}.${s.lastReply ? ` Last word from them: ${s.lastReply}` : ""}` };
}

/* ---------- Bundle and report ---------- */

async function openOrders(groupId: string): Promise<QuietOrder[]> {
  return db
    .select({ title: workOrders.title, status: workOrders.status, scheduledFor: workOrders.scheduledFor, lastActivityAt: workOrders.lastActivityAt })
    .from(workOrders)
    .where(and(eq(workOrders.groupId, groupId), inArray(workOrders.status, ["sent", "acknowledged", "scheduled"])))
    .orderBy(asc(workOrders.createdAt));
}

/** The Trick's morning Bundle line: a visit tomorrow, or a work order quiet for 5 days (offer to follow up). */
export async function leaseBundleLine(ctx: GroupCtx, now = new Date()): Promise<string | null> {
  const [orders, tz] = await Promise.all([openOrders(ctx.groupId), groupTimezone(ctx.groupId)]);
  return leaseBundleText(orders, tz, now);
}

/** The weekly report's part: notices and other emails that came in during the last 7 days. */
export async function leaseReportParts(ctx: GroupCtx, now = new Date()): Promise<ReportPart[]> {
  const since = new Date(now.getTime() - 7 * 24 * 3600_000);
  const rows = await db.select({ class: mailMessages.class }).from(mailMessages).where(and(eq(mailMessages.groupId, ctx.groupId), gte(mailMessages.receivedAt, since)));
  const notices = rows.filter((r) => r.class === "notice").length;
  const others = rows.filter((r) => r.class === "other" || r.class === "new-sender" || r.class === null).length;
  const text = leaseReportText(notices, others);
  return text ? [{ icon: "📬", text }] : [];
}

/* ---------- the dashboard ---------- */

export type InboxMail = {
  id: string;
  class: MailClass | null;
  from: string;
  subject: string;
  summary: string | null;
  text: string;
  threadId: string;
  receivedAt: Date;
  trusted: boolean;
  documentIds: string[];
};
export type InboxSent = { id: string; threadId: string; summary: string; to: string; by: string | null; at: Date };
export type InboxData = {
  address: string | null;
  senders: { value: string; source: string }[];
  mail: InboxMail[];
  sent: InboxSent[];
  workOrders: { id: string; title: string; status: string; scheduledFor: string | null; lastReply: string | null; threadId: string; reportedBy: string | null }[];
};

/** Everything the Inbox page shows, for an active Member (Pending Members see the address only). */
export async function inboxData(ctx: Ctx): Promise<InboxData> {
  const inbox = await inboxOf(ctx.groupId);
  const [me] = await db.select({ status: members.status }).from(members).where(and(eq(members.id, ctx.memberId), eq(members.groupId, ctx.groupId)));
  if (me?.status !== "active") return { address: inbox?.address ?? null, senders: [], mail: [], sent: [], workOrders: [] };
  const [senders, mail, sent, orders] = await Promise.all([
    db.select({ value: landlordSenders.value, source: landlordSenders.source }).from(landlordSenders).where(eq(landlordSenders.groupId, ctx.groupId)).orderBy(asc(landlordSenders.createdAt)),
    db
      .select({ id: mailMessages.id, class: mailMessages.class, from: mailMessages.fromHeader, original: mailMessages.originalFrom, subject: mailMessages.subject, summary: mailMessages.summary, text: mailMessages.text, threadId: mailMessages.threadId, receivedAt: mailMessages.receivedAt, trusted: mailMessages.trusted, documentIds: mailMessages.documentIds })
      .from(mailMessages)
      .where(eq(mailMessages.groupId, ctx.groupId))
      .orderBy(desc(mailMessages.receivedAt))
      .limit(200),
    db
      .select({ id: sentMail.id, threadId: sentMail.threadId, summary: sentMail.summary, to: sentMail.to, by: members.displayName, at: sentMail.createdAt })
      .from(sentMail)
      .leftJoin(members, eq(members.id, sentMail.memberId))
      .where(eq(sentMail.groupId, ctx.groupId))
      .orderBy(desc(sentMail.createdAt))
      .limit(200),
    db
      .select({ id: workOrders.id, title: workOrders.title, status: workOrders.status, scheduledFor: workOrders.scheduledFor, lastReply: workOrders.lastReply, threadId: workOrders.threadId, reportedBy: members.displayName })
      .from(workOrders)
      .leftJoin(members, eq(members.id, workOrders.reportedBy))
      .where(eq(workOrders.groupId, ctx.groupId))
      .orderBy(desc(workOrders.createdAt)),
  ]);
  return {
    address: inbox?.address ?? null,
    senders,
    mail: mail.map(({ original, ...m }) => ({ ...m, from: original ?? m.from, text: m.text.slice(0, 20_000) })),
    sent: sent.map((s) => ({ ...s, by: s.by ?? null })),
    workOrders: orders.map((o) => ({ ...o, reportedBy: o.reportedBy ?? null })),
  };
}

/* ---------- forget me ---------- */

/** "forget me": their name comes off work orders, sent-mail records and forwards; the emails were sent and stay. */
export async function anonymizeMailMember(groupId: string, memberId: string): Promise<number> {
  const a = await db.update(workOrders).set({ reportedBy: null }).where(and(eq(workOrders.groupId, groupId), eq(workOrders.reportedBy, memberId))).returning({ id: workOrders.id });
  const b = await db.update(sentMail).set({ memberId: null }).where(and(eq(sentMail.groupId, groupId), eq(sentMail.memberId, memberId))).returning({ id: sentMail.id });
  const c = await db.update(mailMessages).set({ forwardedBy: null }).where(and(eq(mailMessages.groupId, groupId), eq(mailMessages.forwardedBy, memberId))).returning({ id: mailMessages.id });
  return a.length + b.length + c.length;
}

