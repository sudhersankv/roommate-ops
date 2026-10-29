// Settings -> Personality, self-contained: mount it anywhere in a Group's Settings with
//   <PersonalitySection groupId={groupId} />
// It reads the session itself (Admins get the controls; everyone sees the vibe, the preview and what's learned) and
// writes through ./personality-actions.ts, which checks the role again.
import { memberSession } from "@/lib/session"
import { personality } from "@/services"
import { PersonalityPanel } from "./personality-panel"

export async function PersonalitySection({ groupId }: { groupId: string }) {
  const s = await memberSession(groupId)
  if (!s) return null
  const p = await personality.getPersonality({ groupId })
  return <PersonalityPanel groupId={groupId} initial={p} isAdmin={s.member.role === "admin" && s.member.status === "active"} timezone={s.group.timezone} />
}
