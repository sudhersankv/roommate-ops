// The Lease Inbox Trick around the core (lease-inbox.ts): teaching it (the address and the connect line), the
// address and the trusted senders as people see and manage them, sending for a Member with the thread found from
// what they said, the Bundle and report lines, the dashboard inbox, and forget me. Thin over the core and the pure
// rules (lease-inbox-rules.ts).
import { and, asc, desc, eq, gte, inArray, like } from "drizzle-orm";
import { deliver } from "@/channels";
import { db, schema } from "@/db";
import type { MailClass } from "@/db/enums";
import { mailClient } from "@/integrations/mail";
import { roomiePaused } from "@/lib/kill-switch";
import { daytimeHour } from "@/lib/quiet-hours";
import { dayInZone, formatInZone } from "@/lib/time";
import { recordFor } from "./activity";
import { requireAdmin } from "./authz";
import { logMessage } from "./chatlog";
import { askedSender, ensureInbox, inboxOf, knownSenders, NO_INBOX, sendToLandlord, trustSender, workOrderStatus, type SendApproval, type SendResult } from "./lease-inbox";
import { asksFollowUp, followUpBody, followUpCandidates, leaseBundleText, leaseReportText, type QuietOrder } from "./lease-inbox-rules";
import { admins } from "./members";
import { noticeStatus, type Notice, type NoticeState } from "./notice-window";
import type { ReportPart } from "./report";
import { bundleWindow, claimPost, getSchedule, groupTimezone, releasePost } from "./schedule";
import type { Ctx, GroupCtx } from "./types";

const { groupInboxes, landlordSenders, mailMessages, workOrders, sentMail, members } = schema;

/* ---------- teaching it ---------- */

/** What Roomie says with the address (ADR 0016 decision 2): three ways to connect, not a flow. */
export const connectLine = (address: string) =>
  `Our email address is ${address}. To connect the landlord: forward me the lease or their last email, CC this address next time you email them, or give it to the leasing office.`;

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
  /** The Member's yes to a held send: their latest message, or the dashboard's confirm token. */
  approval?: SendApproval;
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
      ...(input.approval ? { approval: input.approval } : {}),
      ...(order ? { workOrderId: order } : {}),
    },
    now,
  );
  // A reply on a work order's thread counts as activity on it.
  if (r.sent && order) await db.update(workOrders).set({ lastActivityAt: now }).where(eq(workOrders.id, order));
  return r;
}

/** "What's up with the sink?" as one line. */
export async function workOrderLine(ctx: GroupCtx, what?: string): Promise<{ found: boolean; line: string; choices?: string[]; status?: string; lastReply?: string | null; scheduledFor?: string | null }> {
  const s = await workOrderStatus(ctx, { what });
  if (!s) return { found: false, line: what ? `I haven't reported anything about ${what}.` : "No work orders yet." };
  if ("choices" in s) {
    const list = s.choices.length <= 1 ? s.choices.join("") : `${s.choices.slice(0, -1).join(", ")} or ${s.choices.at(-1)}`;
    return { found: false, choices: s.choices, line: `Which one: ${list}?` };
  }
  const tz = await groupTimezone(ctx.groupId);
  const when = formatInZone(s.lastActivityAt, tz, { weekday: "short", month: "short", day: "numeric" });
  const state =
    s.status === "sent" ? `sent, no answer yet (since ${when})` : s.status === "acknowledged" ? `they've seen it (${when})` : s.status === "scheduled" ? `scheduled for ${s.scheduledFor}` : "done";
  return { found: true, status: s.status, lastReply: s.lastReply, scheduledFor: s.scheduledFor, line: `${s.title}: ${state}.${s.lastReply ? ` Last word from them: ${s.lastReply}` : ""}` };
}

/* ---------- notices ---------- */

/** How far back "is the water back on?" looks for a notice. */
const NOTICE_LOOKBACK_DAYS = 60;

/**
 * "Is the water back on?": the answer from the latest relevant trusted notice's window (notice-window.ts
 * noticeStatus). `about` is what they asked about ("water"); leave it out for any notice with a window.
 */
export async function noticeLine(ctx: GroupCtx, about?: string, now = new Date()): Promise<{ found: boolean; line: string; state?: NoticeState }> {
  const since = new Date(now.getTime() - NOTICE_LOOKBACK_DAYS * 86_400_000);
  const rows = await db
    .select({ summary: mailMessages.summary, subject: mailMessages.subject, facts: mailMessages.facts, receivedAt: mailMessages.receivedAt })
    .from(mailMessages)
    .where(and(eq(mailMessages.groupId, ctx.groupId), eq(mailMessages.class, "notice"), eq(mailMessages.trusted, true), gte(mailMessages.receivedAt, since)));
  const notices: Notice[] = rows.filter((r) => r.facts).map((r) => ({ ...r.facts!, summary: r.summary ?? r.subject, receivedAt: r.receivedAt }));
  const s = noticeStatus(notices, now, await groupTimezone(ctx.groupId), about);
  if (!s) return { found: false, line: about?.trim() ? `I haven't seen a notice about ${about.trim()}.` : "I haven't seen a notice with a time on it." };
  return { found: true, state: s.state, line: s.line };
}

/* ---------- Bundle and report ---------- */

async function openOrders(groupId: string): Promise<(QuietOrder & { id: string })[]> {
  return db
    .select({ id: workOrders.id, title: workOrders.title, status: workOrders.status, scheduledFor: workOrders.scheduledFor, lastActivityAt: workOrders.lastActivityAt })
    .from(workOrders)
    .where(and(eq(workOrders.groupId, groupId), inArray(workOrders.status, ["sent", "acknowledged", "scheduled"])))
    .orderBy(asc(workOrders.createdAt));
}

