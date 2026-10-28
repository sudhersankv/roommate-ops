// Claim links (ADR 0003): a private, single-use, 24-hour token that connects an Account to a Member.
// Only get_dashboard_link (the Member asked) and dev tooling create them; they're never sent in bulk (ADR 0001).
// claimState and newClaimToken are pure (claims.test.ts).
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { linkFor } from "@/lib/urls";
import { record } from "./activity";
import { NotAllowedError } from "./authz";
import type { Ctx } from "./types";

const { claimTokens, members, accounts } = schema;

export const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

export type Account = typeof accounts.$inferSelect;
export type AuthUser = { id: string; email: string; name?: string | null; image?: string | null };
export type ClaimState = "ok" | "missing" | "used" | "expired";

/** 32 random bytes, base64url (43 chars). */
export const newClaimToken = () => randomBytes(32).toString("base64url");

export function claimState(row: { expiresAt: Date; usedAt: Date | null } | undefined, now = new Date()): ClaimState {
  if (!row) return "missing";
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "ok";
}

export const CLAIM_PROBLEMS: Record<Exclude<ClaimState, "ok">, string> = {
  missing: "This link isn't valid. Ask Roomie in the chat for a new one.",
  used: "This link was already used. Ask Roomie in the chat for a new one.",
  expired: "This link expired (they last 24 hours). Ask Roomie in the chat for a new one.",
};

/** Mint a token for a Member (dev-chat `link`, seed). Use issueDashboardLink from chat. */
export async function createClaimToken(memberId: string, now = new Date()): Promise<{ token: string; url: string; expiresAt: Date }> {
  const token = newClaimToken();
  const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS);
  await db.insert(claimTokens).values({ token, memberId, expiresAt });
  await db.update(members).set({ linkIssuedAt: now }).where(eq(members.id, memberId));
  return { token, url: linkFor(`/claim/${token}`), expiresAt };
}

export type DashboardLink = { kind: "claim"; url: string; expiresAt: Date } | { kind: "dashboard"; url: string };

/**
 * The asking Member's way into the dashboard: their Group's URL when they already have an Account, otherwise a
 * Claim link. An unused, unexpired link from earlier is reused, so asking twice doesn't mint a pile of tokens.
 */
export async function issueDashboardLink(ctx: Ctx, now = new Date()): Promise<DashboardLink> {
  const [me] = await db.select().from(members).where(and(eq(members.id, ctx.memberId), eq(members.groupId, ctx.groupId)));
  if (!me || me.status === "removed") throw new NotAllowedError("You're not in this group anymore.", "removed");
  if (me.accountId) return { kind: "dashboard", url: linkFor(`/g/${ctx.groupId}`) };
  const [live] = await db
    .select()
    .from(claimTokens)
    .where(and(eq(claimTokens.memberId, me.id), isNull(claimTokens.usedAt), gt(claimTokens.expiresAt, now)))
    .orderBy(desc(claimTokens.createdAt))
    .limit(1);
  if (live) {
    await db.update(members).set({ linkIssuedAt: now }).where(eq(members.id, me.id));
    return { kind: "claim", url: linkFor(`/claim/${live.token}`), expiresAt: live.expiresAt };
  }
  const created = await createClaimToken(me.id, now);
  return { kind: "claim", url: created.url, expiresAt: created.expiresAt };
}

/** Insert or refresh the Account for a signed-in Neon Auth user. */
export async function upsertAccount(user: AuthUser): Promise<Account> {
  const values = { authUserId: user.id, email: user.email, name: user.name ?? null, image: user.image ?? null };
  const [a] = await db
    .insert(accounts)
    .values(values)
    .onConflictDoUpdate({ target: accounts.authUserId, set: { email: values.email, name: values.name, image: values.image } })
    .returning();
  return a;
}

export async function accountByEmail(email: string): Promise<Account | undefined> {
  const [a] = await db.select().from(accounts).where(eq(accounts.email, email));
  return a;
}

export async function accountByAuthUser(authUserId: string): Promise<Account | undefined> {
  const [a] = await db.select().from(accounts).where(eq(accounts.authUserId, authUserId));
  return a;
}

/** Read a token without consuming it (the claim page shows who it's for before sign-in). */
export async function peekClaim(token: string, now = new Date()) {
  const [row] = await db
    .select({ token: claimTokens, memberName: members.displayName, groupId: members.groupId })
    .from(claimTokens)
    .innerJoin(members, eq(claimTokens.memberId, members.id))
    .where(eq(claimTokens.token, token));
  return { state: claimState(row?.token, now), memberName: row?.memberName, groupId: row?.groupId };
}

export class ClaimError extends Error {
  constructor(
    readonly state: Exclude<ClaimState, "ok"> | "taken" | "already-in-group",
    otherName?: string,
  ) {
    super(
      state === "taken"
        ? "This Member is already linked to a different Google account."
        : state === "already-in-group"
          ? `Your Google account is already ${otherName ?? "someone else"} in this group. Sign in with the account that belongs to this link.`
          : CLAIM_PROBLEMS[state],
    );
    this.name = "ClaimError";
  }
}

/**
 * Consume a Claim link for the signed-in user: single use, not expired. Upserts their Account and links it to the
 * Member. Claiming again with the Account that already owns the Member is a no-op success.
 */
export async function consumeClaim(token: string, user: AuthUser, now = new Date()): Promise<{ groupId: string; memberId: string; account: Account }> {
  const account = await upsertAccount(user);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(claimTokens).where(eq(claimTokens.token, token)).for("update");
    const state = claimState(row, now);
    if (state === "missing") throw new ClaimError(state);
    const [m] = await tx.select().from(members).where(eq(members.id, row!.memberId)).for("update");
    if (!m || m.status === "removed") throw new ClaimError("missing");
    if (state === "used" && m.accountId === account.id) return { groupId: m.groupId, memberId: m.id, fresh: false }; // reload after claiming
    if (state !== "ok") throw new ClaimError(state);
    if (m.accountId && m.accountId !== account.id) throw new ClaimError("taken");
    const [other] = await tx.select().from(members).where(and(eq(members.groupId, m.groupId), eq(members.accountId, account.id)));
    if (other && other.id !== m.id) throw new ClaimError("already-in-group", other.displayName);
    await tx.update(members).set({ accountId: account.id }).where(eq(members.id, m.id));
    await tx.update(claimTokens).set({ usedAt: now }).where(eq(claimTokens.token, token));
    return { groupId: m.groupId, memberId: m.id, fresh: true };
  });
  if (result.fresh) await record(result.groupId, result.memberId, "member.claimed", "signed in to the dashboard");
  return { groupId: result.groupId, memberId: result.memberId, account };
}
