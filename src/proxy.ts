import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/lib/auth/server"
import { devAuthEmail } from "@/lib/auth/dev"

// Signed-out visitors to a Group's dashboard go to the sign-in screen. /claim handles its own sign-in (it has to be
// reachable signed out to show the button), and /api/auth and static assets are never matched.
const neonAuth = auth.middleware({ loginUrl: "/" })

export default function proxy(request: NextRequest) {
  if (devAuthEmail()) return NextResponse.next()
  return neonAuth(request)
}

export const config = {
  matcher: ["/g/:path*"],
}
