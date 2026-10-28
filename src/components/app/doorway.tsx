import type { ReactNode } from "react"

/**
 * The Home hero: concentric arches (moss, leaf, sprout, forest) with Roomie standing in the doorway.
 * Brand art, so its colors are fixed in both themes.
 */
export function Doorway({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="dark relative bg-forest" role="img" aria-label={label}>
      <div className="relative mx-auto h-[13.5rem] max-w-[22.5rem]">
        <svg
          viewBox="0 0 360 210"
          className="absolute inset-x-0 bottom-0 h-full w-full"
          preserveAspectRatio="xMidYMax meet"
          aria-hidden
        >
          <path d="M62 210V128A118 118 0 0 1 298 128V210Z" className="fill-moss stroke-ink" strokeWidth="2" />
          <path d="M80 210V128A100 100 0 0 1 280 128V210Z" className="fill-leaf stroke-ink" strokeWidth="2" />
          <path d="M96 210V128A84 84 0 0 1 264 128V210Z" className="fill-sprout stroke-ink" strokeWidth="2" />
          <path d="M112 210V128A68 68 0 0 1 248 128V210Z" className="fill-forest stroke-ink" strokeWidth="2" />
        </svg>
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2">{children}</div>
      </div>
    </div>
  )
}
