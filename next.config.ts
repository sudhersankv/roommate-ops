import type { NextConfig } from "next";

const config: NextConfig = {
  // Mastra, pg and Composio must run as plain Node modules, not bundled.
  serverExternalPackages: ["@mastra/core", "@mastra/memory", "@mastra/pg", "@mastra/observability", "@mastra/evals", "pg", "@composio/core"],
};

export default config;
