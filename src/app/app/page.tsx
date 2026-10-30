import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ChevronRightIcon, MessageCircleIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { ClaimLinkForm } from "@/components/app/claim-link-form"
import { SignInScreen } from "@/components/app/sign-in"
import { APP_PATH, NOT_CONNECTED_PARAM, signInPath } from "@/lib/auth/oauth-paths"
import { currentAccount } from "@/lib/session"
import { joins } from "@/services"

export const metadata: Metadata = { title: "Your groups", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", telegram: "Telegram", dev: "Dev chat" }

/**
 * Where a signed-in person lands (stateless sign-in, ADR 0014): one Group goes straight to it; two or more are listed
 * (name, chat app, the seat you have there); none is "no groups yet" + paste a Claim link. With `?not_connected=1`
 * (they opened a dashboard their Account isn't in) it explains how to get in instead.
 */
export default async function AppHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await currentAccount()
  if (!account) redirect(signInPath(APP_PATH))

  const notConnected = (await searchParams)[NOT_CONNECTED_PARAM] === "1"
  const mine = await joins.groupsListFor(account.id)
  if (mine.length === 1 && !notConnected) redirect(`/g/${mine[0].id}`)

  const first = account.name?.split(" ")[0] ?? "there"
  const title = notConnected ? `Hi ${first}. That dashboard isn't yours yet.` : mine.length ? `Hi ${first}. Pick a group.` : `Hi ${first}. No groups yet.`
  return (
    <SignInScreen title={title} signedInAs={account.email}>
      {notConnected && (
        <Alert>
          <AlertTitle>Get in with your group&apos;s Join link</AlertTitle>
          <AlertDescription>
            Open the Join link Roomie posted in your group chat, then pick your name. No link handy? Say <strong>“roomie, send us the dashboard”</strong> in the chat.
          </AlertDescription>
        </Alert>
      )}
      {mine.length ? (
        <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
          {mine.map((g) => (
            <Item key={g.id} render={<Link href={`/g/${g.id}`} />} className="py-3">
              <ItemContent className="min-w-0">
                <ItemTitle className="min-w-0">
                  <span className="truncate">{g.name}</span>
                  {g.status === "pending" ? <Badge variant="outline">Pending</Badge> : null}
                </ItemTitle>
                <ItemDescription>
                  {g.channel ? `${CHANNEL[g.channel] ?? g.channel}, ` : ""}you&apos;re {g.seatName}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <ChevronRightIcon aria-hidden="true" />
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <Empty className="rounded-3xl bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageCircleIcon />
            </EmptyMedia>
            <EmptyTitle>Add Roomie to your group chat</EmptyTitle>
            <EmptyDescription>Already in one? Open the Join link Roomie posted there and pick your name, or ask “roomie, send me the dashboard” for a private link.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {mine.length ? null : <ClaimLinkForm />}
    </SignInScreen>
  )
}
