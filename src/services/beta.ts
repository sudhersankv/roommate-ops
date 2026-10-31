// Beta requests: the landing page's "Join the WhatsApp beta" form (docs/landing.md). Anyone can submit; the operator
// (ROOMIE_OPERATOR_EMAILS) gets a Telegram DM and works the list at /admin/beta. No Group, no Account, no email sent.
import { createHmac } from "node:crypto";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { BETA_GROUP_SIZES, BETA_STATUSES, GROUP_PURPOSES, type BetaStatus } from "@/db/enums";
import { signInPath } from "@/lib/auth/oauth-paths";
import { operatorEmails } from "@/lib/env";
import { dashboardUrl } from "@/lib/urls";
import { WindowLimiter } from "@/lib/window-limit";
import type { Outgoing } from "@/channels/types";
import { NotAllowedError } from "./authz";
import { mailOperator } from "./operator-mail";

export type BetaRequest = typeof schema.betaRequests.$inferSelect;

/** The honeypot: a field people never see. Bots that fill every input get a fake success and nothing is stored. */
export const HONEYPOT_FIELD = "website";
export const BETA_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 };

const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((v) => v || undefined);

const phoneDigits = (s: string) => s.replace(/\D/g, "");

export const betaRequestSchema = z.object({
  name: z.string().trim().min(1, "Tell us your name.").max(80, "Keep your name under 80 characters."),
  email: z.string().trim().toLowerCase().max(200, "That email is too long.").pipe(z.email("That email doesn't look right.")),
  groupSize: z.enum(BETA_GROUP_SIZES, { error: "Pick how many people are in the group." }),
  purpose: z.enum(GROUP_PURPOSES, { error: "Pick what the group is." }),
  phone: optionalText(32, "That number is too long.")
    .refine((v) => !v || (/^\+?[\d\s().-]+$/.test(v) && phoneDigits(v).length >= 7 && phoneDigits(v).length <= 15), "Use digits with the country code, like +1 555 123 4567.")
    .transform((v) => (v ? `${v.trim().startsWith("+") ? "+" : ""}${phoneDigits(v)}` : undefined)),
  notes: optionalText(1000, "Keep it under 1000 characters."),
});
export type BetaRequestInput = z.infer<typeof betaRequestSchema>;
export type BetaField = keyof BetaRequestInput;

export type SubmitResult =
  | { ok: true }
  | { ok: false; reason: "invalid"; errors: Partial<Record<BetaField, string>> }
  | { ok: false; reason: "rate_limited" | "failed"; message: string };

/** zod -> one message per field, for the form. */
export function parseBetaRequest(raw: Record<string, unknown>): { ok: true; data: BetaRequestInput } | { ok: false; errors: Partial<Record<BetaField, string>> } {
  const parsed = betaRequestSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: Partial<Record<BetaField, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as BetaField;
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}

/** An HMAC of the address, so repeat submitters can be spotted without keeping anyone's IP. */
export function hashIp(ip: string, secret = process.env.NEON_AUTH_COOKIE_SECRET || "roomie-beta"): string {
  return createHmac("sha256", secret).update(ip.trim().toLowerCase()).digest("hex").slice(0, 32);
}

const SIZE_LABEL: Record<(typeof BETA_GROUP_SIZES)[number], string> = { "2": "2 people", "3-4": "3-4 people", "5-8": "5-8 people", "9-15": "9-15 people", "16+": "16+ people" };

/** The operator's DM: who, what group, how to reach them. Plain text, a few lines. */
export function betaSummary(r: Pick<BetaRequest, "name" | "email" | "groupSize" | "purpose" | "phone" | "notes">): string {
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return [
    "🦖 New WhatsApp beta request",
    `${r.name} <${r.email}>`,
    `${r.purpose}, ${SIZE_LABEL[r.groupSize] ?? r.groupSize}${r.phone ? `, WhatsApp ${r.phone}` : ""}`,
    ...(r.notes ? [`"${clip(r.notes.replace(/\s+/g, " "), 280)}"`] : []),
  ].join("\n");
}

const limiter = (): WindowLimiter => {
  const g = globalThis as { __roomieBetaLimiter?: WindowLimiter };
  return (g.__roomieBetaLimiter ??= new WindowLimiter(BETA_LIMIT.max, BETA_LIMIT.windowMs));
};

export type SubmitMeta = { ip: string; userAgent?: string | null };
/** Sends a private message on Telegram (the registered Channel); null when Telegram isn't configured. */
export type TelegramSend = ((userId: string, out: Outgoing) => Promise<unknown>) | null;

export type SubmitDeps = {
  limiter?: WindowLimiter;
  insert?: (row: typeof schema.betaRequests.$inferInsert) => Promise<BetaRequest>;
  /** Runs the operator notification; the landing action passes next/server's after() so the form answers at once. */
  later?: (task: () => Promise<void>) => void;
  notify?: (row: BetaRequest) => Promise<void>;
};

const insertRow = async (row: typeof schema.betaRequests.$inferInsert) => (await db.insert(schema.betaRequests).values(row).returning())[0];

/**
 * The form's whole flow: honeypot, validation, 3 per IP per hour, store, then tell the operator. Never throws: the
 * landing page shows the result.
 */
