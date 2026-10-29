import { currentMember } from "@/lib/session"
import { balancesView, cartView, choresView, narrationView, nextRecipeView } from "./_components/data"
import { HomeScreen } from "./_components/screens/home"

export default async function GroupHomePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  const [money, chores, cart, narration, nextRecipe] = await Promise.all([balancesView(s), choresView(s), cartView(s), narrationView(s), nextRecipeView(s)])
  return <HomeScreen you={money.you} plan={money.plan} chores={chores.chores} upkeep={chores.upkeep} cart={cart} narration={narration} nextRecipe={nextRecipe} />
}
