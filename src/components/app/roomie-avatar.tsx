import { cn } from "cn"

import { Roomie } from "@/components/roomie/mascot"

/** The dino on a forest disc: Roomie's avatar wherever it speaks. */
export function RoomieAvatar({ size = 32, animated = false, className }: { size?: number; animated?: boolean; className?: string }) {
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full bg-forest", className)}
      style={{ width: size, height: size }}
    >
      <Roomie size={Math.round(size * 0.82)} animated={animated} decorative />
    </span>
  )
}
