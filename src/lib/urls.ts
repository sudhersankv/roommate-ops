// Absolute dashboard links for chat buttons and Claim links. Relative links are useless in a chat app, so callers
// get null when APP_URL is unset or not absolute.

/** Dashboard base URL (APP_URL, trailing slashes trimmed); "" when unset. */
export const appUrl = () => (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");

/** True when the link is absolute (http/https), i.e. usable as a chat button. */
export const isAbsoluteUrl = (url: string | null | undefined) => /^https?:\/\//i.test(url ?? "");

export function dashboardUrl(path: string, query?: Record<string, string | null | undefined>): string | null {
  const base = appUrl();
  if (!isAbsoluteUrl(base)) return null;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) params.set(k, v);
  const qs = params.toString();
  return `${base}${path.startsWith("/") ? path : `/${path}`}${qs ? `?${qs}` : ""}`;
}

/** Same as dashboardUrl but falls back to a relative path, for places that print it (dev-chat, seed). */
export const linkFor = (path: string) => dashboardUrl(path) ?? path;
