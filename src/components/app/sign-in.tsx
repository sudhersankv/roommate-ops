"use client"

import { useState, type ReactNode } from "react"
import { TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { authClient } from "@/lib/auth/client"
import { callbackPathFor } from "@/lib/auth/oauth-paths"

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden data-icon="inline-start">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.8Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3.01c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54V6.62H1.27a12 12 0 0 0 0 10.76l4-3.11Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.43-3.43A11.97 11.97 0 0 0 1.27 6.62l4 3.11C6.22 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  )
}

/** "Continue with Google" through Neon Auth; comes back via /auth/callback to `returnTo` (a path on this site). */
export function GoogleButton({ returnTo = "/" }: { returnTo?: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="lg"
      variant="outline"
      className="w-full"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        const callbackURL = `${window.location.origin}${callbackPathFor(returnTo)}`
        const { error } = await authClient.signIn.social({ provider: "google", callbackURL })
        if (error) {
          setBusy(false)
          toast.add({ title: "Couldn't start Google sign-in", description: error.message ?? "Try again in a moment.", type: "error" })
        }
      }}
    >
      {busy ? <Spinner data-icon="inline-start" /> : <GoogleMark />}
      Continue with Google
    </Button>
  )
}

/** Shown above the Google button when the last Google sign-in came back without a session (`?auth_error=`). */
export function SignInFailed({ reason }: { reason: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Sign-in didn&apos;t complete. Try again.</AlertTitle>
      <AlertDescription>
        Google sent you back, but Roomie didn&apos;t get a session. If it keeps happening, send a screenshot of this (code: {reason}).
      </AlertDescription>
    </Alert>
  )
}

/** The sign-in screen: the Roomie lockup, a line, and whatever actions go at the bottom. */
export function SignInScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-between px-6 pt-[18dvh] pb-10">
      <div className="flex flex-col gap-8">
        {/* The lockup ships in two colorways; show the one that matches the theme. */}
        <h1 className="m-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/roomie-logo-on-light.svg" alt="Roomie" width={419} height={128} className="h-auto w-64 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/roomie-logo-on-dark.svg" alt="Roomie" width={419} height={128} className="hidden h-auto w-64 dark:block" />
        </h1>
        <p className="type-title max-w-[18ch] text-pretty">{title}</p>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </main>
  )
}
