// npm run telegram:webhook -- --set | --delete | --info
// Points Telegram at <APP_URL>/api/telegram with TELEGRAM_WEBHOOK_SECRET (needs a public https APP_URL). While a
// webhook is set, `npm run telegram` can't poll: it deletes the webhook when it starts.
import "../src/lib/env";
import { Api } from "grammy";
import { TOKEN_MISSING, telegramToken } from "../src/channels/telegram-boot";
import { TELEGRAM_UPDATES } from "../src/channels/telegram";
import { isProdAppUrl, PROD_APP_URL, prodBotAllowed, refuseProdBot } from "./lib/prod-guard";

const token = telegramToken();
if (!token) {
  console.error(TOKEN_MISSING);
  process.exit(1);
}
const api = new Api(token);
const mode = process.argv.slice(2).find((a) => ["--set", "--delete", "--info"].includes(a)) ?? "--info";

try {
  if (mode === "--set") {
    const base = process.env.APP_URL?.replace(/\/$/, "");
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!base?.startsWith("https://")) throw new Error("APP_URL must be a public https URL for a webhook (local dev: npm run telegram).");
    if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) throw new Error("TELEGRAM_WEBHOOK_SECRET must be set: 1-256 characters of A-Z, a-z, 0-9, _ and -.");
    if (!isProdAppUrl(base) && !prodBotAllowed()) refuseProdBot(`--set points the bot at ${base}, not ${PROD_APP_URL}. If TELEGRAM_BOT_TOKEN is the production bot, real groups would go there.`);
    await api.setWebhook(`${base}/api/telegram`, { secret_token: secret, allowed_updates: [...TELEGRAM_UPDATES], drop_pending_updates: false });
    console.log(`Webhook set to ${base}/api/telegram`);
  } else if (mode === "--delete") {
    if (isProdAppUrl(process.env.APP_URL) && !prodBotAllowed()) refuseProdBot(`APP_URL is ${process.env.APP_URL}, so this is the production bot's webhook.`);
    await api.deleteWebhook();
    console.log("Webhook deleted (npm run telegram can poll now).");
  }
  const info = await api.getWebhookInfo();
  console.log({ url: info.url || "(none: polling)", pending: info.pending_update_count, lastError: info.last_error_message ?? null });
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
