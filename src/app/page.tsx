import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AUTH_ERROR_PARAM, SIGNIN_PATH, authErrorFrom, withParam } from "@/lib/auth/oauth-paths"
import { currentAccount } from "@/lib/session"
import { appUrl, isAbsoluteUrl } from "@/lib/urls"
import { trickVoteCounts } from "@/services/trick-votes"
import { Landing } from "./_landing/landing"

const TITLE = "Roomie — your group chat finally has a brain"
const DESCRIPTION =
  "Roomie is an AI that joins your Telegram or WhatsApp group chat and learns Tricks: splitting costs and receipts, the shared grocery Cart, chores. Every group gets its own dashboard."

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
      images: [{ url: "/landing/og.png", width: 1200, height: 630, alt: "Your group chat finally has a brain. Roomie, the dino, in its doorway." }],
    },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/landing/og.png"] },
  }
}

// The landing page, for everyone. Signed in, the nav offers your dashboard (/app) instead of Sign in.
export const dynamic = "force-dynamic"

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [account, votes] = await Promise.all([currentAccount(), trickVoteCounts()])
  if (!account) {
    // A Google sign-in that came back here without a session: /signin explains it.
    const failed = authErrorFrom(await searchParams)
    if (failed) redirect(withParam(SIGNIN_PATH, AUTH_ERROR_PARAM, failed))
  }
  return <Landing signedIn={!!account} votes={votes} />
}
