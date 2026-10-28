// Telegram webhook, for when Roomie has a public APP_URL (`npm run telegram:webhook -- --set`). Local dev polls with
// `npm run telegram` instead. Telegram sends the secret given to setWebhook in X-Telegram-Bot-Api-Secret-Token;
// a missing or wrong one is a 401, and so is every call while TELEGRAM_WEBHOOK_SECRET is unset.
import { timingSafeEqual } from "node:crypto";
import { webhookCallback } from "grammy";
import { telegramBot, telegramToken } from "@/channels/telegram-boot";

export const runtime = "nodejs";

let handler: ((req: Request) => Promise<Response>) | undefined;

const sameSecret = (given: string | null, secret: string) => {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret || !sameSecret(req.headers.get("x-telegram-bot-api-secret-token"), secret)) return new Response("unauthorized", { status: 401 });
  if (!telegramToken()) return new Response("Telegram isn't set up on this server.", { status: 503 });
  // The handlers only queue the work, so Telegram gets its 200 right away and the reply follows.
  handler ??= webhookCallback((await telegramBot({ presetIdentity: true })).bot, "std/http", { secretToken: secret });
  return handler(req);
}
