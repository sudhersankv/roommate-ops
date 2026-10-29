// The operator decision, with nothing imported: who may see /admin/*. lib/operator.ts applies it to the session.
import type { AuthUser } from "@/services/claims";

/**
 * The allowlist is matched only against an email the identity provider verified (Google sign-in always is), so an
 * account that merely claims an operator's address never passes. Fail-closed: an empty list admits nobody.
 * `devEmail` is the dev bypass identity (never set in production) and counts as verified for itself only.
 */
export function operatorFrom(user: AuthUser | null, opts: { operators: string[]; devEmail?: string | null }): AuthUser | null {
  if (!user) return null;
  const email = user.email.trim().toLowerCase();
  if (!opts.operators.some((o) => o.trim().toLowerCase() === email)) return null;
  const verified = user.emailVerified === true || (!!opts.devEmail && user.email === opts.devEmail);
  return verified ? user : null;
}
