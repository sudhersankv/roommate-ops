import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ClaimLinkForm } from "@/components/app/claim-link-form"
import { GoogleButton, SignInFailed, SignInScreen } from "@/components/app/sign-in"
import { afterSignIn, authErrorFrom, signInPath } from "@/lib/auth/oauth-paths"
import { currentAccount } from "@/lib/session"

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

/**
 * The sign-in screen: Google, or paste a Claim link. `?next=` is where to go afterwards (the proxy sets it when a
 * signed-out visitor opens a dashboard); Google comes back here through /auth/callback, so a failed sign-in shows
 * its reason (`?auth_error=`) and a good one continues to `next`.
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const raw = Array.isArray(params.next) ? params.next[0] : params.next
  const next = afterSignIn(raw ?? "/")
  if (await currentAccount()) redirect(next)

  const failed = authErrorFrom(params)
  if (failed) console.warn(`[auth] signin page signed out after Google: ${failed}`)
  return (
    <SignInScreen title="See what your group owes, needs and has to do.">
      {failed && <SignInFailed reason={failed} />}
      <GoogleButton returnTo={signInPath(next)} />
      <p className="type-caption text-center text-muted-foreground">Roomie sent you here from your group chat.</p>
      <ClaimLinkForm />
      <p className="type-caption text-center text-muted-foreground">
        New here?{" "}
        <Link href="/" className="underline decoration-primary decoration-2 underline-offset-4 hover:decoration-foreground">
          See what Roomie does
        </Link>
      </p>
    </SignInScreen>
  )
}
