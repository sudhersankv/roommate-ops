import "./src/lib/env";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Only our tables in public. Mastra creates its own (mastra_* for storage, memory_messages* for pgvector recall)
  // and Neon Auth owns the neon_auth schema; drizzle must never touch either.
  schemaFilter: ["public"],
  tablesFilter: ["!mastra_*", "!memory_messages*"],
});
