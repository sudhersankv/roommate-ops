// Settings' Nudges card (#25, ADR 0017/0021): the private Settle nudge's on/off, amount and spacing, for Admins. Reads
// services/settle-nudge.ts through _components/data.ts; the form (nudges-form.tsx) saves through updateNudges.
import type { GroupSession } from "@/lib/session"
import { nudgeSettingsView } from "./data"
import { NudgesForm } from "./nudges-form"

export async function NudgesCard({ session, isAdmin }: { session: GroupSession; isAdmin: boolean }) {
  if (!isAdmin) return null
  return <NudgesForm initial={await nudgeSettingsView(session)} />
}
