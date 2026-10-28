// Composio (ADR 0004): one client for the app, plus a cached health check so the dashboard can say "Splitwise isn't
// available" instead of failing on click. Roomie's own tools wrap every Composio call; the agent never sees them.
import { Composio } from "@composio/core";

let client: Composio | null = null;

export function composio(): Composio | null {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();
  if (!apiKey) return null;
  client ??= new Composio({ apiKey, disableVersionCheck: true, allowTracking: false });
  return client;
}

/** Composio refusing our key (or a user's missing connection) as opposed to a real outage. */
export function isAuthError(e: unknown): boolean {
  const err = e as { status?: number; name?: string; code?: string; cause?: { status?: number }; message?: string } | null;
  if (!err) return false;
  return (
    err.status === 401 ||
    err.status === 403 ||
    err.cause?.status === 401 ||
    err.name === "AuthenticationError" ||
    err.name === "ComposioNoAPIKeyError" ||
    err.name === "ComposioConnectedAccountNotFoundError" ||
    /\b401\b|invalid api key|unauthori[sz]ed|no connected account|connected account not found/i.test(err.message ?? "")
  );
}

export type ComposioHealth = "ok" | "missing-key" | "invalid-key" | "error";

let health: { at: number; value: ComposioHealth } | null = null;
const HEALTH_TTL_MS = 5 * 60_000;

/** "ok" when the API key works. Cached for 5 minutes; a 401 means the key is wrong, not that Composio is down. */
export async function composioHealth(): Promise<ComposioHealth> {
  if (health && Date.now() - health.at < HEALTH_TTL_MS) return health.value;
  const c = composio();
  let value: ComposioHealth;
  if (!c) value = "missing-key";
  else {
    try {
      await c.authConfigs.list({ toolkit: "splitwise" });
      value = "ok";
    } catch (e) {
      value = isAuthError(e) ? "invalid-key" : "error";
    }
  }
  health = { at: Date.now(), value };
  return value;
}
