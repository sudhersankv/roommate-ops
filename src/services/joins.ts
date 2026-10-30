// Joining a Group's dashboard (ADR 0014, docs/joining.md): one Join link per Group (APP_URL/j/<code>), seats, and the
// Admin's approval. A Join link binds nobody by itself: signing in and picking "which one are you" from the unclaimed
// seats connects the Account at once while the Group has free seats (claimed Accounts < people in the Chat) and the
// Join policy is "free"; anything else (a claimed seat, more sign-ins than people, "I'm not on this list", "approve
// every join", a Chat whose size is unknown) makes the person a Pending Member an Admin approves.
// The pure helpers (newJoinCode, isJoinCode, seatLabel, maskNumber, joinLine, seatIsFree) are tested in joins.test.ts.
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { JOIN_POLICIES, type JoinPolicy } from "@/db/schema";
import { linkFor } from "@/lib/urls";
import { WindowLimiter, type CounterStore } from "@/lib/window-limit";
import { record, recordFor } from "./activity";
import { requireAdmin } from "./authz";
import { hashIp } from "./beta";
import type { Ctx, GroupCtx } from "./types";

const { groups, chats, members, accounts } = schema;

type Member = typeof members.$inferSelect;
type Chat = typeof chats.$inferSelect;

/* ---------- pure ---------- */

/** RFC 4648 base32, lowercase: easy to read out, no 0/1/8/9 to mix up with letters. */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const JOIN_CODE_LENGTH = 10; // 50 bits

/** A fresh Join code: JOIN_CODE_LENGTH base32 characters from crypto.randomBytes (each byte mod 32: unbiased). */
export function newJoinCode(bytes: Buffer = randomBytes(JOIN_CODE_LENGTH)): string {
  return [...bytes.subarray(0, JOIN_CODE_LENGTH)].map((b) => ALPHABET[b & 31]).join("");
}

/** Whether a URL segment can be a Join code at all (anything else is a 404 without a DB read). */
export const isJoinCode = (s: string | null | undefined): s is string => typeof s === "string" && /^[a-z2-7]{8,32}$/.test(s);

const PHONE_NAME = /^\+?\d[\d\s-]{5,}$/;

/** "+15551237393" -> "+1 ••• 7393": the number with its middle hidden (NANP and Russia have a 1-digit country code). */
export function maskNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const cc = /^[17]/.test(digits) ? digits.slice(0, 1) : digits.slice(0, 2);
  return `+${cc} ••• ${digits.slice(-4)}`;
}

/** What the seat picker shows for a Member: their name, or (WhatsApp, before a name arrived) their masked number. */
export const seatLabel = (displayName: string) => (PHONE_NAME.test(displayName.trim()) ? maskNumber(displayName) : displayName.trim() || "Someone");

/** The one line Roomie posts when setup finishes (and for "send us the dashboard"). */
export const joinLine = (url: string) => `Everyone: your dashboard is at ${url}. Sign in with Google and pick your name.`;

/**
 * The free-seat rule: an unclaimed active Member (not an Admin) seat, the Group's policy is "free", the Chat's size is
 * known and fewer Accounts are connected than there are people. Everything else waits for an Admin.
 */
export function seatIsFree(input: { policy: JoinPolicy; seat: Pick<Member, "status" | "accountId" | "role">; claimed: number; roster: number | null }): boolean {
  // An Admin seat is never free: the Join link must not hand out Admin powers (Admins use their Claim link).
  if (input.seat.role === "admin") return false;
  return input.policy === "free" && input.seat.status === "active" && !input.seat.accountId && input.roster !== null && input.claimed < input.roster;
}

/* ---------- the code ---------- */

const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
};

