// Members: who is in a Group, approvals (Pending -> active), roles, payment handles and "forget me".
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ChannelName, MemberNote, PaymentApp } from "@/db/schema";
import { anonymize } from "@/lib/forget-text";
import { record, recordFor } from "./activity";
import { NotAllowedError, requireAdmin } from "./authz";
import type { Ctx, GroupCtx } from "./types";

const { members, memberNotes, chatMessages, claimTokens } = schema;

export type Member = typeof members.$inferSelect;
export type MemberWithHandles = Member & { handles: Partial<Record<PaymentApp, string>> };

export const FORMER_MEMBER = "Former member";
export const PAYMENT_APPS: PaymentApp[] = ["venmo", "paypal", "cashapp"];

/** Active Members: the people in splits, chores and balances. */
export async function listMembers(ctx: GroupCtx): Promise<Member[]> {
  return db
    .select()
    .from(members)
    .where(and(eq(members.groupId, ctx.groupId), eq(members.status, "active")))
    .orderBy(asc(members.joinedAt), asc(members.displayName));
}

/** Active and Pending Members (everyone in the Chat Roomie knows about). */
export async function listGroupMembers(ctx: GroupCtx): Promise<Member[]> {
  return db
    .select()
    .from(members)
    .where(and(eq(members.groupId, ctx.groupId), ne(members.status, "removed")))
    .orderBy(asc(members.joinedAt), asc(members.displayName));
}

/** Active + Pending with their payment handles from Member notes. */
export async function listMembersWithHandles(ctx: GroupCtx): Promise<MemberWithHandles[]> {
  const people = await listGroupMembers(ctx);
  if (people.length === 0) return [];
  const notes = await db.select().from(memberNotes).where(inArray(memberNotes.memberId, people.map((p) => p.id)));
  const byId = new Map(notes.map((n) => [n.memberId, n.note]));
  return people.map((p) => ({ ...p, handles: byId.get(p.id)?.handles ?? {} }));
}

export async function getMember(ctx: GroupCtx, memberId: string): Promise<Member | undefined> {
  const [m] = await db.select().from(members).where(and(eq(members.groupId, ctx.groupId), eq(members.id, memberId)));
  return m;
}

export async function memberByChannelUser(groupId: string, channelUserId: string): Promise<Member | undefined> {
  const [m] = await db.select().from(members).where(and(eq(members.groupId, groupId), eq(members.channelUserId, channelUserId)));
  return m;
}

/** A new person in the Chat. Pending until an Admin approves, unless `status` says otherwise (Onboarding). */
export async function addMember(
  groupId: string,
  input: { displayName: string; channelUserId?: string | null; role?: Member["role"]; status?: Member["status"] },
): Promise<Member> {
  const [m] = await db
    .insert(members)
    .values({
      groupId,
      displayName: input.displayName.trim() || "Someone",
      channelUserId: input.channelUserId ?? null,
      role: input.role ?? "member",
      status: input.status ?? "pending",
    })
    .returning();
  return m;
}

/**
 * A Channel learned that two ids are one person (WhatsApp: the phone JID behind a LID). Members stored under `from`
 * move to `to` in that Channel's Groups, except where `to` is already a Member (the older row stays). Returns how many
 * moved.
 */
export async function rekeyChannelUser(channel: ChannelName, from: string, to: string): Promise<number> {
  if (from === to) return 0;
  const moved = await db.execute(sql`
    update ${members} m set channel_user_id = ${to}
    where m.channel_user_id = ${from}
      and m.group_id in (select c.group_id from ${schema.chats} c where c.channel = ${channel})
      and not exists (select 1 from ${members} o where o.group_id = m.group_id and o.channel_user_id = ${to})`);
  return moved.rowCount ?? 0;
}

/**
 * The name a person goes by, once the Channel hears it: Members still named `placeholder` (what the adapter called
 * them before, e.g. their phone number) take `name`. Names someone chose are never overwritten.
 */
