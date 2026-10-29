// Groceries' dashboard sections (server components; the agent runtime never loads this file).
import { cartView, nextRecipeView } from "@/app/g/[groupId]/_components/data"
import { PantryCard } from "@/app/g/[groupId]/_components/recipes"
import { CartToday } from "@/app/g/[groupId]/_components/screens/home"
import { pantry } from "@/services"
import type { ToolkitSectionCtx } from "../types"

export async function GroceriesHome({ ctx }: { ctx: ToolkitSectionCtx }) {
  const [cart, nextRecipe] = await Promise.all([cartView(ctx.session), nextRecipeView(ctx.session)])
  return <CartToday cart={cart} nextRecipe={nextRecipe} />
}

/** The Pantry: any active Member can change it. */
export async function GroceriesSettings({ ctx }: { ctx: ToolkitSectionCtx }) {
  return (
    <section aria-label="Groceries" className="flex flex-col gap-3">
      <h2 className="type-heading">Groceries</h2>
      <PantryCard pantry={await pantry.getPantry(ctx.session.ctx)} />
    </section>
  )
}
