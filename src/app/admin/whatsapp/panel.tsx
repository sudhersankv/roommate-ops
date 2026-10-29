"use client"

import { useCallback, useEffect, useState } from "react"
import { TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import type { WhatsAppStatus } from "@/channels/whatsapp"

type Status = WhatsAppStatus & { enabled: boolean }

const API = "/api/admin/whatsapp"

const LABEL: Record<WhatsAppStatus["state"], string> = {
  disconnected: "Not connected",
  connecting: "Connecting",
  qr: "Waiting for a scan",
  pairing: "Waiting for the code",
  open: "Connected",
  logged_out: "Logged out",
}

/** Status, QR (refreshed every 5 s while waiting), pairing-code form, the linked number, Log out. */
export function WhatsAppPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [phone, setPhone] = useState("")
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(API, { cache: "no-store" })
    if (res.ok) setStatus(await res.json())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const waiting = status?.state === "qr" || status?.state === "pairing" || status?.state === "connecting"
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => void load(), 5_000)
    return () => clearInterval(t)
  }, [waiting, load])

  async function act(action: string, extra: Record<string, string> = {}) {
    setBusy(action)
    setError(null)
    try {
      const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) })
      const body = (await res.json().catch(() => null)) as (Status & { error?: string }) | null
      if (body?.state) setStatus(body)
      if (!res.ok) setError(body?.error ?? "That didn't work. Try again.")
    } finally {
      setBusy(null)
    }
  }

  if (!status) return <Spinner />

  const s = status
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {LABEL[s.state]}
            <Badge variant={s.state === "open" ? "owed" : s.state === "logged_out" ? "destructive" : "secondary"}>{s.state}</Badge>
          </CardTitle>
          <CardDescription>
            {s.state === "open" && s.me ? `Linked to ${s.me.name ? `${s.me.name}, ` : ""}+${s.me.jid.split("@")[0]}` : `Since ${new Date(s.since).toLocaleTimeString()}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {s.error && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Heads up</AlertTitle>
              <AlertDescription>{s.error}</AlertDescription>
            </Alert>
          )}

          {s.state === "qr" && s.qr && (
            <div className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.qr} alt="WhatsApp login QR code" width={264} height={264} className="rounded-xl bg-white p-2" />
              <p className="type-caption text-center text-muted-foreground">
                On Roomie&apos;s phone: WhatsApp → Settings → Linked devices → Link a device, then scan. It refreshes by itself.
              </p>
            </div>
          )}

          {s.state === "pairing" && s.pairingCode && (
            <div className="flex flex-col items-center gap-2">
              <p className="font-mono text-3xl tracking-[0.3em]">{s.pairingCode.replace(/(.{4})(?=.)/, "$1-")}</p>
              <p className="type-caption text-center text-muted-foreground">
                On Roomie&apos;s phone: WhatsApp → Linked devices → Link a device → Link with phone number instead, then type this code.
              </p>
            </div>
          )}

          {s.enabled && s.state !== "open" && s.state !== "connecting" && (
            <Button onClick={() => act("start")} disabled={!!busy}>
              {busy === "start" && <Spinner data-icon="inline-start" />}
              {s.state === "qr" || s.state === "pairing" ? "Restart login" : "Start (show a QR)"}
            </Button>
          )}
        </CardContent>
      </Card>

      {s.enabled && s.state !== "open" && (
        <Card>
          <CardHeader>
            <CardTitle>Or link with a code</CardTitle>
            <CardDescription>Roomie&apos;s number with its country code, digits only.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void act("request-pairing-code", { phone })
              }}
            >
              <Input inputMode="tel" autoComplete="off" placeholder="15551234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <Button type="submit" variant="secondary" disabled={!!busy || phone.replace(/\D/g, "").length < 8}>
                {busy === "request-pairing-code" && <Spinner data-icon="inline-start" />}
                Get code
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {s.enabled && (s.state === "open" || s.state === "qr" || s.state === "pairing" || s.state === "connecting") && (
        <Button
          variant="destructive"
          disabled={!!busy}
          onClick={() => {
            if (window.confirm("Log Roomie's number out? Roomie goes quiet in every WhatsApp group until someone links it again.")) void act("logout")
          }}
        >
          {busy === "logout" && <Spinner data-icon="inline-start" />}
          Log out
        </Button>
      )}

      {error && <p className="type-caption text-destructive">{error}</p>}
    </div>
  )
}