export async function fillPlaceholderName(channel: ChannelName, channelUserId: string, placeholder: string, name: string): Promise<void> {
  if (!name.trim() || name.trim() === placeholder) return;
  await db.execute(sql`
    update ${members} m set display_name = ${name.trim()}
    where m.channel_user_id = ${channelUserId} and m.display_name = ${placeholder}
      and m.group_id in (select c.group_id from ${schema.chats} c where c.channel = ${channel})`);
}

async function target(ctx: Ctx, memberId: string): Promise<Member> {
  const m = await getMember(ctx, memberId);
  if (!m || m.status === "removed") throw new Error("That person isn't in this group.");
  return m;
}

/**
 * Admin: Pending -> active. A Join link sign-in that asked for a seat (wantsSeatId, services/joins.ts) is approved by
 * moving its Account onto that seat, when the seat is still open; its placeholder row goes. Returns the Member who is
 * active now.
 */
export async function approveMember(ctx: Ctx, input: { memberId: string }): Promise<Member> {
  await requireAdmin(ctx);
  const m = await target(ctx, input.memberId);
  if (m.status === "active") throw new Error(`${m.displayName} is already approved.`);
  // One transaction under the Group and seat locks (services/joins.ts lockSeats), the request re-read inside it: two
  // Admins approving (or one declining) at once can't both act, and a pick that just took the seat wins.
  const { lockSeats } = await import("./joins");
  const result = await db.transaction(async (tx) => {
    const locked = await lockSeats(tx, ctx.groupId, m.wantsSeatId ? [m.id, m.wantsSeatId] : [m.id]);
    const now = locked.get(m.id);
    if (!now || now.status !== "pending") throw new Error(`${m.displayName} isn't waiting for approval anymore.`);
    const seat = now.wantsSeatId ? locked.get(now.wantsSeatId) : undefined;
    // Never onto an Admin seat: approving a Join link sign-in doesn't hand out Admin powers.
    if (now.accountId && seat && seat.status === "active" && !seat.accountId && seat.role !== "admin") {
      await tx.update(members).set({ status: "removed", accountId: null, wantsSeatId: null }).where(eq(members.id, now.id));
      const [row] = await tx.update(members).set({ accountId: now.accountId }).where(and(eq(members.id, seat.id), isNull(members.accountId))).returning();
      if (!row) throw new Error(`Someone just connected as ${seat.displayName}. Approve again to add ${m.displayName} as their own Member.`);
      return { row, moved: true };
    }
    const [row] = await tx
      .update(members)
      .set({ status: "active", approvedBy: ctx.memberId, approvedAt: new Date(), wantsSeatId: null })
      .where(and(eq(members.id, now.id), eq(members.status, "pending")))
      .returning();
    return { row, moved: false };
  });
  if (result.moved) {
    await recordFor(ctx, "member.approved", `approved ${m.displayName} as ${result.row.displayName}`, { table: "members", id: result.row.id });
    await toldInChat(ctx, `${m.displayName} is in: connected to the dashboard as ${result.row.displayName}.`);
    return result.row;
  }
  await recordFor(ctx, "member.approved", `approved ${m.displayName}`, { table: "members", id: m.id });
  if (!m.channelUserId && m.accountId) await toldInChat(ctx, `${m.displayName} is in: connected to the dashboard.`);
  return result.row;
}

/**
 * A Join link sign-in was told "I'll let you know in the chat": an approval made on the dashboard says so there. In
 * the chat Roomie's own reply already does.
 */
async function toldInChat(ctx: Ctx, text: string) {
  if (ctx.source !== "ui") return;
  try {
    const [g] = await db.select({ pausedAt: schema.groups.pausedAt }).from(schema.groups).where(eq(schema.groups.id, ctx.groupId));
    const [chat] = await db.select({ id: schema.chats.id }).from(schema.chats).where(eq(schema.chats.groupId, ctx.groupId));
    if (!chat || g?.pausedAt) return;
    const { deliver } = await import("@/channels");
    const { logMessage } = await import("./chatlog");
    await deliver(ctx.groupId, { text });
    await logMessage(ctx.groupId, null, text);
  } catch (e) {
    console.warn("[members] couldn't say the approval in the chat", e);
  }
}

