"use client"

import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Roomie } from "@/components/roomie/mascot"
import { useGroup } from "../group-context"
import { TopBar } from "../shell"

export function PendingScreen() {
  const { group, active, me, setAskOpen } = useGroup()
  const admins = active.filter((m) => m.role === "admin").map((m) => m.name)
  // A Join link sign-in isn't in the chat: nothing to ask Roomie until an Admin lets them in.
  if (!me.inChat) {
    return (
      <>
        <TopBar title={group.name} />
        <Empty className="mx-4 mt-6 rounded-3xl bg-card">
          <EmptyHeader>
            <EmptyMedia>
              <Roomie size={96} mood="sleepy" animated />
            </EmptyMedia>
            <EmptyTitle>Waiting for an Admin</EmptyTitle>
            <EmptyDescription>
              {admins.join(" or ") || "An Admin"} needs to approve you; I&apos;ll let you know in the chat. Then {group.name}&apos;s dashboard opens right here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    )
  }
  return (
    <>
      <TopBar title={group.name} />
      <Empty className="mx-4 mt-6 rounded-3xl bg-card">
        <EmptyHeader>
          <EmptyMedia>
            <Roomie size={96} mood="sleepy" animated />
          </EmptyMedia>
          <EmptyTitle>Waiting for an Admin</EmptyTitle>
          <EmptyDescription>
            You&apos;re in {group.name}, but {admins.join(" or ") || "an Admin"} still needs to approve you. Until then you can chat with Roomie, but it won&apos;t log
            anything for you or show you the group&apos;s money.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="secondary" onClick={() => setAskOpen(true)}>
            Ask Roomie
          </Button>
        </EmptyContent>
      </Empty>
    </>
  )
}
