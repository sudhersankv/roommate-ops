// Settings -> "Reset what it's learned" (ADR 0020): the one Personality control that stays. Admins only; mount it
// anywhere in a Group's Settings with <LearnedReset groupId={groupId} />. It reads the session itself and writes
// through ./learned-reset-actions.ts, which checks the role again.
import { memberSession } from "@/lib/session"
import { personality } from "@/services"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { ResetLearnedButton } from "./learned-reset-button"

export async function LearnedReset({ groupId }: { groupId: string }) {
  const s = await memberSession(groupId)
  if (!s || s.member.role !== "admin" || s.member.status !== "active") return null
  const { learned } = await personality.getPersonality({ groupId })
  return (
    <FieldSet>
      <FieldLegend className="type-heading">What it&apos;s learned</FieldLegend>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="reset-learned">{learned.messagesSeen ? `Settled in over ${learned.messagesSeen} messages` : "Nothing yet"}</FieldLabel>
          <FieldDescription>Roomie settles in over time. If it picked up something it shouldn&apos;t have, start it over.</FieldDescription>
        </FieldContent>
        <ResetLearnedButton groupId={groupId} disabled={!learned.messagesSeen} />
      </Field>
    </FieldSet>
  )
}
