import type { Metadata } from "next"
import { cookies } from "next/headers"
import Link from "next/link"
import { redirect } from "next/navigation"
import { MessageCircleIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ClaimLinkForm } from "@/components/app/claim-link-form"
import { SignInScreen } from "@/components/app/sign-in"
import { APP_PATH, NOT_CONNECTED_PARAM, signInPath } from "@/lib/auth/oauth-paths"
import { currentAccount } from "@/lib/session"
import { groups } from "@/services"

export const metadata: Metadata = { title: "Your groups", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

/**
 * Where a signed-in person lands: the Group they were last in (or their first), else "no groups yet" + paste a Claim
 * link. With `?not_connected=1` (they opened someone else's dashboard link) it explains how to get their own instead.
 */
export default async function AppHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await currentAccount()
  if (!account) redirect(signInPath(APP_PATH))

  const notConnected = (await searchParams)[NOT_CONNECTED_PARAM] === "1"
  const mine = await groups.groupsForAccount(account.id)
  const last = (await cookies()).get("roomie-group")?.value
  const target = mine.find((g) => g.id === last) ?? mine[0]
  if (target && !notConnected) redirect(`/g/${target.id}`)

  const first = account.name?.split(" ")[0] ?? "there"
  return (
    <SignInScreen title={notConnected ? `Hi ${first}. That link wasn't yours.` : `Hi ${first}. No groups yet.`} signedInAs={account.email}>
      {notConnected && (
        <Alert>
          <AlertTitle>Dashboard links are personal</AlertTitle>
          <AlertDescription>
            The link you opened belongs to whoever asked for it. In your group chat, say <strong>“roomie, send me the dashboard”</strong> and Roomie will DM you your own link.
          </AlertDescription>
        </Alert>
      )}
      {target ? (
        <p className="type-body text-center">
          <Link href={`/g/${target.id}`} className="underline decoration-primary decoration-2 underline-offset-4 hover:decoration-foreground">
            Open {target.name}
          </Link>
        </p>
      ) : (
        <Empty className="rounded-3xl bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageCircleIcon />
            </EmptyMedia>
            <EmptyTitle>Add Roomie to your group chat</EmptyTitle>
            <EmptyDescription>Then ask it for the dashboard (“roomie, send me the dashboard”). It sends you a private link that connects you to that group.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <ClaimLinkForm />
    </SignInScreen>
  )
}
