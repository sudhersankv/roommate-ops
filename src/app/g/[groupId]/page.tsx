import { currentMember } from "@/lib/session"
import { personality } from "@/services"
import { recentDocumentsView, recentView, remindersView, todayView } from "./_components/data"
import { HomeScreen, RemindersComingUp } from "./_components/screens/home"
import { homeMood, homeSections } from "./_components/sections"

// Home = Roomie in the doorway (the Group's mood) + Today (the morning Bundle's lines + your Reminders due today) +
// Recent documents (when any) + each enabled Toolkit's Home section (from its manifest) + core's Reminders coming up
// + Recent (the newest Activity: what, who, when).
export default async function GroupHomePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  const reminders = await remindersView(s)
  const [recent, sections, today, documents, groupMood] = await Promise.all([
    recentView(s),
    homeSections(s),
    todayView(s, reminders),
    recentDocumentsView(s),
    personality.groupMood(s.ctx).catch(() => null),
  ])
  const mood = groupMood ?? { mood: await homeMood(s), reason: null }
  return (
    <HomeScreen mood={mood.mood} moodReason={mood.reason} recent={recent} today={today} documents={documents}>
      {sections}
      <RemindersComingUp reminders={reminders} />
    </HomeScreen>
  )
}
