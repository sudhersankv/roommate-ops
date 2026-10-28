import type { Metadata } from "next"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { MessageCircleIcon } from "lucide-react"

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { GoogleButton, SignInScreen } from "@/components/app/sign-in"
import { currentAccount } from "@/lib/session"
import { groups } from "@/services"

export const metadata: Metadata = { title: "Sign in" }
export const dynamic = "force-dynamic"

export default async function Home() {
  const account = await currentAccount()
  if (!account) {
    return (
      <SignInScreen title="See what your group owes, needs and has to do.">
        <GoogleButton />
        <p className="type-caption text-center text-muted-foreground">Roomie sent you here from WhatsApp.</p>
      </SignInScreen>
    )
  }

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
          <EmptyTitle>Add Roomie to a WhatsApp group</EmptyTitle>
          <EmptyDescription>Then ask it for the dashboard (“roomie send me the dashboard”). It sends you a private link that connects you to that group.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </SignInScreen>
  )
}
