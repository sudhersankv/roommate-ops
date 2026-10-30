// URL helpers for the Google sign-in return (lib/auth/oauth-return.ts). No server imports: GoogleButton uses these.

export const VERIFIER_PARAM = "neon_auth_session_verifier"
export const AUTH_ERROR_PARAM = "auth_error"
export const CALLBACK_PATH = "/auth/callback"
/** The sign-in screen (Google + paste a Claim link). `/` is the public landing page for everyone. */
export const SIGNIN_PATH = "/signin"
/** Where a signed-in person lands: their Group's dashboard, or "no groups yet" with the paste-a-Claim-link form. */
export const APP_PATH = "/app"
/** `/app?not_connected=1`: you opened a Group's dashboard that your Account isn't connected to (lib/session.ts). */
export const NOT_CONNECTED_PARAM = "not_connected"

/** A path on this site to continue to. Anything else (absolute, protocol-relative, backslashes) becomes /signin. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return SIGNIN_PATH
  return raw
}

const isSignIn = (path: string) => path === SIGNIN_PATH || path.startsWith(`${SIGNIN_PATH}?`) || path.startsWith(`${SIGNIN_PATH}/`)

/** Where /signin continues to once you're signed in: a path on this site, never /signin or the landing page (/app by default). */
export function afterSignIn(raw: string | null | undefined): string {
  const next = safeNext(raw)
  return isSignIn(next) || next === "/" ? APP_PATH : next
}

/** The sign-in screen, continuing to `next` afterwards (`/signin?next=/g/…`; plain /signin for /app). */
export function signInPath(next: string | null | undefined = APP_PATH): string {
  const to = afterSignIn(next)
  return to === APP_PATH ? SIGNIN_PATH : withParam(SIGNIN_PATH, "next", to)
}

/** Where GoogleButton asks Neon Auth to send the browser back to. */
export const callbackPathFor = (next: string) => `${CALLBACK_PATH}?next=${encodeURIComponent(safeNext(next))}`

/**
 * Why the last Google sign-in came back without a session, from a page's searchParams: `auth_error` (set by
 * /auth/callback), or a verifier that reached the page unexchanged. Null when the visitor just hasn't signed in.
 */
export function authErrorFrom(params: Record<string, string | string[] | undefined>): string | null {
  const one = (k: string) => {
    const v = params[k]
    return Array.isArray(v) ? v[0] : v
  }
  const code = one(AUTH_ERROR_PARAM) ?? (one(VERIFIER_PARAM) ? "verifier_not_exchanged" : undefined)
  return code ? (/^[\w.-]{1,64}$/.test(code) ? code : "oauth_error") : null
}

/** `path` with one query param set (relative, same as the input). */
export function withParam(path: string, key: string, value: string): string {
  const u = new URL(path, "http://roomie.invalid")
  u.searchParams.set(key, value)
  return `${u.pathname}${u.search}`
}

/** `path` minus one query param. */
export function withoutParam(path: string, key: string): string {
  const u = new URL(path, "http://roomie.invalid")
  u.searchParams.delete(key)
  return `${u.pathname}${u.search}`
}
