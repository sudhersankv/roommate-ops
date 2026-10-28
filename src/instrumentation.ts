export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/env"); // .env over stale process env (see lib/env.ts)
    if (process.env.DISABLE_SCHEDULER !== "1") {
      const { startScheduler } = await import("./jobs/scheduler");
      startScheduler();
    }
  }
}