/** Admin: a Pending member is turned away. They stay in the Chat; Roomie won't act for them. */
export async function declineMember(ctx: Ctx, input: { memberId: string }): Promise<Member> {
  await requireAdmin(ctx);
  const m = await target(ctx, input.memberId);
  if (m.status !== "pending") throw new Error(`${m.displayName} isn't waiting for approval.`);
  // Only while still Pending: an approval that just went through isn't undone.
  const [updated] = await db.update(members).set({ status: "removed" }).where(and(eq(members.id, m.id), eq(members.status, "pending"))).returning();
  if (!updated) throw new Error(`${m.displayName} isn't waiting for approval anymore.`);
  await recordFor(ctx, "member.declined", `declined ${m.displayName}`, { table: "members", id: m.id });
  return updated;
}

/** Admin: make an active Member an Admin too. */
export async function promoteMember(ctx: Ctx, input: { memberId: string }): Promise<Member> {
  await requireAdmin(ctx);
  const m = await target(ctx, input.memberId);
  if (m.status !== "active") throw new NotAllowedError(`Approve ${m.displayName} before making them an admin.`, "pending");
  if (m.role === "admin") throw new Error(`${m.displayName} is already an admin.`);
  const [updated] = await db.update(members).set({ role: "admin" }).where(eq(members.id, m.id)).returning();
  await recordFor(ctx, "member.promoted", `made ${m.displayName} an admin`, { table: "members", id: m.id });
  return updated;
}

export async function admins(ctx: GroupCtx): Promise<Member[]> {
  return (await listMembers(ctx)).filter((m) => m.role === "admin");
}

/* ---------- Member notes ---------- */

export async function getNote(memberId: string): Promise<MemberNote> {
  const [row] = await db.select().from(memberNotes).where(eq(memberNotes.memberId, memberId));
  return row?.note ?? {};
}

/** Your own payment handles (any status: it's your data). Empty strings clear a handle. */
export async function setPaymentHandles(ctx: Ctx, input: Partial<Record<PaymentApp, string>>): Promise<MemberNote> {
  const me = await getMember(ctx, ctx.memberId);
  if (!me || me.status === "removed") throw new NotAllowedError("You're not in this group anymore.", "removed");
  const set: Partial<Record<PaymentApp, string>> = {};
  const clear: PaymentApp[] = [];
  for (const app of PAYMENT_APPS) {
    if (!(app in input)) continue;
    const v = input[app]?.trim();
    if (v) set[app] = v.slice(0, 80);
    else clear.push(app);
  }
  // One statement, merged in SQL: two handles saved at the same moment ("my venmo is X and my paypal is Y") both stick.
  const merged = sql`(coalesce(${memberNotes.note}->'handles', '{}'::jsonb) || ${JSON.stringify(set)}::jsonb) - ${`{${clear.join(",")}}`}::text[]`;
  const [row] = await db
    .insert(memberNotes)
    .values({ memberId: ctx.memberId, note: { handles: set } })
    .onConflictDoUpdate({ target: memberNotes.memberId, set: { note: sql`jsonb_set(${memberNotes.note}, '{handles}', ${merged})`, updatedAt: new Date() } })
    .returning({ note: memberNotes.note });
  return row.note;
}

/* ---------- nudge preferences (ADR 0020) ---------- */

/** The note keys the DM side keeps: "roomie stop nudging me" and when the Start hint last went out (ISO). */
export type NudgeNote = { nudges?: "on" | "off"; lastStartHintAt?: string };

/** "roomie stop nudging me": the settle and restock DMs read this. Reminders a Member set ignore it. */
export async function nudgesOff(memberId: string): Promise<boolean> {
  return ((await getNote(memberId)) as NudgeNote).nudges === "off";
}

