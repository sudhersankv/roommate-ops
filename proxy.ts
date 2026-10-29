import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/lib/auth/server"
import { devAuthEmail } from "@/lib/auth/dev"

// Neon Auth's middleware does two jobs:
//  1. After Google, the browser lands on `<callbackURL>?neon_auth_session_verifier=…`; only the middleware exchanges
//     that verifier for the session cookie. Without it the page renders signed out and sign-in loops forever.
//  2. Signed-out visitors to a Group's dashboard are sent to the sign-in screen (loginUrl "/").
// `/` is the loginUrl, so it is always allowed and still gets the exchange. `/claim/*` must stay reachable signed out
// (it shows the Google button), and the SDK's middleware can't be told to skip it, so /claim only goes through the
// middleware when it is carrying a verifier. /api/auth and static assets are never matched.
const neonAuth = auth.middleware({ loginUrl: "/" })
const VERIFIER_PARAM = "neon_auth_session_verifier"

export default async function proxy(request: NextRequest) {
  if (devAuthEmail()) return NextResponse.next()
  const { pathname, searchParams } = request.nextUrl
  if (pathname.startsWith("/claim/") && !searchParams.has(VERIFIER_PARAM)) return NextResponse.next()
  const res = await neonAuth(request)
  if (searchParams.has(VERIFIER_PARAM)) {
    // One line per OAuth return so a failed exchange is visible in the server logs.
    const cookie = request.headers.get("cookie") ?? ""
    console.log(
      `[auth] oauth return ${pathname}: challenge_cookie=${/session_challen?ge=/.test(cookie)} -> ${res.status} ${res.headers.get("location") ?? ""} set_cookie=${res.headers.has("set-cookie")}`,
    )
  }
  return res
}

export const config = {
  matcher: ["/", "/g/:path*", "/claim/:path*"],
}