/** The Group's Join code, minted on first read for Groups from before migration 0011 (scripts/backfill-join-codes.ts). */
export async function ensureJoinCode(groupId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [g] = await db.select({ code: groups.joinCode }).from(groups).where(eq(groups.id, groupId));
    if (!g) throw new Error("This group doesn't exist anymore.");
    if (g.code) return g.code;
    try {
      const [set] = await db.update(groups).set({ joinCode: newJoinCode() }).where(and(eq(groups.id, groupId), isNull(groups.joinCode))).returning({ code: groups.joinCode });
      if (set?.code) return set.code;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error("Couldn't make a Join link; try again.");
}

/** APP_URL/j/<code> (relative when APP_URL is unset: dev-chat, evals). */
export async function joinLink(groupId: string): Promise<string> {
  return linkFor(`/j/${await ensureJoinCode(groupId)}`);
}

/** The Group a Join code opens, or undefined (bad format, rotated away, never existed). */
export async function groupByCode(code: string) {
  if (!isJoinCode(code)) return undefined;
  const [g] = await db.select().from(groups).where(eq(groups.joinCode, code));
  return g;
}

/** Admin: a new code; the old link stops working at once. */
export async function rotateJoinCode(ctx: Ctx): Promise<{ url: string; code: string }> {
  await requireAdmin(ctx);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const code = newJoinCode();
      await db.update(groups).set({ joinCode: code, joinCodeRotatedAt: new Date() }).where(eq(groups.id, ctx.groupId));
      await recordFor(ctx, "group.join_link_rotated", "made a new Join link (the old one stopped working)", { table: "groups", id: ctx.groupId });
      return { code, url: linkFor(`/j/${code}`) };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error("Couldn't make a new Join link; try again.");
}

export const JOIN_POLICY_LABEL: Record<JoinPolicy, string> = {
  free: "Anyone in the chat picks their name",
  approve_all: "An Admin approves every join",
};

/** Admin: "free" (picks connect while there are free seats) or "approve_all" (every pick waits for an Admin). */
export async function setJoinPolicy(ctx: Ctx, input: { policy: JoinPolicy }): Promise<JoinPolicy> {
  await requireAdmin(ctx);
  if (!(JOIN_POLICIES as readonly string[]).includes(input.policy)) throw new Error(`Join policy is one of: ${JOIN_POLICIES.join(", ")}.`);
  await db.update(groups).set({ joinPolicy: input.policy }).where(eq(groups.id, ctx.groupId));
  await recordFor(ctx, "group.settings", input.policy === "free" ? "let people in the chat pick their own name on the dashboard" : "made every dashboard join wait for an Admin", { table: "groups", id: ctx.groupId });
  return input.policy;
}

/* ---------- roster size ---------- */

/** How long a stored participant count is trusted before the picker asks the Channel again. */
const COUNT_FRESH_MS = 6 * 60 * 60 * 1000;

/** The Channel counted the people in a Chat (join, participant events, a picker refresh). */
export async function setParticipantCount(channel: Chat["channel"], externalId: string, count: number | null): Promise<void> {
  if (count !== null && (!Number.isFinite(count) || count < 0)) return;
  await db
    .update(chats)
    .set({ participantCount: count === null ? null : Math.floor(count), participantCountAt: new Date() })
    .where(and(eq(chats.channel, channel), eq(chats.externalId, externalId)));
}

/** A count from the Channel itself, at most 3 s; null when it can't say (or isn't connected in this process). */
async function askChannel(chat: Chat): Promise<number | null> {
  const { channelFor } = await import("@/channels");
  const channel = channelFor(chat.channel);
  if (!channel?.participantCount) return null;
  const timeout = new Promise<null>((ok) => setTimeout(() => ok(null), 3_000).unref?.());
  return Promise.race([channel.participantCount(chat.externalId).catch(() => null), timeout]);
}

/**
 * People in the Chat besides Roomie: the dev Channel counts its Members; WhatsApp and Telegram use the stored count
 * (refreshed from the Channel when it's old or missing). Null = unknown, and then every pick waits for an Admin.
 */
export async function rosterSize(groupId: string): Promise<number | null> {
  const [chat] = await db.select().from(chats).where(eq(chats.groupId, groupId));
  if (!chat) return null;
  if (chat.channel === "dev") {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(members).where(and(eq(members.groupId, groupId), eq(members.status, "active")));
    return Number(n);
  }
  const fresh = chat.participantCountAt && Date.now() - chat.participantCountAt.getTime() < COUNT_FRESH_MS;
  if (chat.participantCount !== null && fresh) return chat.participantCount;
  const asked = await askChannel(chat);
  if (asked !== null) {
    await setParticipantCount(chat.channel, chat.externalId, asked);
    return asked;
  }
  // An old count may be too high (people left since): unknown, so the pick waits for an Admin.
  return null;
}

/* ---------- the seat picker ---------- */

export type Seat = { id: string; label: string };

/**
 * Signed in and holding a Join link: the Group, and the seats still open (active Members with no Account). Admin seats
 * are never offered: an Admin connects with their own Claim link (the setup DM, "roomie, send me the dashboard"), so a
 * Join link can't hand anyone Admin powers. `adminsOpen` says some Admin isn't connected yet.
 */
export async function pickerFor(
  code: string,
  accountId: string,
): Promise<{ group: { id: string; name: string }; seats: Seat[]; adminsOpen: boolean; mine: { memberId: string; status: Member["status"] } | null } | null> {
  const g = await groupByCode(code);
  if (!g) return null;
  const [mine] = await db.select().from(members).where(and(eq(members.groupId, g.id), eq(members.accountId, accountId)));
  const open = await db
    .select({ id: members.id, displayName: members.displayName, role: members.role })
    .from(members)
    .where(and(eq(members.groupId, g.id), eq(members.status, "active"), isNull(members.accountId)))
    .orderBy(asc(members.joinedAt), asc(members.displayName));
  return {
    group: { id: g.id, name: g.name },
    seats: open.filter((m) => m.role !== "admin").map((m) => ({ id: m.id, label: seatLabel(m.displayName) })),
    adminsOpen: open.some((m) => m.role === "admin"),
    mine: mine ? { memberId: mine.id, status: mine.status } : null,
  };
}

export class JoinError extends Error {
  constructor(
    readonly code: "missing" | "seat" | "declined" | "rate_limited",
    message: string,
  ) {
    super(message);
    this.name = "JoinError";
  }
}

export const JOIN_PROBLEMS: Record<JoinError["code"], string> = {
  missing: "This Join link doesn't work anymore. Ask in the group chat for the new one.",
  seat: "That name isn't open anymore. Pick again.",
  declined: "An Admin turned this request down. Ask them in the group chat.",
  rate_limited: "That's a lot of tries from here. Give it an hour.",
};

export const PENDING_LINE = "An Admin needs to approve you; I'll let you know in the chat.";

/** 10 picks an hour per IP (hashed) and per Account (ADR 0014). */
export const JOIN_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 };