/** Your own nudges on or off (any status: it's your data). Merged in SQL so the rest of the note stays. */
export async function setNudges(ctx: Ctx, input: { on: boolean }): Promise<{ nudges: "on" | "off" }> {
  const me = await getMember(ctx, ctx.memberId);
  if (!me || me.status === "removed") throw new NotAllowedError("You're not in this group anymore.", "removed");
  await setNoteKeys(ctx.memberId, { nudges: input.on ? "on" : "off" });
  return { nudges: input.on ? "on" : "off" };
}

/** Sets top-level keys of a Member note, keeping the rest. */
export async function setNoteKeys(memberId: string, keys: NudgeNote): Promise<void> {
  const patch = JSON.stringify(keys);
  await db
    .insert(memberNotes)
    .values({ memberId, note: keys })
    .onConflictDoUpdate({ target: memberNotes.memberId, set: { note: sql`${memberNotes.note} || ${patch}::jsonb`, updatedAt: new Date() } });
}

/* ---------- what Roomie knows about you ("remember", "what do you know about me") ---------- */

export const MAX_CARES = 3;
const FACT_KEYS = ["preferredName", "diet", "allergies", "timezone", "birthday"] as const;
export type FactsPatch = Partial<Record<(typeof FACT_KEYS)[number], string>> & { caresAbout?: string; other?: string };

/** "preferred name May; diet vegetarian; cares about the plant, climbing" (empty when nothing's known). Pure. */
export function describeFacts(note: MemberNote): string {
  const parts: string[] = [];
  if (note.preferredName) parts.push(`goes by ${note.preferredName}`);
  if (note.diet) parts.push(`diet: ${note.diet}`);
  if (note.allergies) parts.push(`allergies: ${note.allergies}`);
  if (note.timezone) parts.push(`time zone: ${note.timezone}`);
  if (note.caresAbout?.length) parts.push(`cares about ${note.caresAbout.join(", ")}`);
  if (note.birthday) parts.push(`birthday: ${note.birthday}`);
  if (note.other?.length) parts.push(note.other.join("; "));
  const apps = Object.entries(note.handles ?? {}).filter(([, h]) => h);
  if (apps.length) parts.push(`pays with ${apps.map(([a]) => a).join(", ")}`);
  return parts.join("; ");
}

/** Pure merge for remember: scalar facts replace, "cares about" keeps the newest 3, "other" the newest 5; "" clears. */
export function mergeFacts(note: MemberNote, patch: FactsPatch): MemberNote {
  const next: MemberNote = { ...note };
  for (const k of FACT_KEYS) {
    if (patch[k] === undefined) continue;
    const v = patch[k]!.trim().slice(0, 80);
    if (v) next[k] = v;
    else delete next[k];
  }
  const push = (list: string[] | undefined, v: string | undefined, max: number) => {
    if (v === undefined) return list;
    const t = v.trim().slice(0, 80);
    if (!t) return [];
    return [...(list ?? []).filter((x) => x.toLowerCase() !== t.toLowerCase()), t].slice(-max);
  };
  const cares = push(note.caresAbout, patch.caresAbout, MAX_CARES);
  if (cares !== undefined) next.caresAbout = cares;
  const other = push(note.other, patch.other, 5);
  if (other !== undefined) next.other = other;
  return next;
}

/** The sender tells Roomie something lasting about themselves. Any status: it's their own data. */
export async function rememberAboutMe(ctx: Ctx, patch: FactsPatch): Promise<MemberNote> {
  const me = await getMember(ctx, ctx.memberId);
  if (!me || me.status === "removed") throw new NotAllowedError("You're not in this group anymore.", "removed");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(memberNotes).where(eq(memberNotes.memberId, me.id)).for("update");
    const note = mergeFacts(row?.note ?? {}, patch);
    await tx
      .insert(memberNotes)
      .values({ memberId: me.id, note })
      .onConflictDoUpdate({ target: memberNotes.memberId, set: { note, updatedAt: new Date() } });
    return note;
  });
}

/**
 * What Roomie knows about a Member: their own note for anyone, someone else's only for an Admin. Returns the name and
 * the note's facts (payment handles included).
 */
