import { currentMember } from "@/lib/session"
import { personality } from "@/services"
import { balancesView, cartView, choresView, narrationView, nextRecipeView } from "./_components/data"
import { HomeScreen } from "./_components/screens/home"

export default async function GroupHomePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  const [money, chores, cart, narration, nextRecipe, mood] = await Promise.all([
    balancesView(s),
    choresView(s),
    cartView(s),
    narrationView(s),
    nextRecipeView(s),
    personality.groupMood(s.ctx),
  ])
  return <HomeScreen you={money.you} plan={money.plan} chores={chores.chores} cart={cart} narration={narration} nextRecipe={nextRecipe} mood={mood} />
}
