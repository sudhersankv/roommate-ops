// Server operators (ROOMIE_OPERATOR_EMAILS): the people who run this deployment, not anyone's Group Admin. Only they
// see /admin/*; for everyone else those pages and their API don't exist (404).
import { isOperator } from "@/lib/env";
import { sessionUser } from "@/lib/session";
import type { AuthUser } from "@/services/claims";

/** The signed-in user when they're an operator, else null. */
export async function currentOperator(): Promise<AuthUser | null> {
  const user = await sessionUser();
  return user && isOperator(user.email) ? user : null;
}
