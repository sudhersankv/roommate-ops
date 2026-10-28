import { useId } from "react"
import { cn } from "cn"

import parts from "../../../design/brand/bird-parts.json"

export type RoomieMood = "calm" | "happy" | "worried" | "sleepy"

const moodLabel: Record<RoomieMood, string> = {
  calm: "Roomie",
  happy: "Roomie, happy",
  worried: "Roomie, a little worried",
  sleepy: "Roomie, sleepy",
}

/**
 * The Roomie dino, inlined from design/brand/bird-parts.json so CSS can drive its moods.
 * `cheer` plays the one-shot hop while it is true (see useCheer). Pass `decorative` when a label sits next to it.
 */
export function Roomie({
  mood = "calm",
  size = 64,
  animated = false,
  cheer = false,
  decorative = false,
  className,
}: {
  mood?: RoomieMood
  size?: number
  animated?: boolean
  cheer?: boolean
  decorative?: boolean
  className?: string
}) {
  // Each instance needs its own clip-path id, or every dino on the page would clip to the first one's belly.
  const clipId = `rm${useId().replace(/[^a-zA-Z0-9]/g, "")}-clip`
  const inner = parts.birdInner.replaceAll("P-clip", clipId)

  return (
    <>
      <style href="roomie-mascot" precedence="medium">
        {parts.style}
      </style>
      <svg
        viewBox="0 0 128 128"
        width={size}
        height={size}
        className={cn(
          parts.rootClass,
          mood !== "calm" && `is-${mood}`,
          animated && "is-animated",
          cheer && "is-cheer",
          "shrink-0 overflow-visible",
          className
        )}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : moodLabel[mood]}
        aria-hidden={decorative || undefined}
        dangerouslySetInnerHTML={{ __html: inner }}
      />
    </>
  )
}

/** Mood from a Balance in cents: owed is happy, owing a lot is worried, nothing going on is sleepy. */
export function moodForBalance(cents: number, quiet = false): RoomieMood {
  if (quiet && cents === 0) return "sleepy"
  if (cents > 0) return "happy"
  if (cents <= -5000) return "worried"
  return "calm"
}
