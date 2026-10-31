"use client"

import Link from "next/link"
import { useEffect, useState, useTransition } from "react"
import { cn } from "cn"
import { ArrowLeftIcon, CopyIcon, FileTextIcon, InboxIcon, MailOpenIcon } from "lucide-react"

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

type Filter = InboxTab | "all"

const TABS: { value: InboxTab; label: string }[] = [
  { value: "notices", label: "Notices" },
  { value: "rent", label: "Rent & lease" },
  { value: "work-orders", label: "Work orders" },
  { value: "other", label: "Everything else" },
  { value: "new-senders", label: "New senders" },
]

const STATUS: Record<string, string> = { sent: "Sent", acknowledged: "Seen", scheduled: "Scheduled", done: "Done" }

/** "Brookfield Leasing <leasing@brookfield.com>" -> "Brookfield Leasing"; a bare address stays as it is. */
const senderName = (from: string) => from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/)?.[1] ?? from

/** Threads opened in this browser (thread id -> its latest activity then), for the unread dot. Nothing leaves the device. */
const seenKey = (groupId: string) => `roomie-inbox-seen:${groupId}`
const UNREAD_DAYS = 7

function useUnread(groupId: string, threads: InboxThreadView[], open: InboxThreadView | null): Set<string> {
  const [unread, setUnread] = useState<Set<string>>(new Set())
  useEffect(() => {
    let seen: Record<string, string> = {}
    try {
      seen = JSON.parse(localStorage.getItem(seenKey(groupId)) ?? "{}")
    } catch {}
    if (open) {
      seen[open.threadId] = open.at
      try {
        localStorage.setItem(seenKey(groupId), JSON.stringify(seen))
      } catch {}
    }
    const since = new Date(Date.now() - UNREAD_DAYS * 86_400_000).toISOString()
    setUnread(new Set(threads.filter((t) => t.at > since && (!seen[t.threadId] || seen[t.threadId] < t.at)).map((t) => t.threadId)))
  }, [groupId, threads, open])
  return unread
}

/**
 * The Inbox page: the Group's landlord mail. On a phone it's three steps: the list (sender, subject, one line, time, a
 * dot for what's new here), the thread full screen with a way back, and the reply box under the thread. On a wide
 * screen the list and the open thread sit side by side. The open thread is `?thread=<id>`, so Back works.
 */
