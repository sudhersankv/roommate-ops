import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/lib/auth/server"
import { devAuthEmail } from "@/lib/auth/dev"
import { CALLBACK_PATH, VERIFIER_PARAM, withoutParam } from "@/lib/auth/oauth-paths"

// The only middleware file: the app lives under src/, so Next loads src/proxy.ts and ignores a root proxy.ts.
//  1. Signed-out visitors to a Group's dashboard or an operator page (/admin/*) are sent to the sign-in screen
//     (loginUrl "/"). Whether a signed-in user may see /admin is up to the page (lib/operator.ts: 404 otherwise).
//  2. Google sign-in returns to /auth/callback, which exchanges the session verifier (lib/auth/oauth-return.ts). A
//     return that lands on a page instead (a sign-in started before /auth/callback existed, or any other
//     callbackURL) is bounced there too. The SDK's middleware can't do it for `/` (it never exchanges on its own
//     loginUrl) and must not run on /claim (signed-out visitors need the Google button), so it only guards /g and /admin.
// /api/auth, /auth/callback and static assets are never matched.
const neonAuth = auth.middleware({ loginUrl: "/" })

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
  if (pathname === "/" || pathname.startsWith("/claim/")) {
    const pass = NextResponse.next()
    pass.headers.set("x-roomie-proxy", "pass")
    return pass
  }
  const res = await neonAuth(request)
  res.headers.set("x-roomie-proxy", "guard")
  return res
}

export const config = {
  matcher: ["/", "/g/:path*", "/admin/:path*", "/claim/:path*"],
}
