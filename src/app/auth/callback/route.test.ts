// The Google sign-in return, end to end through the real route handler and Neon Auth SDK, against a fake Neon Auth
// server that only knows one verifier+challenge pair. Run: npx tsx --test src/app/auth/callback/route.test.ts
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

const CHALLENGE = "__Secure-neon-auth.session_challenge"
const SESSION = "__Secure-neon-auth.session_token"
const now = new Date().toISOString()
const later = new Date(Date.now() + 7 * 864e5).toISOString()
const sessionBody = {
  session: { id: "s1", token: "tok-1", userId: "u1", expiresAt: later, createdAt: now, updatedAt: now },
  user: { id: "u1", email: "sam@example.com", name: "Sam", emailVerified: true, createdAt: now, updatedAt: now },
}
const seen: { path: string; origin?: string; cookie?: string }[] = []

let upstream: Server
let GET: (req: Request) => Promise<Response>
let proxy: (req: import("next/server").NextRequest) => Promise<Response>
let NextRequest: typeof import("next/server").NextRequest

before(async () => {
  upstream = createServer((req, res) => {
    const url = new URL(req.url!, "http://upstream")
    seen.push({ path: `${url.pathname}${url.search}`, origin: req.headers.origin, cookie: req.headers.cookie })
    const cookie = req.headers.cookie ?? ""
    if (url.pathname !== "/neondb/auth/get-session") return void res.writeHead(404).end()
    // Verifier exchange: the right verifier plus the challenge cookie gets the session cookie (as Neon sets it).
    if (url.searchParams.get("neon_auth_session_verifier") === "good" && /session_chall[ae]nge=ch-1/.test(cookie)) {
      res.setHeader("set-cookie", `${SESSION}=tok-1.sig; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=None; Partitioned`)
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(sessionBody))
    }
    // The SDK then reads the session with the new token to mint session_data.
    if (!url.searchParams.has("neon_auth_session_verifier") && cookie.includes(`${SESSION}=tok-1.sig`)) {
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(sessionBody))
    }
    res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "Verification not found", code: "VERIFICATION_NOT_FOUND" }))
  })
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r))
  const { port } = upstream.address() as AddressInfo
  process.env.NEON_AUTH_BASE_URL = `http://127.0.0.1:${port}/neondb/auth`
  process.env.NEON_AUTH_COOKIE_SECRET = "test-cookie-secret-test-cookie-secret-0123"
  process.env.APP_URL = "https://roomie.example"
  delete process.env.DEV_AUTH_EMAIL
  ;({ GET } = await import("./route"))
  ;({ default: proxy } = await import("../../../proxy"))
  ;({ NextRequest } = await import("next/server"))
})
after(() => upstream.close())

// Behind Fly, request.url is https://localhost:3000/…; the handler must not leak that host into redirects.
const back = (query: string, cookie = `${CHALLENGE}=ch-1`) =>
  GET(new Request(`https://localhost:3000/auth/callback?${query}`, { headers: { cookie, referer: "https://accounts.google.com/" } }))

test("a good verifier + challenge cookie: session cookies set, on to `next`", async () => {
  seen.length = 0
  const res = await back("next=%2Fclaim%2Fabc&neon_auth_session_verifier=good")
  assert.equal(res.status, 303)
  assert.equal(res.headers.get("location"), "/claim/abc")
  assert.equal(res.headers.get("x-roomie-auth"), "ok")
  const cookies = res.headers.getSetCookie()
  const session = cookies.find((c) => c.startsWith(`${SESSION}=tok-1.sig`))
  assert.ok(session, `no session cookie in ${cookies.join(" | ")}`)
  assert.match(session, /SameSite=Lax/i)
  assert.match(session, /Secure/i)
  assert.doesNotMatch(session, /Partitioned/i)
  assert.ok(cookies.some((c) => c.startsWith("__Secure-neon-auth.local.session_data=ey")), "session_data minted")
  assert.ok(cookies.some((c) => c.startsWith(`${CHALLENGE}=;`) && /Max-Age=0/.test(c)), "challenge cleared")
  // The exchange sent our own origin (a trusted domain), not Google's referer or localhost, and only the challenge.
  const exchange = seen.find((s) => s.path.includes("neon_auth_session_verifier=good"))!
  assert.equal(exchange.origin, "https://roomie.example")
  assert.equal(exchange.cookie, `${CHALLENGE}=ch-1`)
})

