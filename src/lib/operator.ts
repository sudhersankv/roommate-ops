// Server operators (ROOMIE_OPERATOR_EMAILS): the people who run this deployment, not anyone's Group Admin. Only they
// see /admin/*; for everyone else those pages and their API don't exist (404).
//
// The allowlist is matched only against an email the identity provider verified (Google sign-in always is), so an
// account that merely claims an operator's address never passes. Fail-closed: no env var, no operators.
import { isOperator } from "@/lib/env";
import { devAuthEmail } from "@/lib/auth/dev";
import { sessionUser } from "@/lib/session";
import type { AuthUser } from "@/services/claims";

/** Pure decision: is this signed-in user an operator? `devEmail` is the dev bypass identity (never set in production). */
export function operatorFrom(user: AuthUser | null, opts: { operators: string[]; devEmail?: string | null }): AuthUser | null {
  if (!user) return null;
  const email = user.email.trim().toLowerCase();
  if (!opts.operators.some((o) => o.trim().toLowerCase() === email)) return null;
  const verified = user.emailVerified === true || (!!opts.devEmail && user.email === opts.devEmail);
  return verified ? user : null;
}

/** The signed-in user when they're an operator, else null. */
export async function currentOperator(): Promise<AuthUser | null> {
  const user = await sessionUser();
  if (!user || !isOperator(user.email)) return null;
  return operatorFrom(user, { operators: [user.email], devEmail: devAuthEmail() });
}