const FOLLOW_UP_KIND = "lease.followup" as const;

/** Roomie may post to the Group on its own: not paused by the kill switch or an operator. */
async function mayPost(groupId: string): Promise<boolean> {
  if (roomiePaused()) return false;
  const [g] = await db.select({ pausedAt: schema.groups.pausedAt }).from(schema.groups).where(eq(schema.groups.id, groupId));
  return !!g && !g.pausedAt;
}

/**
 * The work order Roomie asks about following up today, once per work order (#74): only in the Bundle's own hour (the
 * nudge hour, 08:00 when it's inside quiet hours) and when the Group may be posted to, so Home's Today at other
 * times never spends the question. The first unanswered one (followUpCandidates) not asked on an earlier day: the
 * claim is scheduled_posts "lease.followup", period "<workOrderId>:<local day>", and today's claim still counts, so
 * the scheduler's later ticks in that hour and Home in that hour say the same Bundle.
 */
async function followUpToAsk(groupId: string, orders: (QuietOrder & { id: string })[], tz: string, now: Date): Promise<QuietOrder | null> {
  const candidates = followUpCandidates(orders, tz, now);
  if (!candidates.length) return null;
  const { nudgeHour } = await getSchedule({ groupId });
  if (!bundleWindow(now, tz, nudgeHour === null ? null : daytimeHour(nudgeHour)).open || !(await mayPost(groupId))) return null;
  const today = dayInZone(tz, now);
  for (const o of candidates) {
    const claims = await db
      .select({ period: schema.scheduledPosts.period })
      .from(schema.scheduledPosts)
      .where(and(eq(schema.scheduledPosts.groupId, groupId), eq(schema.scheduledPosts.kind, FOLLOW_UP_KIND), like(schema.scheduledPosts.period, `${o.id}:%`)));
    if (claims.some((c) => c.period === `${o.id}:${today}`)) return o;
    if (claims.length) continue; // asked on an earlier day
    // A false claim here is another tick or page claiming it this same day: asked today all the same.
    await claimPost(groupId, FOLLOW_UP_KIND, `${o.id}:${today}`);
    return o;
  }
  return null;
}

/**
 * The Trick's morning Bundle line: a visit tomorrow, and a work order with no reply for 2 local days ("Want me to
 * follow up?", asked once per work order). The Bundle is logged as Roomie's chat line, so a yes right after it is in
 * the follow-up window and reaches follow_up_work_order.
 */
export async function leaseBundleLine(ctx: GroupCtx, now = new Date()): Promise<string | null> {
  const [orders, tz] = await Promise.all([openOrders(ctx.groupId), groupTimezone(ctx.groupId)]);
  const ask = await followUpToAsk(ctx.groupId, orders, tz, now).catch((e) => (console.error("[lease-inbox] follow-up question failed", e), null));
  return leaseBundleText(orders, tz, now, ask);
}

export type FollowUpResult = { sent: true; say: string } | { sent: false; say: string; ask?: string[]; choices?: string[] };

/**
 * "Want me to follow up?" -> "yes" (any active Member), or "follow up on the sink" any time: one polite email on the
 * work order's thread through sendToLandlord (the send rule: a follow-up on our own work order is simple). Only when
 * the Member's own message asks for it (asksFollowUp: no yes, no email), and at most one a day per work order
 * (scheduled_posts "lease.followup.sent"), so two yeses at once send one.
 */
export async function followUpWorkOrder(ctx: Ctx, input: { what?: string; latest: string | undefined }, now = new Date()): Promise<FollowUpResult> {
  if (!asksFollowUp(input.latest)) return { sent: false, say: "Nothing was sent: ask whether they want you to follow up." };
  const s = await workOrderStatus(ctx, { what: input.what });
  if (!s) return { sent: false, say: input.what ? `I haven't reported anything about ${input.what}.` : "No work orders yet." };
  if ("choices" in s) return { sent: false, choices: s.choices, say: `Which one: ${s.choices.length <= 1 ? s.choices.join("") : `${s.choices.slice(0, -1).join(", ")} or ${s.choices.at(-1)}`}?` };
  if (s.status === "done") return { sent: false, say: `${capitalized(s.title)} is done already.` };
  const [order] = await db.select({ threadId: workOrders.threadId }).from(workOrders).where(eq(workOrders.id, s.id));
  const [group] = await db.select({ name: schema.groups.name }).from(schema.groups).where(eq(schema.groups.id, ctx.groupId));
  const tz = await groupTimezone(ctx.groupId);
  const period = `${s.id}:${dayInZone(tz, now)}`;
  if (!(await claimPost(ctx.groupId, "lease.followup.sent", period))) return { sent: false, say: `Already followed up on ${s.title} today.` };
  let r: SendResult;
  try {
    r = await sendToLandlord(
      ctx,
      {
        intent: "reply",
        threadId: order.threadId,
        body: followUpBody(group?.name ?? "our apartment", s.title),
        // A fixed instruction: two Members' yeses are the same ask, not a conflict for the send rule.
        instruction: `follow up on ${s.title}`,
        summary: `followed up on ${s.title}`,
        workOrderId: s.id,
        ...(input.latest ? { approval: { latest: input.latest } } : {}),
      },
      now,
    );
  } catch (e) {
    await releasePost(ctx.groupId, "lease.followup.sent", period).catch(() => {});
    throw e;
  }
  if (!r.sent) {
    await releasePost(ctx.groupId, "lease.followup.sent", period).catch(() => {});
    return { sent: false, ask: r.ask, say: "Nothing was sent. Ask these in one message; when they say yes, call this again." };
  }
  await db.update(workOrders).set({ lastActivityAt: now }).where(eq(workOrders.id, s.id));
  return { sent: true, say: `Followed up on ${s.title}.` };
}

const capitalized = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

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

