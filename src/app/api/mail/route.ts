// AgentMail's webhook for the Lease Inbox: the logic is in ./webhook.ts (Svix on the raw body, 204 at once, queued
// per inbox, deduped on event_id).
import { mailWebhook } from "./webhook";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return mailWebhook(req);
}
