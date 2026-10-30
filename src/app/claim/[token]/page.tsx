import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { LinkIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { GoogleButton, SignInFailed, SignInScreen } from "@/components/app/sign-in"
import { APP_PATH, authErrorFrom, signInPath } from "@/lib/auth/oauth-paths"
import { sessionUser } from "@/lib/session"
import { claims } from "@/services"

export const metadata: Metadata = { title: "Connect your Account" }
export const dynamic = "force-dynamic"

/**
 * A Claim link (ADR 0003). Signed out: sign in with Google and come back here. Signed in: the token is used up,
 * the Account is linked to the Member, and you land on the Group's dashboard.
 */
export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await params
  const user = await sessionUser()
  const peek = await claims.peekClaim(token)

  if (!user) {
    // Back from Google without a session (lib/auth/oauth-return.ts says why): say so instead of silently re-asking.
    const failed = authErrorFrom(await searchParams)
    if (failed) console.warn(`[auth] claim page signed out after Google: ${failed}`)
    if (peek.state === "used") {
      // Usually the same person on a second device: the link already connected their Account, so signing in is enough
      // (consumeClaim lets the same Account through; a different Account is told the link was someone else's).
      return (
        <SignInScreen title="This link was already used.">
          {failed && <SignInFailed reason={failed} />}
          <p className="type-body text-center">If that was you on another device, just sign in with the same Google account and your group is right there.</p>
          <GoogleButton returnTo={`/claim/${token}`} />
          <p className="type-caption text-center text-muted-foreground">Not you? In the group chat, say “roomie, send me the dashboard” for your own link.</p>
        </SignInScreen>
      )
    }
    if (peek.state !== "ok") return <Problem message={claims.CLAIM_PROBLEMS[peek.state]} />
    return (
      <SignInScreen title={`Hi ${peek.memberName}. Sign in to see your group.`}>
        {failed && <SignInFailed reason={failed} />}
        <GoogleButton returnTo={`/claim/${token}`} />
        <p className="type-caption text-center text-muted-foreground">This link is just for you, works once, and expires 24 hours after Roomie sent it.</p>
      </SignInScreen>
    )
  }

  let groupId: string
  try {
    groupId = (await claims.consumeClaim(token, user)).groupId
  } catch (e) {
    if (e instanceof claims.ClaimError) return <Problem message={e.message} signedInAs={user.email} />
    throw e
  }
  redirect(`/g/${groupId}`)
}

function Problem({ message, signedInAs }: { message: string; signedInAs?: string }) {
  return (
    <SignInScreen title="That link didn't work." signedInAs={signedInAs}>
      <Empty className="rounded-3xl bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LinkIcon />
          </EmptyMedia>
          <EmptyTitle>Can&apos;t connect with this link</EmptyTitle>
          <EmptyDescription>{message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button nativeButton={false} render={<Link href={signInPath(APP_PATH)} />}>
            Already connected? Sign in
          </Button>
          <Button variant="secondary" nativeButton={false} render={<Link href="/help" />}>
            How links work
          </Button>
        </EmptyContent>
      </Empty>
    </SignInScreen>
  )
}
