"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "cn"

import { Roomie, type RoomieMood } from "@/components/roomie/mascot"
import { useCheer } from "@/components/roomie/use-cheer"

type Cues = { callMs: number | null; replyMs: number | null; winMs: number | null }

// useLayoutEffect warns on the server; this page renders there first.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

/**
 * A chat with the dino watching it. The dino naps until someone says "roomie", perks up, is happy when it has
 * answered and hops on the win. `start="load"` plays at once (the hero, whose lines are already animating in CSS);
 * "view" waits until the chat is on screen. Reduced motion, or no IntersectionObserver: everything is just there
 * and the dino is happy.
 */
export function Stage({
  cues,
  start = "view",
  size = 56,
  className,
  dinoClassName,
  children,
}: {
  cues: Cues
  start?: "load" | "view"
  size?: number
  className?: string
  dinoClassName?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // SSR: the hero is already playing (CSS); a demo is static until JS arms it.
  const [state, setState] = useState<"static" | "armed" | "play">(start === "load" ? "play" : "static")
  const [mood, setMood] = useState<RoomieMood>(start === "load" ? "sleepy" : "happy")
  const [cheering, cheer] = useCheer()

  useIsoLayoutEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced || (start === "view" && !("IntersectionObserver" in window))) {
      setState("static")
      setMood("happy")
      return
    }
    const timers: number[] = []
    const play = () => {
      setState("play")
      setMood("sleepy")
      const at = (ms: number | null, fn: () => void) => ms !== null && timers.push(window.setTimeout(fn, ms))
      at(cues.callMs, () => setMood("calm"))
      at(cues.replyMs, () => setMood("happy"))
      at(cues.winMs, () => {
        setMood("happy")
        cheer()
      })
      if (cues.replyMs === null) setMood("happy")
    }
    if (start === "load") {
      play()
      return () => timers.forEach(clearTimeout)
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
      timers.forEach(clearTimeout)
    }
    // Cues are static data from the server; run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={ref} data-state={state} className={cn("lp-stage relative", className)}>
      <Roomie mood={mood} size={size} animated cheer={cheering} className={cn("absolute z-10", dinoClassName)} />
      {children}
    </div>
  )
}
