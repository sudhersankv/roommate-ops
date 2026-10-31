"use client"

import { useState, useTransition } from "react"
import { ArrowLeftIcon, CopyIcon, FileTextIcon, InboxIcon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { releaseLeaseInbox, removeLandlordSender, replyToLandlord } from "../../actions"
import { useGroup } from "../group-context"
import { PageHeader, TopBar } from "../shell"
import type { InboxTab, InboxThreadView, InboxView } from "../types"

const TABS: { value: InboxTab; label: string }[] = [
  { value: "notices", label: "Notices" },
  { value: "rent", label: "Rent & lease" },
  { value: "work-orders", label: "Work orders" },
  { value: "other", label: "Everything else" },
  { value: "new-senders", label: "New senders" },
]

const STATUS: Record<string, string> = { sent: "Sent", acknowledged: "Seen", scheduled: "Scheduled", done: "Done" }

/** The Inbox page: the Group's landlord mail sorted into tabs, a thread view, and a reply box under the chat's rules. */
export function InboxScreen({ view }: { view: InboxView }) {
  const [tab, setTab] = useState<InboxTab>(TABS.find((t) => view.counts[t.value] > 0)?.value ?? "notices")
  const [open, setOpen] = useState<string | null>(null)
  const thread = view.threads.find((t) => t.threadId === open) ?? null
  const shown = view.threads.filter((t) => t.tab === tab)

  if (thread) return <ThreadScreen thread={thread} onBack={() => setOpen(null)} />

  return (
    <>
      <TopBar title="Inbox" />
      <PageHeader title="Inbox">
        <p className="type-body text-muted-foreground">
          {view.address ? (
            <>
              What the landlord sends to <span className="font-medium text-foreground">{view.address}</span>, sorted.
            </>
          ) : (
            "There's no address here. An admin can teach Roomie Lease Inbox again for a new one."
          )}
        </p>
      </PageHeader>
      <div className="flex flex-col gap-4 px-4 pb-28">
        <div className="-mx-4 overflow-x-auto px-4">
          <ToggleGroup variant="segmented" spacing={1} value={[tab]} onValueChange={(v) => v[0] && setTab(v[0] as InboxTab)} aria-label="Show">
            {TABS.map((t) => (
              <ToggleGroupItem key={t.value} value={t.value}>
                {t.label}
                {view.counts[t.value] ? <span className="text-muted-foreground"> {view.counts[t.value]}</span> : null}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {shown.length === 0 ? (
          <Empty className="rounded-3xl bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing here</EmptyTitle>
              <EmptyDescription>Forward the lease or the landlord&apos;s last email to the address, and Roomie sorts what comes in.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
            {shown.map((t) => (
              <Item key={t.threadId} className="py-3" render={<button type="button" onClick={() => setOpen(t.threadId)} />}>
                <ItemContent className="min-w-0 text-left">
                  <ItemTitle className="flex-wrap">
                    {t.workOrder?.title ?? t.subject}
                    {t.workOrder ? <Badge variant="secondary">{STATUS[t.workOrder.status] ?? t.workOrder.status}</Badge> : null}
                  </ItemTitle>
                  <ItemDescription>
                    {t.from}. {t.summary ?? ""} {t.when}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}
      </div>
    </>
  )
}

function ThreadScreen({ thread, onBack }: { thread: InboxThreadView; onBack: () => void }) {
  const { group } = useGroup()
  const [body, setBody] = useState("")
  const [ask, setAsk] = useState<{ questions: string[]; token: string | null } | null>(null)
  const [pending, start] = useTransition()

  const send = (confirmToken?: string) =>
    start(async () => {
      const res = await replyToLandlord(group.id, { threadId: thread.threadId, body, confirmToken })
      if (!res.ok) return void toast.add({ title: "Couldn't send it", description: res.error, type: "error" })
      if (res.data && !res.data.sent) return void setAsk({ questions: res.data.ask, token: res.data.confirmToken })
      setAsk(null)
      setBody("")
      toast.add({ title: "Sent", description: res.data?.sent ? res.data.line : undefined, type: "success" })
    })

  return (
    <>
      <TopBar title="Inbox" />
      <div className="flex flex-col gap-4 px-4 pt-4 pb-28">
        <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
          <ArrowLeftIcon data-icon="inline-start" />
          Inbox
        </Button>
        <h1 className="type-title text-pretty">{thread.workOrder?.title ?? thread.subject}</h1>
        {thread.workOrder ? (
          <p className="type-body text-muted-foreground">
            Work order: {STATUS[thread.workOrder.status] ?? thread.workOrder.status}
            {thread.workOrder.scheduledFor ? `, ${thread.workOrder.scheduledFor}` : ""}
            {thread.workOrder.reportedBy ? `. Reported by ${thread.workOrder.reportedBy}.` : "."}
          </p>
        ) : null}
        <div className="flex flex-col gap-3">
          {thread.items.map((m) => (
            <article key={m.id} className={m.direction === "out" ? "rounded-3xl bg-muted p-4" : "rounded-3xl bg-card p-4"}>
              <p className="type-caption text-muted-foreground">
                {m.from}, {m.when}
              </p>
              {m.subject ? <p className="type-heading">{m.subject}</p> : null}
              <p className="type-body whitespace-pre-wrap">{m.text}</p>
              {m.documents.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.documents.map((d, i) => (
                    <Button key={d.id} size="sm" variant="secondary" render={<a href={d.href} target="_blank" rel="noreferrer" />}>
                      <FileTextIcon data-icon="inline-start" />
                      Attachment {i + 1}
                    </Button>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
        {thread.canReply ? (
          <Field>
            <FieldLabel htmlFor="reply">Reply</FieldLabel>
            <Textarea id="reply" rows={4} value={body} onChange={(e) => (setBody(e.target.value), setAsk(null))} placeholder="Tuesday morning works for us." />
            <FieldDescription>It goes with your name in the signature. Anything about money, dates you didn&apos;t write or the lease gets a question first.</FieldDescription>
            {ask ? (
              <Alert>
                <AlertTitle>Before it goes</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {ask.questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex gap-2">
              {ask ? (
                <>
                  <Button disabled={pending || !body.trim() || !ask.token} onClick={() => send(ask.token ?? undefined)}>
                    {pending ? <Spinner data-icon="inline-start" /> : null}
                    Send anyway
                  </Button>
                  <Button variant="ghost" onClick={() => setAsk(null)}>
                    Edit
                  </Button>
                </>
              ) : (
                <Button disabled={pending || !body.trim()} onClick={() => send()}>
                  {pending ? <Spinner data-icon="inline-start" /> : null}
                  Send
                </Button>
              )}
            </div>
          </Field>
        ) : (
          <p className="type-body text-muted-foreground">Roomie only replies to the landlord. A new sender needs an admin&apos;s yes first.</p>
        )}
      </div>
    </>
  )
}

/** Settings -> Lease Inbox: the address with Copy; Admins remove trusted senders and can release the address. */
export function LeaseInboxSettingsSection({ address, senders, isAdmin }: { address: string | null; senders: InboxView["senders"]; isAdmin: boolean }) {
  const { group } = useGroup()
  const [pending, start] = useTransition()
  const [confirming, setConfirming] = useState(false)

  const copy = async () => {
    if (!address) return
    await navigator.clipboard.writeText(address).catch(() => {})
    toast.add({ title: "Copied", description: address })
  }
  const remove = (value: string) =>
    start(async () => {
      const res = await removeLandlordSender(group.id, value)
      if (!res.ok) return void toast.add({ title: "Couldn't remove it", description: res.error, type: "error" })
      toast.add({ title: `${value} isn't the landlord any more` })
    })
  const release = () =>
    start(async () => {
      const res = await releaseLeaseInbox(group.id)
      setConfirming(false)
      if (!res.ok) return void toast.add({ title: "Couldn't release it", description: res.error, type: "error" })
      toast.add({ title: "Address released", description: "Mail sent there bounces now. Everything filed stays." })
    })

  return (
    <FieldSet>
      <FieldLegend className="type-heading">Lease Inbox</FieldLegend>
      <FieldDescription>Give this address to the landlord, CC it, or forward their emails to it.</FieldDescription>
      {address ? (
        <Item variant="outline" className="rounded-2xl">
          <ItemContent className="min-w-0">
            <ItemTitle className="break-all">{address}</ItemTitle>
          </ItemContent>
          <ItemActions>
            <Button size="sm" variant="secondary" onClick={copy}>
              <CopyIcon data-icon="inline-start" />
              Copy
            </Button>
          </ItemActions>
        </Item>
      ) : (
        <p className="type-body text-muted-foreground">No address right now.</p>
      )}
      {isAdmin ? (
        <>
          <Field>
            <FieldLabel>The landlord</FieldLabel>
            {senders.length ? (
              <ItemGroup className="gap-0">
                {senders.map((s) => (
                  <Item key={s.value} className="py-2">
                    <ItemContent>
                      <ItemTitle>{s.value}</ItemTitle>
                      <ItemDescription>{s.source === "forward" ? "From a forward" : s.source === "intro" ? "From the intro email" : "An admin said yes"}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(s.value)}>
                        Remove
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            ) : (
              <FieldDescription>Nobody yet. Forward one of their emails to the address and Roomie learns who they are.</FieldDescription>
            )}
          </Field>
          {address ? (
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
              <AlertDialogTrigger render={<Button variant="destructive" className="self-start" />}>Release address</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Release {address}?</AlertDialogTitle>
                  <AlertDialogDescription>Mail sent to it will bounce, and this address can&apos;t be had back. What Roomie filed stays.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" disabled={pending} onClick={release}>
                    Release it
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </>
      ) : null}
    </FieldSet>
  )
}
