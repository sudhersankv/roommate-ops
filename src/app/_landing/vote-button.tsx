"use client"

import { useEffect, useState, useTransition } from "react"
import { CheckIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { voteTrick } from "./actions"

const key = (id: string) => `roomie:trick-vote:${id}`

/** "I want this" on a coming-soon Trick. Remembers the vote in this browser; the count shows from `showFrom` votes. */
export function VoteButton({ trickId, name, count, showFrom }: { trickId: string; name: string; count: number; showFrom: number }) {
  const [voted, setVoted] = useState(false)
  const [fresh, setFresh] = useState(false)
  const [n, setN] = useState(count)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    try {
      // Reading this browser's earlier vote after hydration; the server can't know it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(key(trickId))) setVoted(true)
    } catch {}
  }, [trickId])

  const vote = () =>
    start(async () => {
      setError(null)
      const res = await voteTrick(trickId)
      if (res.status === "error") return setError(res.message)
      setVoted(true)
      setFresh(true)
      if (res.counted) setN((x) => x + 1)
      try {
        localStorage.setItem(key(trickId), "1")
      } catch {}
    })

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {voted ? (
        <span role="status" className={cn("lp-voted relative inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground/8 px-3 text-xs font-semibold", fresh && "is-fresh")}>
          <CheckIcon aria-hidden className="size-3.5" />
          Noted ✨
          <span aria-hidden className="lp-spark" />
        </span>
      ) : (
        <Button size="xs" variant="outline" onClick={vote} disabled={pending} aria-label={`I want ${name}`}>
          {pending ? "Sending…" : "I want this"}
        </Button>
      )}
      {n >= showFrom && <span className="type-caption text-muted-foreground">{n} want this</span>}
      {error && (
        <span role="alert" className="type-caption text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