test("the legacy challenge cookie spelling works too", async () => {
  const res = await back("next=%2F&neon_auth_session_verifier=good", "__Secure-neon-auth.session_challange=ch-1")
  assert.equal(res.headers.get("x-roomie-auth"), "ok")
})

test("a verifier Neon Auth doesn't know: back to `next` with the reason, no session", async () => {
  const res = await back("next=%2Fclaim%2Fabc&neon_auth_session_verifier=stale")
  assert.equal(res.status, 303)
  assert.equal(res.headers.get("location"), "/claim/abc?auth_error=VERIFICATION_NOT_FOUND")
  assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION}=`)))
})

test("the challenge cookie didn't come back (SameSite / other browser): says so", async () => {
  const res = await back("next=%2Fclaim%2Fabc&neon_auth_session_verifier=good", "other=1")
  assert.equal(res.headers.get("location"), "/claim/abc?auth_error=missing_challenge")
})

test("Neon Auth reported an error (errorCallbackURL): passed through", async () => {
  const res = await back("next=%2Fclaim%2Fabc&error=invalid_code")
  assert.equal(res.headers.get("location"), "/claim/abc?auth_error=invalid_code")
})

test("`next` can't leave the site", async () => {
  for (const next of ["https://evil.example/x", "//evil.example/x", "/\\evil.example", ""]) {
    const res = await back(`next=${encodeURIComponent(next)}&neon_auth_session_verifier=good`)
    assert.equal(res.headers.get("location"), "/signin", next)
  }
})

test("a failed sign-in without a `next` lands on /signin with the reason (not the landing page)", async () => {
  const res = await back("neon_auth_session_verifier=stale")
  assert.equal(res.headers.get("location"), "/signin?auth_error=VERIFICATION_NOT_FOUND")
})

test("proxy: a verifier that lands on a page is sent to /auth/callback with the page as `next`", async () => {
  const res = await proxy(new NextRequest("https://roomie.example/claim/abc?x=1&neon_auth_session_verifier=good"))
  assert.equal(res.status, 307)
  const to = new URL(res.headers.get("location")!)
  assert.equal(to.pathname, "/auth/callback")
  assert.equal(to.searchParams.get("next"), "/claim/abc?x=1")
  assert.equal(to.searchParams.get("neon_auth_session_verifier"), "good")
})

test("proxy: /claim, /signin, / and /admin/* pass signed out (admin pages 404 themselves); /g/* goes to /signin with `next`", async () => {
  for (const path of ["/claim/abc", "/", "/signin", "/signin?next=%2Fg%2Fx", "/admin/beta", "/admin/whatsapp"]) {
    const res = await proxy(new NextRequest(`https://roomie.example${path}`))
    assert.equal(res.headers.get("x-roomie-proxy"), "pass", path)
  }
  const g = await proxy(new NextRequest("https://roomie.example/g/00000000-0000-0000-0000-000000000000/money?tab=expenses"))
  assert.equal(g.status, 307)
  assert.equal(g.headers.get("x-roomie-proxy"), "guard")
  const to = new URL(g.headers.get("location")!)
  assert.equal(to.pathname, "/signin")
  assert.equal(to.searchParams.get("next"), "/g/00000000-0000-0000-0000-000000000000/money?tab=expenses")
  assert.equal([...to.searchParams.keys()].join(","), "next", "the page's own query stays inside `next`")
})

test("proxy: a verifier that lands on /signin is exchanged too", async () => {
  const res = await proxy(new NextRequest("https://roomie.example/signin?next=%2Fg%2Fx&neon_auth_session_verifier=good"))
  const to = new URL(res.headers.get("location")!)
  assert.equal(to.pathname, "/auth/callback")
  assert.equal(to.searchParams.get("next"), "/signin?next=%2Fg%2Fx")
})
