// The end of Google sign-in. GoogleButton sends Neon Auth `callbackURL = /auth/callback?next=<path>`; after Google,
// Neon Auth sends the browser there with `neon_auth_session_verifier=…` appended (or `error=…` on failure). The
// verifier plus the challenge cookie that /api/auth/sign-in/social set are exchanged for the session cookies here, in
// one route handler, so nothing depends on proxy matchers. Then the browser continues to `next`; on any failure it
// goes to `next?auth_error=<reason>` so the page can say sign-in didn't complete instead of silently looping.
import { auth } from "@/lib/auth/server"
import { AUTH_ERROR_PARAM, VERIFIER_PARAM, safeNext, withParam, withoutParam } from "@/lib/auth/oauth-paths"
import { appUrl, isAbsoluteUrl } from "@/lib/urls"

// The SDK sets both spellings; either one is enough for the exchange.
const CHALLENGE_COOKIES = ["__Secure-neon-auth.session_challenge", "__Secure-neon-auth.session_challange"]

/** A short, log- and URL-safe reason code. */
const reasonCode = (raw: unknown) => (typeof raw === "string" && /^[\w.-]{1,64}$/.test(raw) ? raw : "oauth_error")

function challengeCookieHeader(cookieHeader: string | null): string | null {
  const found = (cookieHeader ?? "")
    .split(";")
    .map((c) => c.trim())
    .filter((c) => CHALLENGE_COOKIES.some((name) => c.startsWith(`${name}=`)))
  return found.length ? found.join("; ") : null
}

/** A relative 303, so the browser stays on whichever host it came in on (behind Fly, request.url is localhost). */
function redirectTo(path: string, outcome: string): Response {
  return new Response(null, { status: 303, headers: { location: path, "cache-control": "no-store", "x-roomie-auth": outcome } })
}

const expireChallenge = (name: string) => `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`

export async function completeOAuthReturn(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const next = withoutParam(safeNext(url.searchParams.get("next")), AUTH_ERROR_PARAM)
  const fail = (reason: string, detail = "") => {
    console.warn(`[auth] oauth return failed: ${reason}${detail ? ` ${detail}` : ""} next=${next}`)
    const res = redirectTo(withParam(next, AUTH_ERROR_PARAM, reason), `failed:${reason}`)
    for (const name of CHALLENGE_COOKIES) res.headers.append("set-cookie", expireChallenge(name))
    return res
  }

  if (url.searchParams.has("error")) return fail(reasonCode(url.searchParams.get("error")), "(from Neon Auth)")
  const verifier = url.searchParams.get(VERIFIER_PARAM)
  if (!verifier) return fail("missing_verifier")
  const challenge = challengeCookieHeader(request.headers.get("cookie"))
  if (!challenge) return fail("missing_challenge", "(the cookie from /api/auth/sign-in/social didn't come back)")

  // Same call the SDK's middleware makes (get-session with the verifier, through our /api/auth handler so the cookies
  // are rewritten and session_data is minted). Only the challenge cookies are sent, so an older session can't answer
  // from the cookie cache instead, and Origin is our own trusted domain rather than whatever Referer Google left.
  const origin = isAbsoluteUrl(appUrl()) ? new URL(appUrl()).origin : url.origin
  const exchange = new Request(`${origin}/api/auth/get-session?${VERIFIER_PARAM}=${encodeURIComponent(verifier)}`, {
    headers: { cookie: challenge, origin, "user-agent": request.headers.get("user-agent") ?? "" },
  })
  let res: Response
  try {
    res = await auth.handler().GET(exchange, { params: Promise.resolve({ path: ["get-session"] }) })
  } catch (e) {
    return fail("exchange_threw", e instanceof Error ? e.message : String(e))
  }
  const body = (await res.json().catch(() => null)) as { session?: unknown; user?: { id?: string }; code?: string } | null
  if (!res.ok || !body?.session) return fail(reasonCode(body?.code ?? `status_${res.status}`), `(get-session ${res.status})`)

  const out = redirectTo(next, "ok")
  for (const name of CHALLENGE_COOKIES) out.headers.append("set-cookie", expireChallenge(name))
  for (const cookie of res.headers.getSetCookie()) out.headers.append("set-cookie", cookie)
  console.log(`[auth] oauth return ok user=${body.user?.id ?? "?"} next=${next}`)
  return out
}
