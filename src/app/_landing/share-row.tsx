"use client"

import { useState } from "react"
import { CheckIcon, LinkIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/** Copy the page's link. The Telegram and WhatsApp share links sit next to it as plain anchors. */
export function CopyLink({ url, size }: { url: string; size?: "sm" }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt("Copy this link", url)
    }
  }
  return (
    <Button variant="outline" size={size} onClick={copy}>
      {copied ? <CheckIcon data-icon="inline-start" aria-hidden /> : <LinkIcon data-icon="inline-start" aria-hidden />}
      <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
    </Button>
  )
}
