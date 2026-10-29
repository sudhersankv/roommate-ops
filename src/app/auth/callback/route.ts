// Google sign-in lands here (lib/auth/oauth-return.ts): exchange the verifier for the session, then go to `next`.
import { completeOAuthReturn } from "@/lib/auth/oauth-return"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return completeOAuthReturn(request)
}
