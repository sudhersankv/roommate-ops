"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { Roomie, type RoomieMood } from "@/components/roomie/mascot"
import { dinoSize, nextDelay, peekFrames, peekPose, pickCard, PEEK_MOMENTS, PEEK_MS, sidesFor, type Side } from "./peek-plan"

// One giant dino for the whole page (docs/landing.md "Motion and color"): it lives behind a chat window, and every
// 5-9 s it walks to an edge of the chat you're looking at, peeks out at you and ducks back. Hovering a chat calls it
// over sooner. Transforms only; reduced motion, no IntersectionObserver or before hydration: nothing at all.

type Spot = { ratio: number; lastPeekAt: number; play: () => boolean }

const spots = new Map<string, Spot>()
let busy = false
let timer: number | undefined
/** A hover may call it over once the chat hasn't had a peek for this long. */
const HOVER_COOLDOWN_MS = 4_000
/** The first peek comes soon after the page loads, while the hero's lines are still arriving. */
const FIRST_MS = 2_600

function schedule(ms: number) {
  window.clearTimeout(timer)
  timer = window.setTimeout(tick, ms)
}

function tick() {
  if (document.hidden || busy) return schedule(nextDelay())
  const now = performance.now()
  const id = pickCard([...spots].map(([id, s]) => ({ id, ratio: s.ratio, lastPeekAt: s.lastPeekAt })), now)
  if (id) spots.get(id)?.play()
  schedule(nextDelay())
}

export function Peek({ free, top = true, children }: { free: "left" | "right"; top?: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const dino = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  const [size, setSize] = useState(0)
  const [mood, setMood] = useState<RoomieMood>("calm")

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return
    const el = box.current
    if (!el) return
    const id = Math.random().toString(36).slice(2)
    const card = () => ({ w: el.offsetWidth, h: el.offsetHeight })
    const timers: number[] = []
    const anims: Animation[] = []

    const play = (): boolean => {
      const d = dino.current
      const c = card()
      if (!d || busy || c.w < 160) return false
      const s = dinoSize(c)
      // Only an edge with room past it on screen (a phone's full-width chat: the top, if anything).
      const rect = el.getBoundingClientRect()
      const room: Record<Side, number> = { left: rect.left, right: window.innerWidth - rect.right, top: Infinity }
      const sides = sidesFor(free, false, top).filter((side) => {
        const p = peekPose(side, "peek", c, s)
        const past = side === "top" ? -(p.y - s / 2) - c.h / 2 : Math.abs(p.x) + s / 2 - c.w / 2
        return room[side] >= past + 8
      })
      if (!sides.length) return false
      const side = sides[Math.floor(Math.random() * sides.length)]
      busy = true
      spots.get(id)!.lastPeekAt = performance.now()
      setSize(s)
      setMood("calm")
      const anim = d.animate(peekFrames(side, c, s), { duration: PEEK_MS, easing: "linear" })
      timers.push(window.setTimeout(() => setMood("happy"), PEEK_MS * PEEK_MOMENTS.caughtAt))
      const done = () => {
        busy = false
        setMood("calm")
      }
      anims.push(anim)
      anim.onfinish = done
      anim.oncancel = done
      return true
    }

    spots.set(id, { ratio: 0, lastPeekAt: -Infinity, play })
    setSize(dinoSize(card()))
    setOn(true)

    const io = new IntersectionObserver(
      ([e]) => {
        const spot = spots.get(id)
        if (spot) spot.ratio = e.intersectionRatio
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    io.observe(el)
    const resize = new ResizeObserver(() => !busy && setSize(dinoSize(card())))
    resize.observe(el)

    const hover = () => {
      const spot = spots.get(id)
      if (spot && performance.now() - spot.lastPeekAt > HOVER_COOLDOWN_MS && play()) schedule(nextDelay())
    }
    el.addEventListener("pointerenter", hover)
    if (spots.size === 1) schedule(FIRST_MS)

    return () => {
      spots.delete(id)
      io.disconnect()
      resize.disconnect()
      el.removeEventListener("pointerenter", hover)
      timers.forEach(clearTimeout)
      anims.forEach((a) => a.cancel())
      if (!spots.size) window.clearTimeout(timer)
    }
  }, [free, top])

  return (
    <div ref={box} className="relative isolate">
      {on && size > 0 ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
          <div ref={dino} className="lp-peek absolute top-1/2 left-1/2" style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}>
            <Roomie mood={mood} size={size} animated decorative />
          </div>
        </div>
      ) : null}
      <div className="relative z-10">{children}</div>
    </div>
  )
}
