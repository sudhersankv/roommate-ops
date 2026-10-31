import type { NextConfig } from "next";

const config: NextConfig = {
  // Mastra, pg, Composio, grammY, Baileys (WhatsApp) and AgentMail (its optional @x402/fetch import) must run as plain
  // Node modules, not bundled.
  serverExternalPackages: ["@mastra/core", "@mastra/memory", "@mastra/pg", "@mastra/observability", "@mastra/evals", "pg", "@composio/core", "grammy", "baileys", "agentmail"],
};

export default config;
