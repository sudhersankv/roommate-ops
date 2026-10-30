"use client"

import { useState, useTransition } from "react"
import { CheckIcon, CopyIcon, EllipsisIcon, RefreshCwIcon, UserPlusIcon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldLegend, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { toast } from "@/components/ui/toast"
import { MemberAvatar } from "@/components/app/member-avatar"
import type { PaymentApp } from "@/db/schema"
import { decideMember, reassignSeat, revokeSeat, rotateJoinLink, setPaymentHandles } from "../../actions"
import { useGroup, type MemberView } from "../group-context"
import { PageHeader, TopBar } from "../shell"

const appName: Record<PaymentApp, string> = { venmo: "Venmo", paypal: "PayPal", cashapp: "Cash App" }
const apps = Object.keys(appName) as PaymentApp[]

/** "Sam Kim (sam@gmail.com)": who signed in to a seat. The email only reaches Admins (and you, for your own). */
const signedInAs = (m: MemberView) => [m.seat.accountName, m.seat.accountEmail ? `(${m.seat.accountEmail})` : null].filter(Boolean).join(" ") || "a Google account"

export function MembersScreen() {
  const { group, members, isAdmin, dates, cheer, joinUrl } = useGroup()
  const [inviting, setInviting] = useState(false)
  const [moving, setMoving] = useState<MemberView | null>(null)
  const [pending, start] = useTransition()
  const waiting = members.filter((m) => m.status === "pending")
  const active = members.filter((m) => m.status === "active")
  const admins = active.filter((m) => m.role === "admin").map((m) => m.name)

  const decide = (m: MemberView, decision: "approve" | "decline") =>
    start(async () => {
      const res = await decideMember(group.id, m.id, decision)
      if (!res.ok) return void toast.add({ title: "Couldn't do that", description: res.error, type: "error" })
      if (decision === "approve") {
        cheer()
        const as = res.data && res.data !== m.name ? ` as ${res.data}` : ""
        toast.add({ title: `${m.name} is in${as}`, description: m.seat.accountName ? "Their Google account is connected." : "They connect with the Join link.", type: "success" })
      } else {
        toast.add({ title: `Declined ${m.name}`, description: "They stay in the group chat, but Roomie won't act for them." })
      }
    })

  return (
    <>
      <TopBar title="Members" />
      <PageHeader title="Members">
        <p className="type-body text-muted-foreground">Everyone in the {group.name} chat, and who&apos;s on the dashboard.</p>
      </PageHeader>

      <div className="flex flex-col gap-8 px-4">
        {joinUrl ? <JoinLinkCard url={joinUrl} /> : null}

        {waiting.length ? (
          <section aria-labelledby="pending" className="flex flex-col gap-2">
            <h2 id="pending" className="type-heading px-1">
              {isAdmin ? "Waiting for you" : "Waiting for approval"}
            </h2>
            <ItemGroup className="gap-2">
              {waiting.map((m) => (
                <Item key={m.id} variant="outline" className="rounded-3xl p-4">
                  <ItemMedia>
                    <MemberAvatar name={m.name} image={m.seat.accountImage} size="lg" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="min-w-0">
                      <span className="truncate">{m.name}</span>
                      <Badge variant="outline">Pending</Badge>
                    </ItemTitle>
                    <ItemDescription className="line-clamp-none break-words">
                      {m.seat.accountName || m.seat.accountEmail
                        ? m.seat.wantsSeat
                          ? `Signed in with the Join link as ${signedInAs(m)} and says they're ${m.seat.wantsSeat}. Approving connects them to ${m.seat.wantsSeat}'s seat.`
                          : `Signed in with the Join link as ${signedInAs(m)}, and isn't on the list yet.`
                        : `Joined the chat ${dates.ago(m.joined)}.`}{" "}
                      Until {isAdmin ? "you approve" : `${admins.join(" or ") || "an Admin"} approves`}, Roomie won&apos;t log anything for them or show them the group&apos;s money.
                    </ItemDescription>
                  </ItemContent>
                  {isAdmin ? (
                    <ItemFooter className="justify-start gap-2 pt-1">
                      <Button disabled={pending} onClick={() => decide(m, "approve")}>
                        Approve
                      </Button>
                      <Button variant="ghost" disabled={pending} onClick={() => decide(m, "decline")}>
                        Decline
                      </Button>
                      {m.hasAccount ? (
                        <Button variant="ghost" disabled={pending} onClick={() => setMoving(m)}>
                          Pick their seat
                        </Button>
                      ) : null}
                    </ItemFooter>
                  ) : null}
                </Item>
              ))}
            </ItemGroup>
          </section>
        ) : null}

        <section aria-labelledby="everyone" className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <h2 id="everyone" className="type-heading">
              {active.length} members
            </h2>
            <Button variant="tint" size="sm" onClick={() => setInviting(true)}>
              <UserPlusIcon data-icon="inline-start" />
              Invite
            </Button>
          </div>
          <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
            {active.map((m) => (
              <MemberRow key={m.id} member={m} onMove={() => setMoving(m)} />
            ))}
          </ItemGroup>
        </section>
      </div>

      <Drawer open={inviting} onOpenChange={setInviting}>
        <DrawerContent className="mx-auto max-w-md">
          <DrawerHeader>
            <DrawerTitle className="type-heading">Invite someone</DrawerTitle>
            <DrawerDescription>People join through the chat, and get to the dashboard with the Join link.</DrawerDescription>
          </DrawerHeader>
          <ol className="type-body flex list-decimal flex-col gap-3 py-4 pr-4 pl-9">
            <li>Add them to the {group.name} group chat.</li>
            <li>Roomie lists them here as pending until an Admin approves them.</li>
            <li>They open the Join link, sign in with Google and pick their name.</li>
          </ol>
          <DrawerFooter>
            <DrawerClose render={<Button size="lg" />}>Got it</DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <MoveSeatDrawer from={moving} onClose={() => setMoving(null)} />
    </>
  )
}

/** The Group's Join link: Copy for everyone, Rotate for Admins (the old link stops working). */
function JoinLinkCard({ url }: { url: string }) {
  const { group, isAdmin } = useGroup()
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.add({ title: "Couldn't copy", description: "Select the link and copy it instead.", type: "error" })
    }
  }
  const rotate = () =>
    start(async () => {
      const res = await rotateJoinLink(group.id)
      setConfirming(false)
      if (!res.ok) return void toast.add({ title: "Couldn't make a new link", description: res.error, type: "error" })
      toast.add({ title: "New Join link", description: "The old one stopped working. Post the new one in the chat.", type: "success" })
    })
  return (
    <section aria-labelledby="join-link" className="flex flex-col gap-3 rounded-3xl bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 id="join-link" className="type-heading">
          Join link
        </h2>
        <p className="type-body text-muted-foreground">Anyone in the chat opens it, signs in with Google and picks their name.</p>
      </div>
      <InputGroup>
        <InputGroupInput aria-label="Join link" readOnly value={url} spellCheck={false} translate="no" onFocus={(e) => e.currentTarget.select()} className="money" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label={copied ? "Copied" : "Copy the Join link"} onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <span className="sr-only" aria-live="polite">
        {copied ? "Join link copied" : ""}
      </span>
      {isAdmin ? (
        <>
          <Button variant="outline" size="sm" className="self-start" disabled={pending} onClick={() => setConfirming(true)}>
            <RefreshCwIcon data-icon="inline-start" />
            Rotate
          </Button>
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Make a new Join link?</AlertDialogTitle>
                <AlertDialogDescription>The old link stops working right away. People already connected stay connected.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep this one</AlertDialogCancel>
                <AlertDialogAction disabled={pending} onClick={rotate}>
                  Make a new link
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </section>
  )
}

function MemberRow({ member: m, onMove }: { member: MemberView; onMove: () => void }) {
  const { group, me, isAdmin } = useGroup()
  const [editing, setEditing] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [pending, start] = useTransition()
  const handles = apps.filter((a) => m.handles[a]).map((a) => `${appName[a]} ${m.handles[a]}`)
  const connected = m.seat.state === "connected"
  const promote = () =>
    start(async () => {
      const res = await decideMember(group.id, m.id, "promote")
      if (!res.ok) return void toast.add({ title: "Couldn't do that", description: res.error, type: "error" })
      toast.add({ title: `${m.name} is an Admin now`, description: "They can approve people and change settings.", type: "success" })
    })
  const revoke = () =>
    start(async () => {
      const res = await revokeSeat(group.id, m.id)
      setRevoking(false)
      if (!res.ok) return void toast.add({ title: "Couldn't disconnect", description: res.error, type: "error" })
      toast.add({ title: `Disconnected ${m.name}'s seat`, description: "It's open again on the Join link. That Google account waits here for an Admin." })
    })
  const admin = isAdmin && m.id !== me.id
  return (
    <Item className="py-3">
      <ItemMedia>
        <MemberAvatar name={m.name} image={m.seat.accountImage} size="lg" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="min-w-0">
          <span className="truncate">{m.id === me.id ? `${m.name} (you)` : m.name}</span>
          {m.role === "admin" ? <Badge variant="secondary">Admin</Badge> : null}
        </ItemTitle>
        <ItemDescription className="line-clamp-none break-words">
          {connected ? `On the dashboard as ${signedInAs(m)}.` : "Not on the dashboard yet."}{" "}
          {handles.length ? handles.join(", ") : "No payment handles yet."}
        </ItemDescription>
      </ItemContent>
      {m.id === me.id ? (
        <ItemActions>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <HandlesDrawer open={editing} onOpenChange={setEditing} member={m} />
        </ItemActions>
      ) : admin && (m.role !== "admin" || connected) ? (
        <ItemActions>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${m.name}`} disabled={pending} />}>
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {m.role !== "admin" ? <DropdownMenuItem onClick={promote}>Make admin</DropdownMenuItem> : null}
                {connected ? <DropdownMenuItem onClick={onMove}>Move to another seat</DropdownMenuItem> : null}
                {connected ? (
                  <DropdownMenuItem variant="destructive" onClick={() => setRevoking(true)}>
                    Disconnect
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialog open={revoking} onOpenChange={setRevoking}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect {m.name}&apos;s seat?</AlertDialogTitle>
                <AlertDialogDescription>
                  {signedInAs(m)} won&apos;t see {group.name}&apos;s dashboard anymore and waits on this page for an Admin. {m.name} stays in the group, and the seat is open again on the Join link.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction variant="destructive" disabled={pending} onClick={revoke}>
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </ItemActions>
      ) : null}
    </Item>
  )
}

/** Admins: move the Google account on `from` (a seat, or a Pending sign-in) to an open seat. */
function MoveSeatDrawer({ from, onClose }: { from: MemberView | null; onClose: () => void }) {
  const { group, members } = useGroup()
  const [to, setTo] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const open = members.filter((m) => m.status === "active" && m.seat.state === "open" && m.id !== from?.id)
  const target = open.find((m) => m.id === to)
  const move = () =>
    from &&
    to &&
    start(async () => {
      const res = await reassignSeat(group.id, from.id, to)
      if (!res.ok) return void toast.add({ title: "Couldn't move it", description: res.error, type: "error" })
      toast.add({ title: `Connected as ${res.data}`, description: `${signedInAs(from)} is on ${res.data}'s seat now.`, type: "success" })
      setTo(null)
      onClose()
    })
  return (
    <Drawer
      open={!!from}
      onOpenChange={(o) => {
        if (!o) {
          setTo(null)
          onClose()
        }
      }}
    >
      <DrawerContent className="mx-auto max-w-md">
        <DrawerHeader>
          <DrawerTitle className="type-heading">Which seat is {from ? signedInAs(from) : "theirs"}?</DrawerTitle>
          <DrawerDescription>{from?.status === "pending" ? "Picking a seat approves them as that person." : `${from?.name}'s seat opens up again.`}</DrawerDescription>
        </DrawerHeader>
        <div className="max-h-[50dvh] overflow-y-auto overscroll-contain px-4 py-2">
          {open.length ? (
            <FieldSet>
              <FieldLegend className="sr-only">Open seats</FieldLegend>
              <RadioGroup value={to} onValueChange={(v) => setTo(v as string)} className="gap-2">
                {open.map((m) => (
                  <FieldLabel key={m.id} htmlFor={`move-${m.id}`} className="rounded-2xl">
                    <Field orientation="horizontal" className="gap-3 has-[>[data-slot=field-content]]:items-center">
                      <MemberAvatar name={m.name} />
                      <FieldContent className="min-w-0">
                        <FieldTitle className="truncate">{m.name}</FieldTitle>
                      </FieldContent>
                      <RadioGroupItem value={m.id} id={`move-${m.id}`} />
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldSet>
          ) : (
            <FieldDescription>Every seat has someone on it. Disconnect one first.</FieldDescription>
          )}
        </div>
        <DrawerFooter>
          <Button size="lg" disabled={!target || pending} onClick={move}>
            {target ? `Move to ${target.name}` : "Pick a seat"}
          </Button>
          <DrawerClose render={<Button variant="ghost" size="lg" />}>Cancel</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function HandlesDrawer({ open, onOpenChange, member }: { open: boolean; onOpenChange: (o: boolean) => void; member: MemberView }) {
  const { group } = useGroup()
  const [values, setValues] = useState(() => Object.fromEntries(apps.map((a) => [a, member.handles[a] ?? ""])) as Record<PaymentApp, string>)
  const [pending, start] = useTransition()
  const save = () =>
    start(async () => {
      const res = await setPaymentHandles(group.id, values)
      if (!res.ok) return void toast.add({ title: "Couldn't save", description: res.error, type: "error" })
      toast.add({ title: "Handles saved", description: "Settle up links to them now.", type: "success" })
      onOpenChange(false)
    })
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md">
        <DrawerHeader>
          <DrawerTitle className="type-heading">Your payment handles</DrawerTitle>
          <DrawerDescription>People who owe you see these on Settle up. Leave one empty to remove it.</DrawerDescription>
        </DrawerHeader>
        <form
          id="handles-form"
          className="px-4 pt-2 pb-4"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <FieldGroup>
            {apps.map((a) => (
              <Field key={a}>
                <FieldLabel htmlFor={`handle-${a}`}>{appName[a]}</FieldLabel>
                <Input
                  id={`handle-${a}`}
                  autoComplete="off"
                  placeholder={a === "venmo" ? "@your-name" : a === "cashapp" ? "$yourname" : "you@example.com"}
                  value={values[a]}
                  onChange={(e) => setValues((v) => ({ ...v, [a]: e.target.value }))}
                />
              </Field>
            ))}
          </FieldGroup>
        </form>
        <DrawerFooter>
          <Button type="submit" form="handles-form" size="lg" disabled={pending}>
            Save
          </Button>
          <DrawerClose render={<Button variant="ghost" size="lg" />}>Cancel</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
