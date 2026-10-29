import type { NextConfig } from "next";

const config: NextConfig = {
  // Mastra, pg, Composio, grammY and Baileys (WhatsApp) must run as plain Node modules, not bundled.
  serverExternalPackages: ["@mastra/core", "@mastra/memory", "@mastra/pg", "@mastra/observability", "@mastra/evals", "pg", "@composio/core", "grammy", "baileys"],
};

export default config;
