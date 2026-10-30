import { currentMember } from "@/lib/session"
import { personality } from "@/services"
import { narrationView, remindersView } from "./_components/data"
import { HomeScreen, RemindersToday } from "./_components/screens/home"
import { homeMood, homeSections } from "./_components/sections"

// Home = Roomie in the doorway (the Group's mood) + each enabled Toolkit's Home section (from its manifest) + core's
// Reminders + what Roomie said lately.
export default async function GroupHomePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  const [narration, sections, reminders, groupMood] = await Promise.all([narrationView(s), homeSections(s), remindersView(s), personality.groupMood(s.ctx).catch(() => null)])
  const mood = groupMood ?? { mood: await homeMood(s), reason: null }
  return (
    <HomeScreen mood={mood.mood} moodReason={mood.reason} narration={narration}>
      {sections}
      <RemindersToday reminders={reminders} />
    </HomeScreen>
  )
}