export async function knownAbout(ctx: Ctx, input: { memberId?: string } = {}): Promise<{ name: string; note: MemberNote; summary: string }> {
  const targetId = input.memberId ?? ctx.memberId;
  if (targetId !== ctx.memberId) await requireAdmin(ctx);
  const who = await getMember(ctx, targetId);
  if (!who || who.status === "removed") throw new Error("That person isn't in this group.");
  const note = await getNote(who.id);
  return { name: who.displayName, note, summary: describeFacts(note) };
}

/** "Maya: diet: vegetarian; cares about the plant" for every Member Roomie knows something about (its instructions). */
export async function peopleFacts(ctx: GroupCtx): Promise<string[]> {
  const people = await listGroupMembers(ctx);
  if (!people.length) return [];
  const notes = await db.select().from(memberNotes).where(inArray(memberNotes.memberId, people.map((p) => p.id)));
  const byId = new Map(notes.map((n) => [n.memberId, n.note]));
  return people
    .map((p) => ({ name: p.displayName, facts: describeFacts({ ...(byId.get(p.id) ?? {}), handles: undefined }) }))
    .filter((x) => x.facts)
    .map((x) => `${x.name}: ${x.facts}`);
}

/* ---------- forget me (ADR 0006) ---------- */

/** Names that aren't one person's (a WhatsApp Member with a hidden number is "Someone" until we hear their name). */
const SHARED_NAMES = new Set(["someone", FORMER_MEMBER.toLowerCase()]);

/** Every name a Member is known by: their name now, the number they were called before their name arrived, and the
 * names WhatsApp gave us for their ids. */
async function namesOf(me: Member): Promise<string[]> {
  const names = [me.displayName];
  const id = me.channelUserId;
  if (id?.endsWith("@s.whatsapp.net")) names.push(`+${id.split("@")[0].split(":")[0]}`);
  if (id?.includes("@")) {
    const rows = await db.select({ name: schema.waContacts.name }).from(schema.waContacts).where(or(eq(schema.waContacts.lid, id), eq(schema.waContacts.pn, id)));
    for (const r of rows) if (r.name) names.push(r.name);
  }
  return [...new Set(names.map((n) => n.trim()).filter((n) => n && !SHARED_NAMES.has(n.toLowerCase())))];
}

/**
 * "roomie forget me" (ADR 0006, audit H5): deletes the Member's raw chat lines, Member note (table + working memory),
 * Claim links, their lines in Roomie's memory thread under any name they went by (and Roomie's replies naming them),
 * the photos those lines pointed at (unless someone filed one: a receipt, a kept photo), the Documents of kind photo
 * they uploaded (their name comes off the rest), the traces and scores of their
 * messages, and the WhatsApp contact row behind their id. Their names in Activity become "Former member". Then they
 * are removed: "Former member", no Channel id (a later message makes them a new Pending member) and no Account.
 * Ledger rows (Expenses, Shares, Settlements, chores) stay so the Group's Balances still add up. Safe to run twice.
 */
