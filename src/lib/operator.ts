// Server operators (ROOMIE_OPERATOR_EMAILS): the people who run this deployment, not anyone's Group Admin. Only they
// see /admin/*; for everyone else those pages and their API don't exist (404). The rule itself is in operator-rule.ts.
import { operatorEmails } from "@/lib/env";
import { devAuthEmail } from "@/lib/auth/dev";
import { sessionUser } from "@/lib/session";
import { operatorFrom } from "@/lib/operator-rule";
import type { AuthUser } from "@/services/claims";

/** The signed-in user when they're an operator, else null. */
export async function currentOperator(): Promise<AuthUser | null> {
  return operatorFrom(await sessionUser(), { operators: operatorEmails(), devEmail: devAuthEmail() });
}
