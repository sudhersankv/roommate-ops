// Email to the people who run Roomie: a WhatsApp beta request, an "I want this" vote. Sent from notify@<mail domain>
// (an AgentMail inbox, created once: idempotent by its client id) to OPERATOR_EMAIL (a Fly secret, comma-separated:
// the first is To, any others CC). Personal addresses never go in the code, the site or the repo. Best-effort: a
// failure is logged and never reaches the visitor.
import { mailAvailability, mailClient, type MailClient } from "@/integrations/mail";

/** The inbox operator email is sent from: notify@<mail domain>. */
const SENDER = { clientId: "roomie-operator-notify", username: "notify" };

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Who gets operator email: OPERATOR_EMAIL's first valid address as To, the rest as CC; null when there's none. */
export function operatorRecipients(env: Record<string, string | undefined> = process.env): { to: string; cc: string[] } | null {
  const all = (env.OPERATOR_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isEmail);
  return all.length ? { to: all[0], cc: all.slice(1) } : null;
}

/**
 * Send one email to the operator. "skipped" without OPERATOR_EMAIL, without a real mail service (no
 * AGENTMAIL_API_KEY, MAIL_FAKE) or under the test runner, unless a client is passed in: tests never email anyone.
 */
export async function mailOperator(
  subject: string,
  text: string,
  opts: { client?: MailClient; env?: Record<string, string | undefined> } = {},
): Promise<"sent" | "skipped" | "failed"> {
  const env = opts.env ?? process.env;
  const recipients = operatorRecipients(env);
  if (!recipients) {
    console.log(`[operator-mail] OPERATOR_EMAIL isn't set; not sent: "${subject}"`);
    return "skipped";
  }
  const client = opts.client ?? (env.NODE_TEST_CONTEXT || mailAvailability().kind !== "agentmail" ? null : mailClient());
  if (!client) return "skipped";
  try {
    const inbox = await client.createInbox(SENDER.clientId, SENDER.username);
    await client.send(inbox.inboxId, { to: recipients.to, ...(recipients.cc.length ? { cc: recipients.cc } : {}), subject, text });
    console.log(`[operator-mail] sent "${subject}"`);
    return "sent";
  } catch (e) {
    console.warn(`[operator-mail] "${subject}" failed: ${e instanceof Error ? e.message : String(e)}`);
    return "failed";
  }
}
