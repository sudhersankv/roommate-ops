import type { Metadata } from "next"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { MessageCircleIcon } from "lucide-react"

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ClaimLinkForm } from "@/components/app/claim-link-form"
import { SignInScreen } from "@/components/app/sign-in"
import { AUTH_ERROR_PARAM, SIGNIN_PATH, authErrorFrom, withParam } from "@/lib/auth/oauth-paths"
import { currentAccount } from "@/lib/session"
import { appUrl, isAbsoluteUrl } from "@/lib/urls"
import { groups } from "@/services"
import { Landing } from "./_landing/landing"

const TITLE = "Roomie — the AI groupmate for your group chat"
const DESCRIPTION = "Roomie is a pet dino that lives in your Telegram or WhatsApp group. It splits costs, keeps the shared Cart, tracks chores and gives every group its own dashboard."

export function generateMetadata(): Metadata {
  const base = appUrl()
  return {
    title: { absolute: TITLE },
    description: DESCRIPTION,
    ...(isAbsoluteUrl(base) ? { metadataBase: new URL(base) } : {}),
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      siteName: "Roomie",
      title: TITLE,
      description: DESCRIPTION,
      url: "/",
      images: [{ url: "/landing/og.png", width: 1200, height: 630, alt: "Roomie, the dino groupmate, in its doorway." }],
    },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/landing/og.png"] },
  }
}

// Reads the session: signed out it's the landing page, signed in it's your Group.
export const dynamic = "force-dynamic"

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await currentAccount()
  if (!account) {
    // A Google sign-in that came back here without a session: /signin explains it.
    const failed = authErrorFrom(await searchParams)
    if (failed) redirect(withParam(SIGNIN_PATH, AUTH_ERROR_PARAM, failed))
    return <Landing />
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
          <EmptyTitle>Add Roomie to your group chat</EmptyTitle>
          <EmptyDescription>Then ask it for the dashboard (“roomie send me the dashboard”). It sends you a private link that connects you to that group.</EmptyDescription>
        </EmptyHeader>
      </Empty>
      <ClaimLinkForm />
    </SignInScreen>
  )
}
