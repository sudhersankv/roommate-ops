"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/** Returns [cheering, cheer]. Calling cheer() restarts the dino's one-shot hop and clears it after ~1.4s. */
export function useCheer(duration = 1400) {
  const [cheering, setCheering] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const frame = useRef<number | undefined>(undefined)

  const cheer = useCallback(() => {
    window.clearTimeout(timer.current)
    if (frame.current) cancelAnimationFrame(frame.current)
    setCheering(false)
    // One frame without the class so the animation restarts when it is already playing.
    frame.current = requestAnimationFrame(() => {
      setCheering(true)
      timer.current = window.setTimeout(() => setCheering(false), duration)
    })
  }, [duration])

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (frame.current) cancelAnimationFrame(frame.current)
    },
    []
  )

  return [cheering, cheer] as const
}