type JoinLimits = { ip: WindowLimiter; account: WindowLimiter };
let limitsOverride: JoinLimits | null = null;
async function limits(): Promise<JoinLimits> {
  if (limitsOverride) return limitsOverride;
  const g = globalThis as { __roomieJoinLimits?: JoinLimits };
  if (g.__roomieJoinLimits) return g.__roomieJoinLimits;
  const { pgCounters } = await import("@/lib/rate-counters");
  const lim = () => new WindowLimiter(JOIN_LIMIT.max, JOIN_LIMIT.windowMs, Date.now, pgCounters);
  return (g.__roomieJoinLimits ??= { ip: lim(), account: lim() });
}
/** Tests: limits on a MemoryCounters (or null for the real ones). */
export function setJoinLimits(store: CounterStore | null, clock: () => number = Date.now) {
  limitsOverride = store ? { ip: new WindowLimiter(JOIN_LIMIT.max, JOIN_LIMIT.windowMs, clock, store), account: new WindowLimiter(JOIN_LIMIT.max, JOIN_LIMIT.windowMs, clock, store) } : null;
}

export type ClaimSeatResult = { kind: "connected" | "already" | "pending"; groupId: string; memberName: string };

/**
 * A Google display name as Roomie will say it in the chat: no links, quotes, brackets or control characters, at most 40
 * characters. It's someone else's text going into Roomie's own line, so it must read as a name, never an instruction.
 */
