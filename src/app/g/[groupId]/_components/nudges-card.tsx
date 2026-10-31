// Settings' Nudges card (issue #28 story 25, ADR 0017: the private Settle nudge's on/off and threshold). A slot for
// now: it renders nothing until #25 adds the nudges service (read: on + threshold; write: an Admin's update). Then
// this reads it through _components/data.ts and renders a client card with the existing settings look.
import type { GroupSession } from "@/lib/session"

export async function NudgesCard(_props: { session: GroupSession; isAdmin: boolean }) {
  return null
}
