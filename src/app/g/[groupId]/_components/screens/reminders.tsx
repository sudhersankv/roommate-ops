"use client"

import { useTransition } from "react"
import { BellIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { toast } from "@/components/ui/toast"
import { MemberAvatar } from "@/components/app/member-avatar"
import { cancelReminder } from "../../actions"
import { useGroup } from "../group-context"
import { PageHeader, TopBar } from "../shell"
import type { ReminderView } from "../types"

/** The Reminders page: what's coming up that you may see, with Cancel where you may. */
export function RemindersScreen({ reminders }: { reminders: ReminderView[] }) {
  return (
    <>
      <TopBar title="Reminders" />
      <PageHeader title="Reminders">
        <p className="type-body text-muted-foreground">Everyone&apos;s go to the group chat. One person&apos;s go to them privately.</p>
      </PageHeader>
      <div className="flex flex-col gap-8 px-4 pb-28">
        <RemindersList reminders={reminders} />
      </div>
    </>
  )
}

export function RemindersList({ reminders }: { reminders: ReminderView[] }) {
  const { group, name, me } = useGroup()
  const [pending, start] = useTransition()
  const cancel = (r: ReminderView) =>
    start(async () => {
      const res = await cancelReminder(group.id, r.id)
      if (!res.ok) return void toast.add({ title: "Couldn't cancel it", description: res.error, type: "error" })
      toast.add({ title: "Reminder cancelled", description: r.text })
    })

  if (reminders.length === 0) {
    return (
      <Empty className="rounded-3xl bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BellIcon />
          </EmptyMedia>
          <EmptyTitle>No reminders coming up</EmptyTitle>
          <EmptyDescription>Ask in the chat: “roomie remind everyone trash goes out Tuesday 8pm”, or “remind me to pay rent on the 1st every month”.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <section aria-labelledby="reminders" className="flex flex-col gap-2">
      <h2 id="reminders" className="type-heading px-1">
        Coming up
      </h2>
      <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
        {reminders.map((r) => (
          <Item key={r.id} className="py-3">
            <ItemMedia>{r.for ? <MemberAvatar name={r.for === me.id ? me.name : name(r.for)} /> : <BellIcon className="size-5 text-muted-foreground" aria-hidden />}</ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="flex-wrap">
                {r.text}
                {r.repeat ? <Badge variant="secondary">{r.repeat === "daily" ? "Every day" : r.repeat === "weekly" ? "Every week" : "Every month"}</Badge> : null}
              </ItemTitle>
              <ItemDescription className="line-clamp-none">
                {r.when}. {r.for ? (r.for === me.id ? "Just for you" : `For ${name(r.for)}`) : "For everyone"}
                {r.setBy && r.setBy !== r.for ? `, set by ${name(r.setBy) === "You" ? "you" : name(r.setBy)}` : ""}.
              </ItemDescription>
            </ItemContent>
            {r.canCancel ? (
              <ItemActions>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => cancel(r)}>
                  Cancel
                </Button>
              </ItemActions>
            ) : null}
          </Item>
        ))}
      </ItemGroup>
    </section>
  )
}
