// npm run telegram: Roomie on Telegram by long polling (local dev; docs/telegram.md). Deletes any webhook first,
// since Telegram delivers updates to one or the other. Ctrl+C stops it after the queued replies are out.
import "../src/lib/env";
import { TOKEN_MISSING, telegramBot, telegramToken } from "../src/channels/telegram-boot";
import { TELEGRAM_UPDATES } from "../src/channels/telegram";

if (!telegramToken()) {
  console.error(TOKEN_MISSING);
  process.exit(1);
}

const { db } = await import("../src/db");
const { mastra } = await import("../src/mastra");
const { useFakeSplitwiseIfUnavailable } = await import("../src/integrations/splitwise");

await useFakeSplitwiseIfUnavailable();
const tg = await telegramBot();

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("[telegram] stopping...");
  await tg.bot.stop().catch(() => {});
  await tg.idle();
  await mastra.observability.flush().catch(() => {});
  await db.$client.end().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await tg.bot.api.deleteWebhook();
  await tg.bot.start({
    allowed_updates: [...TELEGRAM_UPDATES],
    onStart: (me) => console.log(`[telegram] @${me.username} is polling. Add it to a group (docs/telegram.md). Ctrl+C to stop.`),
  });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(/401|Unauthorized/i.test(msg) ? "Telegram rejected TELEGRAM_BOT_TOKEN (401); check it with BotFather (docs/telegram.md)." : `[telegram] ${msg}`);
  await db.$client.end().catch(() => {});
  process.exit(1);
}
