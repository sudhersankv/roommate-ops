export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/env"); // .env over stale process env (see lib/env.ts)
    if (process.env.TELEGRAM_BOT_TOKEN) {
      // Outbound only, so the scheduler and Claim links reach Telegram; updates come from `npm run telegram` or the webhook.
      const { telegramChannel } = await import("./channels/telegram-boot");
      telegramChannel();
    }
    // The long-running parts (the WhatsApp socket, the scheduler) run once, in the server process, never in a build.
    if (process.env.DISABLE_SCHEDULER !== "1") {
      if (process.env.WHATSAPP_ENABLED === "1") {
        // In and out: this process holds the WhatsApp session (docs/whatsapp.md). Never blocks the server start.
        const { whatsappChannel } = await import("./channels/whatsapp-boot");
        void whatsappChannel().catch((err) => console.error("[whatsapp] couldn't start", err));
      }
      const { startScheduler } = await import("./jobs/scheduler");
      startScheduler();
    }
  }
}