export function cleanName(raw: string | null | undefined): string {
  const name = (raw ?? "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[\p{Cc}\p{Cf}"'`<>[\]{}()\\|*_~#@:]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
  return name;
}

/** The name a Join link Pending Member goes by: their Google name, made unique in the Group. */
async function pendingName(groupId: string, account: { name: string | null; email: string }): Promise<string> {
  const base = cleanName(account.name) || cleanName(account.email.split("@")[0]) || "Someone";
  const taken = new Set((await db.select({ n: members.displayName }).from(members).where(and(eq(members.groupId, groupId), ne(members.status, "removed")))).map((r) => r.n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const handle = cleanName(account.email.split("@")[0]).replace(/\s/g, "").slice(0, 30);
  const withHandle = `${base} (${handle})`;
  return taken.has(withHandle.toLowerCase()) ? `${base} (${Date.now().toString(36).slice(-4)})` : withHandle;
}

/**
 * A pick on the seat picker. `memberId` null = "I'm not on this list". Rate-limited per IP and Account first. The
 * Group row is locked while seats are counted, so two people can't both take the last free seat.
 */
export async function claimSeat(code: string, account: { id: string; name: string | null; email: string }, memberId: string | null, meta: { ip: string }): Promise<ClaimSeatResult> {
  if (!isJoinCode(code)) throw new JoinError("missing", JOIN_PROBLEMS.missing);
  const lim = await limits();
  if (!(await lim.ip.hit(`join:ip:${hashIp(meta.ip)}`)) || !(await lim.account.hit(`join:account:${account.id}`))) {
    console.log(`[joins] rate limited account=${account.id.slice(0, 8)}`);
    throw new JoinError("rate_limited", JOIN_PROBLEMS.rate_limited);
  }
  const roster = await (async () => {
    const g = await groupByCode(code);
    return g ? rosterSize(g.id) : null;
  })();

  const result = await db.transaction(async (tx) => {
    const [g] = await tx.select().from(groups).where(eq(groups.joinCode, code)).for("update");
    if (!g) throw new JoinError("missing", JOIN_PROBLEMS.missing);
    const [mine] = await tx.select().from(members).where(and(eq(members.groupId, g.id), eq(members.accountId, account.id)));
    if (mine && mine.status !== "removed") return { kind: "already" as const, groupId: g.id, memberName: mine.displayName, memberId: mine.id, seatName: null };
    if (mine) throw new JoinError("declined", JOIN_PROBLEMS.declined);

    let seat: Member | undefined;
    if (memberId) {
      if (!/^[0-9a-f-]{36}$/i.test(memberId)) throw new JoinError("seat", JOIN_PROBLEMS.seat);
      [seat] = await tx.select().from(members).where(and(eq(members.groupId, g.id), eq(members.id, memberId))).for("update");
      if (!seat || seat.status !== "active") throw new JoinError("seat", JOIN_PROBLEMS.seat);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(members).where(and(eq(members.groupId, g.id), eq(members.status, "active"), isNotNull(members.accountId)));
      if (seatIsFree({ policy: g.joinPolicy, seat, claimed: Number(n), roster })) {
        await tx.update(members).set({ accountId: account.id }).where(eq(members.id, seat.id));
        return { kind: "connected" as const, groupId: g.id, memberName: seat.displayName, memberId: seat.id, seatName: seat.displayName };
      }
    }
    const [row] = await tx
      .insert(members)
      .values({ groupId: g.id, displayName: await pendingName(g.id, account), accountId: account.id, status: "pending", wantsSeatId: seat?.id ?? null })
      .returning();
    return { kind: "pending" as const, groupId: g.id, memberName: row.displayName, memberId: row.id, seatName: seat?.displayName ?? null };
  });

  if (result.kind === "connected") {
    await record(result.groupId, result.memberId, "member.claimed", "connected to the dashboard with the Join link", { table: "members", id: result.memberId }, "dashboard");
  }
  if (result.kind === "pending") {
    const why = result.seatName ? `as ${seatLabel(result.seatName)}` : "(not on the list yet)";
    await record(result.groupId, null, "member.pending", `added ${result.memberName} as a pending member: signed in with the Join link ${why}`, { table: "members", id: result.memberId });
    await askAdmins(result.groupId, result.memberName, result.seatName).catch((e) => console.warn("[joins] couldn't ask the Admins in the chat", e));
  }
  return { kind: result.kind, groupId: result.groupId, memberName: result.memberName };
}

/** The approval ask in the Chat for a Join link sign-in. */
export function joinApprovalPrompt(name: string, seatName: string | null, adminNames: string[]): string {
  // Every name here came from someone else (Google, WhatsApp, Telegram): cleaned so it reads as a name in Roomie's line.
  const admins = adminNames.map((n) => (PHONE_NAME.test(n.trim()) ? maskNumber(n) : cleanName(n))).filter(Boolean);
  const who = admins.length ? (admins.length === 1 ? admins[0] : `${admins.slice(0, -1).join(", ")} and ${admins.at(-1)}`) : "Admins";
  const seat = seatName ? (PHONE_NAME.test(seatName.trim()) ? maskNumber(seatName) : cleanName(seatName)) : "";
  const as = seat ? ` as ${seat}` : "";
  return `${name} signed in to the dashboard${as}. ${who}: approve them? Say "roomie approve ${name}" or use the Members page.`;
}

/** At most this many approval asks per Group an hour (the rest wait on the Members page). */
const ASKS_PER_HOUR = 5;
const askLimiter = () => {
  const g = globalThis as { __roomieJoinAsks?: WindowLimiter };
  return (g.__roomieJoinAsks ??= new WindowLimiter(ASKS_PER_HOUR, 60 * 60 * 1000));
};

async function askAdmins(groupId: string, name: string, seatName: string | null) {
  const [g] = await db.select({ pausedAt: groups.pausedAt }).from(groups).where(eq(groups.id, groupId));
  if (!g || g.pausedAt) return;
  const [chat] = await db.select({ id: chats.id }).from(chats).where(eq(chats.groupId, groupId));
  if (!chat || !askLimiter().take(groupId)) return;
  const admins = await db
    .select({ name: members.displayName })
    .from(members)
    .where(and(eq(members.groupId, groupId), eq(members.role, "admin"), eq(members.status, "active")));
  await postInChat(groupId, joinApprovalPrompt(name, seatName, admins.map((a) => a.name)));
}

/** Roomie says `text` in the Group's Chat (and it's logged as Roomie's line). */
export async function postInChat(groupId: string, text: string): Promise<void> {
  const { deliver } = await import("@/channels");
  const { logMessage } = await import("./chatlog");
  await deliver(groupId, { text });
  await logMessage(groupId, null, text);
}

/* ---------- seats on the Members page ---------- */

export type SeatState = { state: "connected" | "open" | "pending"; account: { name: string | null; image: string | null; email: string } | null; wantsSeat: string | null };

/** Every Member's seat: connected (with the Google name and avatar), open, or a Pending sign-in (and the seat it asked for). */
export async function seatStates(ctx: GroupCtx): Promise<Map<string, SeatState>> {
  const rows = await db
    .select({ member: members, account: { name: accounts.name, image: accounts.image, email: accounts.email } })
    .from(members)
    .leftJoin(accounts, eq(members.accountId, accounts.id))
    .where(and(eq(members.groupId, ctx.groupId), ne(members.status, "removed")));
  const names = new Map(rows.map((r) => [r.member.id, r.member.displayName]));
  return new Map(
    rows.map((r) => [
      r.member.id,
      {
        state: r.member.status === "pending" ? "pending" : r.member.accountId ? "connected" : "open",
        account: r.member.accountId && r.account ? r.account : null,
        wantsSeat: r.member.wantsSeatId ? (names.get(r.member.wantsSeatId) ?? null) : null,
      } satisfies SeatState,
    ]),
  );
}

async function seatOf(ctx: GroupCtx, memberId: string): Promise<Member> {
  if (!/^[0-9a-f-]{36}$/i.test(memberId)) throw new Error("That person isn't in this group.");
  const [m] = await db.select().from(members).where(and(eq(members.groupId, ctx.groupId), eq(members.id, memberId)));
  if (!m || m.status === "removed") throw new Error("That person isn't in this group.");
  return m;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Seat changes take the Group row lock first (as claimSeat does), then the Member rows, so a pick, an approval, a
 * revoke and a reassign on the same seats run one after another and each sees the others' result.
 */
export async function lockSeats(tx: Tx, groupId: string, ids: string[]): Promise<Map<string, Member>> {
  await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).for("update");
  const rows = await tx
    .select()
    .from(members)
    .where(and(eq(members.groupId, groupId), inArray(members.id, ids)))
    .for("update");
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Admin: disconnect a seat's Account. The Member stays and the seat is open again; the Account goes back to waiting
 * (a Pending sign-in an Admin approves, places or declines), so it can't simply pick the same seat again.
 * Not your own.
 */
export async function revokeSeat(ctx: Ctx, input: { memberId: string }): Promise<Member> {
  await requireAdmin(ctx);
  const before = await seatOf(ctx, input.memberId);
  if (before.id === ctx.memberId) throw new Error("You can't disconnect yourself. Another Admin can.");
  const [account] = before.accountId ? await db.select().from(accounts).where(eq(accounts.id, before.accountId)) : [];
  const waitingName = account ? await pendingName(ctx.groupId, account) : null;
  const updated = await db.transaction(async (tx) => {
    const m = (await lockSeats(tx, ctx.groupId, [before.id])).get(before.id);
    if (!m || m.status === "removed") throw new Error("That person isn't in this group.");
    if (!m.accountId) throw new Error(`Nobody is connected as ${m.displayName}.`);
    if (m.status === "pending") throw new Error(`${m.displayName} is waiting for approval: decline them instead.`);
    const [row] = await tx.update(members).set({ accountId: null }).where(eq(members.id, m.id)).returning();
    if (m.accountId === account?.id && waitingName) await tx.insert(members).values({ groupId: ctx.groupId, displayName: waitingName, accountId: m.accountId, status: "pending" });
    return row;
  });
  await recordFor(ctx, "member.revoked", `disconnected the Google account on ${updated.displayName}'s seat`, { table: "members", id: updated.id });
  return updated;
}

/**
 * Admin: move the Account on `fromMemberId` to the open seat `toMemberId`. A Pending Join link sign-in moved onto a
 * seat is approved by that (its placeholder row goes); an active seat it leaves stays, open. Both rows are locked and
 * checked again inside the move, so a revoke or a pick in between wins instead of being overwritten.
 */
export async function reassignSeat(ctx: Ctx, input: { fromMemberId: string; toMemberId: string }): Promise<Member> {
  await requireAdmin(ctx);
  await seatOf(ctx, input.fromMemberId);
  await seatOf(ctx, input.toMemberId);
  if (input.fromMemberId === input.toMemberId) throw new Error("That's the same seat.");
  if (input.fromMemberId === ctx.memberId) throw new Error("You can't move your own seat. Another Admin can.");
  const { from, moved } = await db.transaction(async (tx) => {
    const locked = await lockSeats(tx, ctx.groupId, [input.fromMemberId, input.toMemberId]);
    const from = locked.get(input.fromMemberId);
    const to = locked.get(input.toMemberId);
    if (!from || from.status === "removed" || !to || to.status === "removed") throw new Error("That person isn't in this group.");
    if (!from.accountId) throw new Error(`Nobody is connected as ${from.displayName}.`);
    if (to.status !== "active") throw new Error(`${to.displayName} isn't approved yet.`);
    if (to.accountId) throw new Error(`Someone is already connected as ${to.displayName}. Disconnect them first.`);
    const placeholder = from.status === "pending" && !from.channelUserId;
    await tx
      .update(members)
      .set(placeholder ? { accountId: null, status: "removed", wantsSeatId: null } : { accountId: null })
      .where(eq(members.id, from.id));
    const [moved] = await tx.update(members).set({ accountId: from.accountId }).where(and(eq(members.id, to.id), isNull(members.accountId))).returning();
    if (!moved) throw new Error(`Someone just connected as ${to.displayName}.`);
    return { from, moved };
  });
  await recordFor(ctx, "member.reassigned", `moved ${from.displayName}'s Google account to ${moved.displayName}'s seat`, { table: "members", id: moved.id });
  return moved;
}

/** Accounts' Groups with the Channel and the seat's name (/app lists them). */
export async function groupsListFor(accountId: string) {
  return db
    .select({ id: groups.id, name: groups.name, channel: chats.channel, seatName: members.displayName, status: members.status })
    .from(members)
    .innerJoin(groups, eq(members.groupId, groups.id))
    .leftJoin(chats, eq(chats.groupId, groups.id))
    .where(and(eq(members.accountId, accountId), ne(members.status, "removed")))
    .orderBy(asc(groups.createdAt));
}
