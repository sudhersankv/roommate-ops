"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { toast } from "@/components/ui/toast"
import type { ToolkitId } from "@/toolkits/types"
import { setToolkit } from "../actions"
import { useGroup } from "./group-context"

/** A page owned by a Trick Roomie hasn't learned here: what it is, and "Teach Roomie X" for Admins ("Ask an admin" for everyone else). */
export function ToolkitOff({ toolkit }: { toolkit: { id: string; name: string; summary: string; icon: ReactNode } }) {
  const { group, base, isAdmin, active } = useGroup()
  const router = useRouter()
  const [pending, start] = useTransition()
  const admins = active.filter((m) => m.role === "admin").map((m) => m.name)
  const teach = () =>
    start(async () => {
      const res = await setToolkit(group.id, toolkit.id as ToolkitId, true)
      if (!res.ok) return void toast.add({ title: `Roomie couldn't learn ${toolkit.name}`, description: res.error, type: "error" })
      toast.add({ title: `Roomie learned ${toolkit.name}`, description: res.data?.tryThis ? `Try in the chat: "roomie, ${res.data.tryThis}"` : undefined, type: "success" })
      router.refresh()
    })
  return (
    <>
      <Empty className="px-6 py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-12 rounded-2xl opacity-70 grayscale [&_svg]:size-6">
            {toolkit.icon}
          </EmptyMedia>
          <EmptyTitle className="type-heading">Roomie hasn&apos;t learned {toolkit.name} here yet.</EmptyTitle>
          <EmptyDescription>{toolkit.summary}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {isAdmin ? (
            <Button size="lg" disabled={pending} onClick={teach}>
              Teach Roomie {toolkit.name}
            </Button>
          ) : (
            <p className="type-body text-muted-foreground">Ask an admin{admins.length ? ` (${admins.join(" or ")})` : ""} to teach it.</p>
          )}
          <Button variant="link" size="sm" nativeButton={false} render={<Link href={`${base}/tricks?open=${toolkit.id}`} />}>
            More about {toolkit.name}
          </Button>
        </EmptyContent>
      </Empty>
    </>
  )
}
