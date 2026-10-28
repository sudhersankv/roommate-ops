export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/env"); // .env over stale process env (see lib/env.ts)
    if (process.env.TELEGRAM_BOT_TOKEN) {
      // Outbound only, so the scheduler and Claim links reach Telegram; updates come from `npm run telegram` or the webhook.
      const { telegramChannel } = await import("./channels/telegram-boot");
      telegramChannel();
    }
    if (process.env.DISABLE_SCHEDULER !== "1") {
      const { startScheduler } = await import("./jobs/scheduler");
      startScheduler();
    }
  }
}
