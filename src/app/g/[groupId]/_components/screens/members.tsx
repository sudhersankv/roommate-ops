"use client"

import { useState, useTransition } from "react"
import { UserPlusIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { toast } from "@/components/ui/toast"
import { MemberAvatar } from "@/components/app/member-avatar"
import type { PaymentApp } from "@/db/schema"
import { decideMember, setPaymentHandles } from "../../actions"
import { useGroup, type MemberView } from "../group-context"
import { PageHeader, TopBar } from "../shell"

const appName: Record<PaymentApp, string> = { venmo: "Venmo", paypal: "PayPal", cashapp: "Cash App" }
const apps = Object.keys(appName) as PaymentApp[]

export function MembersScreen() {
  const { group, members, isAdmin, dates, cheer } = useGroup()
  const [inviting, setInviting] = useState(false)
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
        toast.add({ title: `${m.name} is in`, description: "Roomie sends a private sign-in link when they ask for the dashboard.", type: "success" })
      } else {
        toast.add({ title: `Declined ${m.name}`, description: "They stay in the WhatsApp group, but Roomie won't act for them." })
      }
    })

  return (
    <>
      <TopBar title="Members" />
      <PageHeader title="Members">
        <p className="type-body text-muted-foreground">Everyone in the {group.name} chat.</p>
      </PageHeader>

      <div className="flex flex-col gap-8 px-4">
        {waiting.length ? (
          <section aria-labelledby="pending" className="flex flex-col gap-2">
            <h2 id="pending" className="type-heading px-1">
              {isAdmin ? "Waiting for you" : "Waiting for approval"}
            </h2>
            <ItemGroup className="gap-2">
              {waiting.map((m) => (
                <Item key={m.id} variant="outline" className="rounded-3xl p-4">
                  <ItemMedia>
                    <MemberAvatar name={m.name} size="lg" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {m.name}
                      <Badge variant="outline">Pending</Badge>
                    </ItemTitle>
                    <ItemDescription className="line-clamp-none">
                      Joined the chat {dates.ago(m.joined)}. Roomie answers {m.name} but won&apos;t log anything for them or show them the group&apos;s money
                      until {isAdmin ? "you approve" : `${admins.join(" or ") || "an Admin"} approves`}.
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
              <MemberRow key={m.id} member={m} />
            ))}
          </ItemGroup>
        </section>
      </div>

      <Drawer open={inviting} onOpenChange={setInviting}>
        <DrawerContent className="mx-auto max-w-md">
          <DrawerHeader>
            <DrawerTitle className="type-heading">Invite someone</DrawerTitle>
            <DrawerDescription>There&apos;s no invite link to share. People join through the chat.</DrawerDescription>
          </DrawerHeader>
          <ol className="type-body flex list-decimal flex-col gap-3 py-4 pr-4 pl-9">
            <li>Add them to the {group.name} group on WhatsApp.</li>
            <li>Roomie notices and lists them here as pending. An Admin approves them.</li>
            <li>When they ask Roomie for the dashboard, it sends them a private claim link. One tap and they&apos;re signed in.</li>
          </ol>
          <DrawerFooter>
            <DrawerClose render={<Button size="lg" />}>Got it</DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  )
}

function MemberRow({ member: m }: { member: MemberView }) {
  const { group, me, isAdmin } = useGroup()
  const [editing, setEditing] = useState(false)
  const [pending, start] = useTransition()
  const handles = apps.filter((a) => m.handles[a]).map((a) => `${appName[a]} ${m.handles[a]}`)
  const promote = () =>
    start(async () => {
      const res = await decideMember(group.id, m.id, "promote")
      if (!res.ok) return void toast.add({ title: "Couldn't do that", description: res.error, type: "error" })
      toast.add({ title: `${m.name} is an Admin now`, description: "They can approve people and change settings.", type: "success" })
    })
  return (
    <Item className="py-3">
      <ItemMedia>
        <MemberAvatar name={m.name} size="lg" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>
          {m.id === me.id ? `${m.name} (you)` : m.name}
          {m.role === "admin" ? <Badge variant="secondary">Admin</Badge> : null}
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          {handles.length ? handles.join(", ") : "No payment handles yet. Roomie asks the first time someone owes them."}
        </ItemDescription>
      </ItemContent>
      {m.id === me.id ? (
        <ItemActions>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <HandlesDrawer open={editing} onOpenChange={setEditing} member={m} />
        </ItemActions>
      ) : isAdmin && m.role !== "admin" ? (
        <ItemActions>
          <Button variant="ghost" size="sm" disabled={pending} onClick={promote}>
            Make admin
          </Button>
        </ItemActions>
      ) : null}
    </Item>
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
