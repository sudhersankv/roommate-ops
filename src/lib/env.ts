// `.env` wins over variables already set in the process: Node's --env-file, Next's loader and `mastra dev` never
// override, so a stale system-wide NEON_AI_GATEWAY_BASE_URL (another project) would silently send requests to the
// wrong gateway and come back 401. Missing .env (CI) is fine.
//
// Import this first in every entry point. Bundled code (mastra dev tree-shakes side-effect-only imports) must also
// CALL loadEnv(); lib/llm.ts does, so anything that reaches a model has it. The file is looked up from the cwd
// upwards because `mastra dev` runs its bundle from .mastra/output.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "dotenv";

let loaded: string | null | undefined;

function findEnvFile(from = process.cwd()): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const file = join(dir, ".env");
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) return null;
  }
}

/** Load .env over the process env once. Returns the file used, or null when there is none. */
export function loadEnv(): string | null {
  if (loaded === undefined) {
    loaded = findEnvFile();
    if (loaded) config({ path: loaded, override: true, quiet: true });
  }
  return loaded;
}

loadEnv();

/** ROOMIE_OPERATOR_EMAILS (comma-separated): who may run the server's admin pages (/admin/whatsapp). */
export const operatorEmails = (): string[] =>
  (process.env.ROOMIE_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const isOperator = (email: string | null | undefined): boolean => !!email && operatorEmails().includes(email.trim().toLowerCase());
