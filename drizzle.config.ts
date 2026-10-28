import "./src/lib/env";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Mastra creates its own tables in the same DB (mastra_* for storage, memory_messages* for pgvector recall);
  // don't let push drop them.
  tablesFilter: ["!mastra_*", "!memory_messages*"],
});
