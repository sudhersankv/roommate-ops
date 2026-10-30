// Who is looking at the dashboard: the Neon Auth session -> our Account -> their Member in a Group.
// Every page and server action goes through here, so a request never acts as anyone but the signed-in Member.
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { devAuthEmail, warnDevAuth } from "@/lib/auth/dev";
import { APP_PATH, NOT_CONNECTED_PARAM, signInPath } from "@/lib/auth/oauth-paths";
import { accountByEmail, upsertAccount, type Account, type AuthUser } from "@/services/claims";
import { getGroup, groupsForAccount, type Group } from "@/services/groups";
import { getMember, type Member } from "@/services/members";
import type { Ctx } from "@/services/types";

/** The signed-in user, or null. With the dev bypass (lib/auth/dev.ts) the DEV_AUTH_EMAIL Account. */
export const sessionUser = cache(async (): Promise<AuthUser | null> => {
  const devEmail = devAuthEmail();
  if (devEmail) {
    warnDevAuth(devEmail);
    const existing = await accountByEmail(devEmail);
    return existing
      ? { id: existing.authUserId, email: existing.email, name: existing.name, image: existing.image }
      : { id: `dev:${devEmail}`, email: devEmail, name: devEmail.split("@")[0] };
  }
  let data: Awaited<ReturnType<typeof auth.getSession>>["data"];
  try {
    ({ data } = await auth.getSession());
  } catch (err) {
    // The SDK sometimes wants to rewrite the session cookie while it reads it (a stale cookie after sign-out, a refresh).
    // Next forbids cookie writes during a page render and throws; that must mean "signed out", never a broken page.
    // The next sign-in sets fresh cookies from a route handler, so nothing is lost.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/Cookies can only be modified/i.test(msg)) console.warn(`[auth] getSession failed, treating as signed out: ${msg.slice(0, 160)}`);
    return null;
  }
  const u = data?.user;
  return u ? { id: u.id, email: u.email, name: u.name, image: u.image ?? null, emailVerified: u.emailVerified === true } : null;
});

/** The signed-in Account (created on first sight, mirroring the neon_auth user), or null when signed out. */
export const currentAccount = cache(async (): Promise<Account | null> => {
  const user = await sessionUser();
  return user ? upsertAccount(user) : null;
});

export type GroupSession = {
  account: Account;
  member: Member;
  group: Group;
  groups: { id: string; name: string }[];
  ctx: Ctx;
};

/** The Account's Member in `groupId`, or null (signed out or not a Member). No redirects: route handlers use this. */
export const memberSession = cache(async (groupId: string): Promise<GroupSession | null> => {
  const account = await currentAccount();
  if (!account || !/^[0-9a-f-]{36}$/i.test(groupId)) return null;
  const mine = await groupsForAccount(account.id);
  const here = mine.find((g) => g.id === groupId);
  if (!here) return null;
  const [member, group] = await Promise.all([getMember({ groupId }, here.memberId), getGroup(groupId)]);
  if (!member || !group) return null;
  return {
    account,
    member,
    group,
    groups: mine.map((g) => ({ id: g.id, name: g.name })),
    ctx: { groupId, memberId: member.id, source: "ui" },
  };
});

/**
 * Pages: the session for a Group, or a redirect to sign-in; a Group you're not connected to sends you to /app with
 * `not_connected` so it can say what to do (ask Roomie for your own link), instead of a bare 404. The id isn't echoed.
 */
export async function currentMember(groupId: string): Promise<GroupSession> {
  if (!(await currentAccount())) redirect(signInPath(`/g/${groupId}`));
  const s = await memberSession(groupId);
  if (!s) redirect(/^[0-9a-f-]{36}$/i.test(groupId) ? `${APP_PATH}?${NOT_CONNECTED_PARAM}=1` : notFoundPath());
  return s;
}

const notFoundPath = (): never => notFound();
