import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AUTH_ERROR_PARAM, SIGNIN_PATH, authErrorFrom, withParam } from "@/lib/auth/oauth-paths"
import { currentAccount } from "@/lib/session"
import { appUrl, isAbsoluteUrl } from "@/lib/urls"
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

// The landing page, for everyone. Signed in, the nav offers your dashboard (/app) instead of Sign in.
export const dynamic = "force-dynamic"

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await currentAccount()
  if (!account) {
    // A Google sign-in that came back here without a session: /signin explains it.
    const failed = authErrorFrom(await searchParams)
    if (failed) redirect(withParam(SIGNIN_PATH, AUTH_ERROR_PARAM, failed))
  }
  return <Landing signedIn={!!account} />
}
