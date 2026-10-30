"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "cn"

import { Roomie, type RoomieMood } from "@/components/roomie/mascot"
import { useCheer } from "@/components/roomie/use-cheer"

type Cues = { callMs: number | null; replyMs: number | null; winMs: number | null }
type PlayState = "static" | "armed" | "play"

// useLayoutEffect warns on the server; this page renders there first.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

/**
 * The page's one motion switch. SSR and reduced motion: "static" (the final frame, everything visible). With JS:
 * "armed" (hidden by landing.css) until 35% of the element is on screen, then "play" once. `start="load"` plays at
 * once. `onPlay` runs when it starts playing and may return a cleanup.
 */
function usePlayOnView(start: "load" | "view", onPlay?: () => void | (() => void)) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<PlayState>(start === "load" ? "play" : "static")

  useIsoLayoutEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced || (start === "view" && !("IntersectionObserver" in window))) {
      setState("static")
      return
    }
    let cleanup: void | (() => void)
    const play = () => {
      setState("play")
      cleanup = onPlay?.()
    }
    if (start === "load") {
      play()
      return () => cleanup?.()
    }
    const el = ref.current
    if (!el) return
    setState("armed")
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          play()
        }
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cleanup?.()
    }
    // Runs once: the cues are static data from the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return [ref, state] as const
}

/**
 * A chat with the dino watching it. The dino naps until someone says "roomie", perks up, is happy when it has
 * answered and hops on the win. `start="load"` plays at once (the hero, whose lines are already animating in CSS);
 * "view" waits until the chat is on screen. `drop`: the dino drops onto the window's edge as it starts, and hops when
 * Roomie first answers. Reduced motion, or no IntersectionObserver: everything is just there and the dino is happy.
 */
export function Stage({
  cues,
  start = "view",
  size = 56,
  drop = false,
  className,
  dinoClassName,
  children,
}: {
  cues: Cues
  start?: "load" | "view"
  size?: number
  drop?: boolean
  className?: string
  dinoClassName?: string
  children: ReactNode
}) {
  const [mood, setMood] = useState<RoomieMood>(start === "load" ? "sleepy" : "happy")
  const [cheering, cheer] = useCheer()
  const [ref, state] = usePlayOnView(start, () => {
    const timers: number[] = []
    const at = (ms: number | null, fn: () => void) => ms !== null && timers.push(window.setTimeout(fn, ms))
    setMood(drop ? "calm" : "sleepy")
    at(cues.callMs, () => setMood("calm"))
    at(cues.replyMs, () => {
      setMood("happy")
      if (drop) cheer()
    })
    at(cues.winMs, () => {
      setMood("happy")
      cheer()
    })
    if (cues.replyMs === null) setMood("happy")
    return () => timers.forEach(clearTimeout)
  })

  return (
    <div ref={ref} data-state={state} className={cn("lp-stage relative", className)}>
      <span className={cn("lp-dino absolute z-10", drop && "is-drop", dinoClassName)}>
        <Roomie mood={state === "static" ? "happy" : mood} size={size} animated cheer={cheering} className="block" />
      </span>
      {children}
    </div>
  )
}

/** The same play-once switch without a dino: for the small illustrations and the Trick blocks (landing.css). */
export function Reveal({ className, children }: { className?: string; children: ReactNode }) {
  const [ref, state] = usePlayOnView("view")
  return (
    <div ref={ref} data-state={state} className={cn("lp-stage relative", className)}>
      {children}
    </div>
  )
}
