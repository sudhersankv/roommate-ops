import type { Metadata } from "next"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { MessageCircleIcon } from "lucide-react"

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ClaimLinkForm } from "@/components/app/claim-link-form"
import { SignInScreen } from "@/components/app/sign-in"
import { APP_PATH, signInPath } from "@/lib/auth/oauth-paths"
import { currentAccount } from "@/lib/session"
import { groups } from "@/services"

export const metadata: Metadata = { title: "Your groups", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

/** Where a signed-in person lands: the Group they were last in (or their first), else "no groups yet" + paste a Claim link. */
export default async function AppHome() {
  const account = await currentAccount()
  if (!account) redirect(signInPath(APP_PATH))

  const mine = await groups.groupsForAccount(account.id)
  const last = (await cookies()).get("roomie-group")?.value
  const target = mine.find((g) => g.id === last) ?? mine[0]
  if (target) redirect(`/g/${target.id}`)

  return (
    <SignInScreen title={`Hi ${account.name?.split(" ")[0] ?? "there"}. No groups yet.`}>
      <Empty className="rounded-3xl bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleIcon />
          </EmptyMedia>
          <EmptyTitle>Add Roomie to your group chat</EmptyTitle>
          <EmptyDescription>Then ask it for the dashboard (“roomie send me the dashboard”). It sends you a private link that connects you to that group.</EmptyDescription>
        </EmptyHeader>
      </Empty>
      <ClaimLinkForm />
    </SignInScreen>
  )
}
