"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/** The token from a pasted Claim link (`…/claim/<token>`, with or without the host) or a bare token. */
export function claimTokenFrom(text: string): string | null {
  const s = text.trim()
  const m = s.match(/\/claim\/([A-Za-z0-9_-]{20,})/) ?? s.match(/^([A-Za-z0-9_-]{20,})$/)
  return m ? m[1] : null
}

/** "Have a claim link from Roomie? Paste it here": for when the link in the chat got mangled or opened elsewhere. */
export function ClaimLinkForm() {
  const router = useRouter()
  const [value, setValue] = useState("")
  const [invalid, setInvalid] = useState(false)
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const token = claimTokenFrom(value)
        setInvalid(!token)
        if (token) router.push(`/claim/${token}`)
      }}
    >
      <label htmlFor="claim-link" className="type-caption text-muted-foreground">
        Have a claim link from Roomie? Paste it here.
      </label>
      <div className="flex gap-2">
        <Input
          id="claim-link"
          inputMode="url"
          autoComplete="off"
          placeholder="https://roomie.fly.dev/claim/…"
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            setValue(e.target.value)
            setInvalid(false)
          }}
        />
        <Button type="submit" variant="secondary" size="lg" disabled={!value.trim()}>
          Open
        </Button>
      </div>
      {invalid && <p className="type-caption text-destructive">That doesn&apos;t look like a Roomie claim link.</p>}
    </form>
  )
}
