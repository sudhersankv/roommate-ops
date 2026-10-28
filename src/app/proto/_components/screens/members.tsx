"use client"

import { useState } from "react"
import { UserPlusIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { toast } from "@/components/ui/toast"
import { ME, type Member, type PayApp } from "../../_data"
import { dayLabel } from "../../_lib/dates"
import { useStore } from "../../_lib/store"
import { MemberAvatar } from "../member-avatar"
import { PageHeader, TopBar } from "../shell"

const appName: Record<PayApp, string> = { venmo: "Venmo", paypal: "PayPal", cashapp: "Cash App" }

export function MembersScreen() {
  const { state, setMemberStatus } = useStore()
  const [inviting, setInviting] = useState(false)
  const me = state.members.find((m) => m.id === ME)
  const isAdmin = me?.role === "admin"
  const pending = state.members.filter((m) => m.status === "pending")
  const active = state.members.filter((m) => m.status === "active")

  return (
    <>
      <TopBar title="Members" />
      <PageHeader title="Members">
        <p className="type-body text-muted-foreground">Everyone in the Apt 4B WhatsApp group.</p>
      </PageHeader>

      <div className="flex flex-col gap-8 px-4">
        {pending.length && isAdmin ? (
          <section aria-labelledby="pending" className="flex flex-col gap-2">
            <h2 id="pending" className="type-heading px-1">
              Waiting for you
            </h2>
            <ItemGroup className="gap-2">
              {pending.map((m) => (
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
                      Joined the chat {dayLabel(m.joined)}. Roomie answers {m.name} but won&apos;t log anything for her or show her the group&apos;s money until you approve.
                    </ItemDescription>
                  </ItemContent>
                  <ItemFooter className="justify-start gap-2 pt-1">
                    <Button
                      onClick={() => {
                        setMemberStatus(m.id, "approve")
                        toast.add({ title: `${m.name} is in`, description: "Roomie will send her a private claim link when she asks for the dashboard.", type: "success" })
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setMemberStatus(m.id, "decline")
                        toast.add({ title: `Declined ${m.name}`, description: "She stays in the WhatsApp group, but Roomie won't act for her." })
                      }}
                    >
                      Decline
                    </Button>
                  </ItemFooter>
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
          <DrawerHeader className="text-left md:text-left">
            <DrawerTitle className="type-heading">Invite someone</DrawerTitle>
            <DrawerDescription className="text-left">There&apos;s no invite link to share. People join through the chat.</DrawerDescription>
          </DrawerHeader>
          <ol className="type-body flex list-decimal flex-col gap-3 py-4 pr-4 pl-9">
            <li>Add them to the Apt 4B group on WhatsApp.</li>
            <li>Roomie notices and lists them here as pending. You approve them.</li>
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

function MemberRow({ member: m }: { member: Member }) {
  const handles = (Object.entries(m.handles) as [PayApp, string][]).map(([app, h]) => `${appName[app]} ${h}`)
  return (
    <Item className="py-3">
      <ItemMedia>
        <MemberAvatar name={m.name} size="lg" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>
          {m.id === ME ? `${m.name} (you)` : m.name}
          {m.role === "admin" ? <Badge variant="secondary">Admin</Badge> : null}
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          {handles.length ? handles.join(", ") : "No payment handles yet. Roomie asks the first time someone owes them."}
        </ItemDescription>
      </ItemContent>
      {m.id !== ME ? null : (
        <ItemActions>
          <Button variant="ghost" size="sm" onClick={() => toast.add({ title: "Edit handles", description: "In the real app this opens your Venmo, PayPal and Cash App handles." })}>
            Edit
          </Button>
        </ItemActions>
      )}
    </Item>
  )
}
