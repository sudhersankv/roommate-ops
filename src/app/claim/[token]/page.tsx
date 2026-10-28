import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { LinkIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { GoogleButton, SignInScreen } from "@/components/app/sign-in"
import { sessionUser } from "@/lib/session"
import { claims } from "@/services"

export const metadata: Metadata = { title: "Connect your Account" }
export const dynamic = "force-dynamic"

/**
 * A Claim link (ADR 0003). Signed out: sign in with Google and come back here. Signed in: the token is used up,
 * the Account is linked to the Member, and you land on the Group's dashboard.
 */
export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await sessionUser()
  const peek = await claims.peekClaim(token)

  if (!user) {
    if (peek.state !== "ok") return <Problem message={claims.CLAIM_PROBLEMS[peek.state]} />
    return (
      <SignInScreen title={`Hi ${peek.memberName}. Sign in to see your group.`}>
        <GoogleButton returnTo={`/claim/${token}`} />
        <p className="type-caption text-center text-muted-foreground">This link is just for you, works once, and expires 24 hours after Roomie sent it.</p>
      </SignInScreen>
    )
  }

  let groupId: string
  try {
    groupId = (await claims.consumeClaim(token, user)).groupId
  } catch (e) {
    if (e instanceof claims.ClaimError) return <Problem message={e.message} />
    throw e
  }
  redirect(`/g/${groupId}`)
}

function Problem({ message }: { message: string }) {
  return (
    <SignInScreen title="That link didn't work.">
      <Empty className="rounded-3xl bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LinkIcon />
          </EmptyMedia>
          <EmptyTitle>Can&apos;t connect with this link</EmptyTitle>
          <EmptyDescription>{message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="secondary" nativeButton={false} render={<Link href="/" />}>
            Go to Roomie
          </Button>
        </EmptyContent>
      </Empty>
    </SignInScreen>
  )
}