export function InboxScreen({ view, openThread }: { view: InboxView; openThread: string | null }) {
  const { group, base } = useGroup()
  const thread = view.threads.find((t) => t.threadId === openThread) ?? null
  const [filter, setFilter] = useState<Filter>("all")
  const unread = useUnread(group.id, view.threads, thread)
  const shown = filter === "all" ? view.threads : view.threads.filter((t) => t.tab === filter)
  const chips = TABS.filter((t) => view.counts[t.value] > 0 || t.value === filter)
  const inbox = `${base}/inbox`

  return (
    <div data-wide className="flex flex-col">
      <TopBar title={thread ? (thread.workOrder?.title ?? thread.subject) : "Inbox"} />
      <div className={cn(thread && "hidden lg:block")}>
        <PageHeader title="Inbox">
          <p className="type-body text-pretty text-muted-foreground">
            {view.address ? (
              <>
                What the landlord sends to <Address value={view.address} />, sorted.
              </>
            ) : (
              "There's no address here. An admin can teach Roomie Lease Inbox again for a new one."
            )}
          </p>
        </PageHeader>
      </div>
      <div className="grid gap-6 px-4 pb-28 lg:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)] lg:items-start">
        <section aria-label="Threads" className={cn("flex min-w-0 flex-col gap-4", thread && "hidden lg:flex")}>
          {view.threads.length ? (
            <ToggleGroup variant="outline" size="sm" spacing={1} className="flex-wrap" value={[filter]} onValueChange={(v) => v[0] && setFilter(v[0] as Filter)} aria-label="Show">
              <ToggleGroupItem value="all">
                All <span className="text-muted-foreground">{view.threads.length}</span>
              </ToggleGroupItem>
              {chips.map((t) => (
                <ToggleGroupItem key={t.value} value={t.value}>
                  {t.label} <span className="text-muted-foreground">{view.counts[t.value]}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}
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
            <ItemGroup className="gap-0 overflow-hidden rounded-3xl bg-card py-1">
              {shown.map((t) => (
                <ThreadRow key={t.threadId} thread={t} href={`${inbox}?thread=${encodeURIComponent(t.threadId)}`} open={t.threadId === thread?.threadId} unread={unread.has(t.threadId)} />
              ))}
            </ItemGroup>
          )}
        </section>
        {thread ? (
          <ThreadPane key={thread.threadId} thread={thread} back={inbox} />
        ) : (
          <Empty className="hidden rounded-3xl bg-card lg:flex">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MailOpenIcon />
              </EmptyMedia>
              <EmptyTitle>Pick a thread</EmptyTitle>
              <EmptyDescription>It opens here, with the reply box under it.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}

/** An email address that may wrap at the @ on a narrow screen, never mid-word. */
function Address({ value }: { value: string }) {
  const at = value.indexOf("@")
  return (
    <span className="font-medium text-foreground">
      {at > 0 ? (
        <>
          {value.slice(0, at)}
          <wbr />
          {value.slice(at)}
        </>
      ) : (
        value
      )}
    </span>
  )
}

function ThreadRow({ thread: t, href, open, unread }: { thread: InboxThreadView; href: string; open: boolean; unread: boolean }) {
  return (
    <Item
      className={cn("mx-1 items-start rounded-2xl py-3", open && "bg-primary/12 hover:bg-primary/16")}
      render={<Link href={href} aria-current={open ? "page" : undefined} />}
    >
      <span className="mt-2 flex size-2 shrink-0 justify-center" aria-hidden>
        {unread ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>
      <ItemContent className="min-w-0 gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className={cn("type-caption min-w-0 truncate", unread ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {senderName(t.from)}
            {unread ? <span className="sr-only">, new</span> : null}
          </span>
          <span className="type-caption shrink-0 text-muted-foreground tabular-nums">{t.when}</span>
        </div>
        <ItemTitle className={cn("w-full min-w-0", unread && "font-semibold")}>
          <span className="truncate">{t.workOrder?.title ?? t.subject}</span>
          {t.workOrder ? (
            <Badge variant="secondary" className="shrink-0">
              {STATUS[t.workOrder.status] ?? t.workOrder.status}
            </Badge>
          ) : null}
        </ItemTitle>
        {t.summary && t.summary !== (t.workOrder?.title ?? t.subject) ? <ItemDescription className="line-clamp-1">{t.summary}</ItemDescription> : null}
      </ItemContent>
    </Item>
  )
}

function ThreadPane({ thread, back }: { thread: InboxThreadView; back: string }) {
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
    <article aria-labelledby="thread-title" className="flex min-w-0 flex-col gap-4">
      <Button variant="ghost" size="sm" className="-ml-2 self-start lg:hidden" nativeButton={false} render={<Link href={back} />}>
        <ArrowLeftIcon data-icon="inline-start" />
        All mail
      </Button>
      <div className="flex flex-col gap-1 px-1">
        <h1 id="thread-title" className="type-title text-pretty">
          {thread.workOrder?.title ?? thread.subject}
        </h1>
        <p className="type-body text-muted-foreground">
          {thread.workOrder ? (
            <>
              Work order: {STATUS[thread.workOrder.status] ?? thread.workOrder.status}
              {thread.workOrder.scheduledFor ? `, ${thread.workOrder.scheduledFor}` : ""}
              {thread.workOrder.reportedBy ? `. Reported by ${thread.workOrder.reportedBy}.` : "."}
            </>
          ) : (
            `${senderName(thread.from)}, ${thread.items.length} ${thread.items.length === 1 ? "email" : "emails"}`
          )}
        </p>
      </div>
      <ol className="flex flex-col gap-3">
        {thread.items.map((m) => (
          <li key={m.id} className={cn("flex flex-col gap-1.5 rounded-3xl p-4", m.direction === "out" ? "ml-6 bg-muted" : "mr-6 bg-card")}>
            <p className="type-caption flex flex-wrap justify-between gap-x-3 text-muted-foreground">
              <span className="min-w-0 truncate font-medium text-foreground">{senderName(m.from)}</span>
              <span className="tabular-nums">{m.when}</span>
            </p>
            {m.subject ? <p className="type-heading text-pretty">{m.subject}</p> : null}
            <p className="type-body break-words whitespace-pre-wrap">{m.text}</p>
            {m.documents.length ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {m.documents.map((d, i) => (
                  <Button key={d.id} size="sm" variant="secondary" nativeButton={false} render={<a href={d.href} target="_blank" rel="noreferrer" />}>
                    <FileTextIcon data-icon="inline-start" />
                    Attachment {i + 1}
                  </Button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {thread.canReply ? (
        <Field className="rounded-3xl bg-card p-4">
          <FieldLabel htmlFor="reply">Reply</FieldLabel>
          <Textarea id="reply" rows={3} value={body} onChange={(e) => (setBody(e.target.value), setAsk(null))} placeholder="Tuesday morning works for us." />
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
        <p className="type-body px-1 text-muted-foreground">Roomie only replies to the landlord. A new sender needs an admin&apos;s yes first.</p>
      )}
    </article>
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
