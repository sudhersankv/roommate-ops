// A Toolkit's icon by its lucide name (the manifest's `icon`). Server-only on purpose: it indexes every lucide
// icon, so server components render it and hand the element to client code (nav, marketplace cards).
import { icons } from "lucide-react"

import type { IconName } from "@/toolkits/types"

export function ToolkitIcon({ name, className }: { name: IconName; className?: string }) {
  const Icon = icons[name] ?? icons.Sparkles
  return <Icon className={className} aria-hidden />
}