export async function submitBetaRequest(raw: Record<string, unknown>, meta: SubmitMeta, deps: SubmitDeps & { telegram?: TelegramSend } = {}): Promise<SubmitResult> {
  if (typeof raw[HONEYPOT_FIELD] === "string" && raw[HONEYPOT_FIELD].trim()) {
    console.log("[beta] honeypot filled, ignored");
    return { ok: true };
  }
  const parsed = parseBetaRequest(raw);
  if (!parsed.ok) return { ok: false, reason: "invalid", errors: parsed.errors };

  const ipHash = hashIp(meta.ip);
  if (!(deps.limiter ?? limiter()).take(ipHash)) {
    console.log(`[beta] rate limited ip=${ipHash.slice(0, 8)}`);
    return { ok: false, reason: "rate_limited", message: "That's a few requests from here already. Try again in an hour." };
  }

  let row: BetaRequest;
  try {
    row = await (deps.insert ?? insertRow)({ ...parsed.data, phone: parsed.data.phone ?? null, notes: parsed.data.notes ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null, ipHash });
  } catch (e) {
    console.error("[beta] couldn't save a request:", e instanceof Error ? e.message : e);
    return { ok: false, reason: "failed", message: "Something went wrong on our side and your request wasn't saved. Try again in a minute." };
  }
  console.log(`[beta] request ${row.id} saved (${row.purpose}, ${row.groupSize})`);
  const notify = deps.notify ?? (async (r: BetaRequest) => void (await notifyOperator(r, deps.telegram ?? null)));
  const run = () => notify(row).catch((e) => console.log(`[beta] notify failed for ${row.id}: ${e instanceof Error ? e.message : e}`));
  if (deps.later) deps.later(run);
  else await run();
  return { ok: true };
}

/** The operator's Telegram user id: the first ROOMIE_OPERATOR_EMAILS Account -> one of its Members in a Telegram Chat. */
export async function operatorTelegramUserId(email = operatorEmails()[0]): Promise<string | null> {
  if (!email) return null;
  const [row] = await db
    .select({ channelUserId: schema.members.channelUserId })
    .from(schema.accounts)
    .innerJoin(schema.members, eq(schema.members.accountId, schema.accounts.id))
    .innerJoin(schema.chats, eq(schema.chats.groupId, schema.members.groupId))
    .where(and(sql`lower(${schema.accounts.email}) = ${email.toLowerCase()}`, eq(schema.chats.channel, "telegram"), isNotNull(schema.members.channelUserId)))
    .limit(1);
  return row?.channelUserId ?? null;
}

/**
 * Tell the operator: an email from notify@ to OPERATOR_EMAIL (services/operator-mail.ts); without one, a Telegram DM;
 * when neither is possible, one `[beta]` log line (it shows up in Fly's logs).
 */
export async function notifyOperator(
  row: BetaRequest,
  send: TelegramSend,
  findUser = operatorTelegramUserId,
  mail: (subject: string, text: string) => Promise<"sent" | "skipped" | "failed"> = mailOperator,
): Promise<"email" | "telegram" | "log"> {
  const text = betaSummary(row);
  // Through /signin: /admin/* is a 404 until you're signed in, and /signin continues there at once if you are.
  const link = dashboardUrl(signInPath("/admin/beta"));
  if ((await mail(`Roomie beta request: ${row.name}`, link ? `${text}\n\nAll requests: ${link}` : text).catch(() => "failed" as const)) === "sent") return "email";
  const fallback = (why: string) => {
    console.log(`[beta] ${why}; request ${row.id}:\n${text}`);
    return "log" as const;
  };
  if (!send) return fallback("no Telegram channel (TELEGRAM_BOT_TOKEN unset)");
  const userId = await findUser().catch(() => null);
  if (!userId) return fallback("no operator Telegram Member found (ROOMIE_OPERATOR_EMAILS + a Claim link in a Telegram group)");
  try {
    console.log(`[beta] DMing the operator on Telegram about ${row.id}`);
    await send(userId, { text, ...(link ? { buttons: [{ text: "Open beta requests", url: link }] } : {}) });
    return "telegram";
  } catch (e) {
    return fallback(`Telegram DM failed (${e instanceof Error ? e.message : String(e)})`);
  }
}

/** Reading and changing requests is for operators only (lib/operator.ts decides who that is). */
export type Operator = { email: string } | null;
function requireOperator(op: Operator): asserts op is { email: string } {
  if (!op) throw new NotAllowedError("Only the people who run Roomie can see beta requests.", "operator-only");
}

const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

/** Newest first, for /admin/beta. */
export async function listBetaRequests(op: Operator, limit = 500): Promise<BetaRequest[]> {
  requireOperator(op);
  return db.select().from(schema.betaRequests).orderBy(desc(schema.betaRequests.createdAt)).limit(limit);
}

export async function setBetaStatus(op: Operator, id: string, status: BetaStatus): Promise<BetaRequest | null> {
  requireOperator(op);
  if (!(BETA_STATUSES as readonly string[]).includes(status)) throw new Error(`Status must be one of: ${BETA_STATUSES.join(", ")}.`);
  if (!isId(id)) return null;
  const [row] = await db.update(schema.betaRequests).set({ status }).where(eq(schema.betaRequests.id, id)).returning();
  return row ?? null;
}

export async function deleteBetaRequest(op: Operator, id: string): Promise<void> {
  requireOperator(op);
  if (isId(id)) await db.delete(schema.betaRequests).where(eq(schema.betaRequests.id, id));
}
