import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/lib/auth/server"
import { devAuthEmail } from "@/lib/auth/dev"
import { CALLBACK_PATH, SIGNIN_PATH, VERIFIER_PARAM, signInPath, withoutParam } from "@/lib/auth/oauth-paths"

// The only middleware file: the app lives under src/, so Next loads src/proxy.ts and ignores a root proxy.ts.
//  1. Signed-out visitors to a Group's dashboard are sent to the sign-in screen (/signin?next=<where they were
//     going>). Operator pages (/admin/*) are not guarded here: the page answers 404 to anyone who isn't a signed-in
//     operator (lib/operator.ts), signed out included, so they don't reveal they exist. Operators sign in at
//     /signin?next=/admin/…. `/` is the public landing page for everyone (signed in too) and is never guarded; /app
//     is where a signed-in person lands (their Group, or "no groups yet") and redirects to /signin on its own.
//  2. Google sign-in returns to /auth/callback, which exchanges the session verifier (lib/auth/oauth-return.ts). A
//     return that lands on a page instead (a sign-in started before /auth/callback existed, or any other
//     callbackURL) is bounced there too. The SDK's middleware can't do it for /signin (it never exchanges on its own
//     loginUrl) and must not run on /, /claim, /j (Join links: the page sends signed-out visitors to /signin itself) or
//     /admin (signed-out visitors see those), so it only guards /g.
// /api/auth, /auth/callback and static assets are never matched.
const neonAuth = auth.middleware({ loginUrl: SIGNIN_PATH })

export default async function proxy(request: NextRequest) {
  if (devAuthEmail()) return NextResponse.next()
  const { pathname, search, searchParams } = request.nextUrl
  const verifier = searchParams.get(VERIFIER_PARAM)
  if (verifier) {
    const to = new URL(CALLBACK_PATH, request.url)
    to.searchParams.set("next", withoutParam(`${pathname}${search}`, VERIFIER_PARAM))
    to.searchParams.set(VERIFIER_PARAM, verifier)
    const res = NextResponse.redirect(to)
    res.headers.set("x-roomie-proxy", "oauth-return")
    return res
  }
  if (pathname === SIGNIN_PATH || pathname.startsWith("/claim/") || pathname.startsWith("/j/") || /^\/admin(\/|$)/.test(pathname)) {
    const pass = NextResponse.next()
    pass.headers.set("x-roomie-proxy", "pass")
    return pass
  }
  // The SDK refreshes or clears session cookies here, where cookie writes are allowed (a page render can't; see
  // lib/session.ts). It also redirects signed-out visitors to the bare loginUrl.
  const res = await neonAuth(request)
  const location = res.headers.get("location")
  const toLogin = !!location && new URL(location, request.url).pathname === SIGNIN_PATH
  if (toLogin && pathname === "/") {
    // The landing page is for everyone: keep the SDK's cookie changes, drop its redirect.
    const pass = NextResponse.next()
    res.headers.getSetCookie().forEach((c) => pass.headers.append("set-cookie", c))
    pass.headers.set("x-roomie-proxy", "pass")
    return pass
  }
  // Remember where you were going so /signin can take you back.
  if (toLogin) res.headers.set("location", new URL(signInPath(`${pathname}${search}`), request.url).toString())
  res.headers.set("x-roomie-proxy", "guard")
  return res
}

export const config = {
  matcher: ["/", "/app", "/signin", "/g/:path*", "/admin/:path*", "/claim/:path*", "/j/:path*"],
}
