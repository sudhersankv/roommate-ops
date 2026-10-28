// Import first in every entry point (src/mastra/index.ts, scripts, instrumentation.ts).
// `.env` wins over variables already set in the process: Node's --env-file and Next's loader never override, so a
// stale system-wide NEON_AI_GATEWAY_BASE_URL (another project) would silently send requests to the wrong gateway
// and come back 401. Missing .env (CI) is fine.
import { config } from "dotenv";

config({ override: true, quiet: true });
