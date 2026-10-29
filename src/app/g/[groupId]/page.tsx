import { currentMember } from "@/lib/session"
import { narrationView } from "./_components/data"
import { HomeScreen } from "./_components/screens/home"
import { homeMood, homeSections } from "./_components/sections"

// Home = Roomie in the doorway + each enabled Toolkit's Home section (from its manifest) + what Roomie said lately.
export default async function GroupHomePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  const [narration, sections, mood] = await Promise.all([narrationView(s), homeSections(s), homeMood(s)])
  return (
    <HomeScreen mood={mood} narration={narration}>
      {sections}
    </HomeScreen>
  )
}
