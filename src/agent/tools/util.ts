import { listMembers } from "@/services/members";
import type { Ctx } from "@/services/types";

export const toCents = (dollars: number) => Math.round(dollars * 100);

/** Case-insensitive first-name match. Unknown names throw so the model can ask. */
export async function memberIdByName(ctx: Ctx, name: string): Promise<string> {
  const people = await listMembers(ctx);
  const hit = people.find((p) => p.name.toLowerCase().startsWith(name.trim().toLowerCase()));
  if (!hit) throw new Error(`No member named "${name}". Members: ${people.map((p) => p.name).join(", ")}`);
  return hit.id;
}

/** Dashboard base URL (APP_URL, trailing slashes trimmed); "" when unset. */
export const appUrl = () => (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");

/** True when the link is absolute (http/https), i.e. usable as a chat button. */
export const isAbsoluteUrl = (url: string | null | undefined) => /^https?:\/\//i.test(url ?? "");

/**
 * Absolute link to a dashboard path (e.g. "/cart"), or null when APP_URL is unset or not absolute.
 * A relative link is useless in a chat app, so callers attach a button only when this is non-null.
 */
export function dashboardUrl(path: string, query?: Record<string, string | null | undefined>): string | null {
  const base = appUrl();
  if (!isAbsoluteUrl(base)) return null;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) params.set(k, v);
  const qs = params.toString();
  return `${base}${path.startsWith("/") ? path : `/${path}`}${qs ? `?${qs}` : ""}`;
}