export async function forgetMe(ctx: Ctx): Promise<{ chatLines: number; memoryMessages: number }> {
  const me = await getMember(ctx, ctx.memberId);
  if (!me) throw new NotAllowedError("You're not a member of this group.", "not-member");
  const names = await namesOf(me);
  const others = (await listGroupMembers(ctx)).filter((m) => m.id !== me.id).map((m) => m.displayName);
  const gone = await db
    .delete(chatMessages)
    .where(and(eq(chatMessages.groupId, ctx.groupId), eq(chatMessages.memberId, me.id)))
    .returning({ id: chatMessages.id, text: chatMessages.text });
  await db.delete(memberNotes).where(eq(memberNotes.memberId, me.id));
  await db.delete(claimTokens).where(eq(claimTokens.memberId, me.id));

  const forget = await import("@/mastra/forget");
  const { deleted: memoryMessages, photos } = await forget
    .forgetMemberInMemory(ctx.groupId, { names, texts: gone.map((g) => g.text), others })
    .catch((e) => {
      console.warn("[forget-me] memory cleanup failed", e);
      return { deleted: 0, photos: [] as string[] };
    });
  await forget.anonymizeInWorkingMemory(ctx.groupId, names, FORMER_MEMBER, others).catch((e) => console.warn("[forget-me] working memory cleanup failed", e));
  await forget.forgetDmInMemory(ctx.groupId, me.id).catch((e) => console.warn("[forget-me] DM thread cleanup failed", e));
  // Only names no one else in the Group has: a shared name can't tell whose line it is.
  const taken = new Set(others.map((o) => o.toLowerCase()));
  const own = names.filter((n) => !taken.has(n.toLowerCase()));
  const traces = () => forget.forgetMemberTraces(me.id, { groupId: ctx.groupId, names: own }).catch((e) => console.warn("[forget-me] trace cleanup failed", e));
  await traces();
  await removePhotos(ctx.groupId, me.id, photos);
  // Reminders addressed to them privately (nobody to send them to now).
  await db.delete(schema.reminders).where(and(eq(schema.reminders.groupId, ctx.groupId), eq(schema.reminders.memberId, me.id)));

  // Activity summaries ("Maya added Costco $40") keep what happened, not who.
  if (names.length) {
    const rows = await db.select({ id: schema.activity.id, summary: schema.activity.summary }).from(schema.activity).where(eq(schema.activity.groupId, ctx.groupId));
    for (const r of rows) {
      const next = anonymize(r.summary, names, FORMER_MEMBER, others);
      if (next !== r.summary) await db.update(schema.activity).set({ summary: next }).where(eq(schema.activity.id, r.id));
    }
  }
  const channelId = me.channelUserId;
  await db.update(members).set({ displayName: FORMER_MEMBER, channelUserId: null, accountId: null, status: "removed", role: "member" }).where(eq(members.id, me.id));
  // The last Admin leaving hands the Group to whoever has been in it longest, so someone can still approve people.
  if (me.role === "admin" && !(await admins(ctx)).length) {
    const [next] = await listMembers(ctx);
    if (next) {
      await db.update(members).set({ role: "admin" }).where(eq(members.id, next.id));
      await record(ctx.groupId, null, "member.promoted", `made ${next.displayName} an admin (the last admin left)`, { table: "members", id: next.id });
    }
  }
  // The LID -> phone pair behind their WhatsApp id, unless someone with that id is still a Member somewhere.
  if (channelId?.includes("@")) {
    await db.execute(sql`
      delete from ${schema.waContacts} w
      where (w.lid = ${channelId} or w.pn = ${channelId})
        and not exists (select 1 from ${members} m where m.status <> 'removed' and m.channel_user_id in (w.lid, w.pn))`);
  }
  await record(ctx.groupId, null, "member.forgotten", `forgot a member who asked (now ${FORMER_MEMBER})`, { table: "members", id: me.id });
  // "forget me" runs as a tool inside the agent's turn: after it, Mastra still saves "[Name] roomie forget me" and the
  // reply to memory and ends that turn's spans. Sweep once more when the turn is over (the daily retention job catches
  // any trace left by a restart: forgetRemovedMembersTraces).
  setTimeout(() => {
    void forget
      .forgetMemberInMemory(ctx.groupId, { names, others })
      .then(traces)
      .catch((e) => console.warn("[forget-me] follow-up cleanup failed", e));
  }, FORGET_SWEEP_MS).unref?.();
  return { chatLines: gone.length, memoryMessages };
}

/** How long after "forget me" the follow-up sweep runs (the agent's turn is over by then). */
const FORGET_SWEEP_MS = 90_000;

/**
 * Their files (ADR 0018): the photos in their forgotten lines that nobody filed, their own photos, and their name on
 * the rest (a receipt stays with its Expense, the lease with the Group).
 */
async function removePhotos(groupId: string, memberId: string, urls: string[]) {
  const documents = await import("./documents");
  await documents.deleteUnfiledByUrl(groupId, urls).catch((e) => console.warn("[forget-me] couldn't delete the photos in their lines", e));
  await documents.deleteMemberPhotos(groupId, memberId);
  await documents.anonymizeUploader(groupId, memberId);
}
