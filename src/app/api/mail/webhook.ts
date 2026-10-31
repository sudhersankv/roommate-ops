// The Lease Inbox's webhook (ADR 0016): AgentMail posts every received email here. The Svix signature is checked on
// the raw body (AGENTMAIL_WEBHOOK_SECRET; a bad or missing one is a 401), the answer is 204 at once, and the work is
// queued per inbox (KeyedQueue: one inbox's mail in order, others don't wait). Deliveries repeat for ~27 hours and
// arrive out of order: storeInbound dedupes on event_id. Outside production, MAIL_FAKE=1 plus the header
// `x-roomie-fake-mail: 1` skips the signature so dev-chat and tests can post. Not the route file itself (Next only
// allows the HTTP methods there), so tests inject the handler.
import { Webhook } from "svix";
import { KeyedQueue } from "@/channels/queue";
import { handleMailEvent, parseMailEvent, type MailEvent } from "@/services/lease-inbox-inbound";

export const mailQueue = new KeyedQueue("mail");

export type MailWebhookDeps = {
  secret: string | undefined;
  /** MAIL_FAKE=1 outside production: the fake header is honoured. */
  fakeAllowed: boolean;
  handle(event: MailEvent): Promise<unknown>;
  queue: Pick<KeyedQueue, "push">;
};

export const defaultMailDeps = (): MailWebhookDeps => ({
  secret: process.env.AGENTMAIL_WEBHOOK_SECRET?.trim() || undefined,
  fakeAllowed: process.env.MAIL_FAKE === "1" && process.env.NODE_ENV !== "production",
  handle: (event) => handleMailEvent(event),
  queue: mailQueue,
});

const unauthorized = () => new Response("unauthorized", { status: 401 });

/** POST /api/mail. */
export async function mailWebhook(req: Request, deps: MailWebhookDeps = defaultMailDeps()): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
  const raw = await req.text();
  const fake = deps.fakeAllowed && req.headers.get("x-roomie-fake-mail") === "1";
  if (!fake) {
    if (!deps.secret) return unauthorized();
    try {
      new Webhook(deps.secret).verify(raw, {
        "svix-id": req.headers.get("svix-id") ?? "",
        "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
        "svix-signature": req.headers.get("svix-signature") ?? "",
      });
    } catch {
      return unauthorized();
    }
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const event = parseMailEvent(json);
  // Anything that isn't a received email (sent, delivered, bounced, spam) is acknowledged and dropped.
  if (event) deps.queue.push(event.inboxId, () => deps.handle(event));
  return new Response(null, { status: 204 });
}
