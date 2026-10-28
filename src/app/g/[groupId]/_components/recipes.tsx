"use client"

// The Cart page's Recipes (cards, the detail drawer, "New recipe") and the Pantry. Everything goes through the
// server actions; have / need and the Instacart link come from services/recipes.ts.
import { Fragment, useState, useTransition } from "react"
import { ChefHat, PlusIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { formatAmount } from "@/lib/units"
import { addRecipeToCart, draftRecipe, recipeInstacartLink, saveRecipe, updatePantry } from "../actions"
import { useGroup } from "./group-context"
import type { RecipeDraftView, RecipeView } from "./types"

const amountOf = (i: { quantity: number; unit: string }) => formatAmount(i.quantity, i.unit)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function RecipesSection({ recipes, pantry, instacartReady, openRecipeId }: { recipes: RecipeView[]; pantry: string[]; instacartReady: boolean; openRecipeId: string | null }) {
  const [openId, setOpenId] = useState<string | null>(recipes.some((r) => r.id === openRecipeId) ? openRecipeId : null)
  const [creating, setCreating] = useState(false)
  const open = recipes.find((r) => r.id === openId) ?? null
  return (
    <section aria-labelledby="recipes-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <h2 id="recipes-title" className="type-heading">
          Recipes
        </h2>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <PlusIcon data-icon="inline-start" />
          New recipe
        </Button>
      </div>
      {recipes.length === 0 ? (
        <Empty className="rounded-3xl bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChefHat />
            </EmptyMedia>
            <EmptyTitle>No recipes yet</EmptyTitle>
            <EmptyDescription>Ask for “tacos for 5 friday” here or in the chat. Roomie scales it for everyone eating.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        recipes.map((r) => <RecipeCard key={r.id} recipe={r} onOpen={() => setOpenId(r.id)} />)
      )}
      <RecipeDrawer recipe={open} instacartReady={instacartReady} onOpenChange={(o) => !o && setOpenId(null)} />
      <NewRecipeDrawer open={creating} onOpenChange={setCreating} pantry={pantry} />
    </section>
  )
}

function forWhen(r: RecipeView, dueLabel: (iso: string) => string) {
  const people = `${r.servings} ${r.servings === 1 ? "person" : "people"}`
  return r.plannedFor ? `For ${dueLabel(r.plannedFor)}. Scaled for ${people}.` : `Scaled for ${people}.`
}

function useAddToCart(recipeId: string) {
  const { group, cheer } = useGroup()
  const [pending, start] = useTransition()
  const add = () =>
    start(async () => {
      const res = await addRecipeToCart(group.id, recipeId)
      if (!res.ok) return void toast.add({ title: "Couldn't add them", description: res.error, type: "error" })
      if (!res.data) return void toast.add({ title: "Already covered", description: "Everything it needs is in the Cart or the Pantry." })
      cheer()
      toast.add({ title: `Added ${res.data} ${res.data === 1 ? "ingredient" : "ingredients"}`, description: "Shared, minus what's in the Pantry.", type: "success" })
    })
  return { add, pending }
}

function RecipeCard({ recipe, onOpen }: { recipe: RecipeView; onOpen: () => void }) {
  const { dates } = useGroup()
  const { add, pending } = useAddToCart(recipe.id)
  const need = recipe.ingredients.filter((i) => !i.have).length
  const allIn = recipe.inCart >= need
  return (
    <Card className="rounded-3xl">
      <CardHeader>
        <CardTitle className="type-heading">{recipe.title}</CardTitle>
        <CardDescription>{forWhen(recipe, dates.dueLabel)}</CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup className="gap-0">
          {recipe.ingredients.map((i, k) => (
            <Fragment key={`${i.name}-${k}`}>
              {k > 0 ? <ItemSeparator /> : null}
              <Item size="sm" className="px-0">
                <ItemContent className="min-w-0">
                  <ItemTitle className="truncate font-normal">{cap(i.name)}</ItemTitle>
                </ItemContent>
                <ItemActions className="gap-2">
                  {i.have ? <Badge variant="secondary">Have</Badge> : null}
                  <span className="type-body text-muted-foreground">{amountOf(i)}</span>
                </ItemActions>
              </Item>
            </Fragment>
          ))}
        </ItemGroup>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2">
        <Button disabled={pending || allIn} onClick={add}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {allIn ? "Ingredients are in the Cart" : "Add ingredients to cart"}
        </Button>
        <Button variant="ghost" onClick={onOpen}>
          Steps and Instacart
        </Button>
      </CardFooter>
    </Card>
  )
}

function RecipeDrawer({ recipe, instacartReady, onOpenChange }: { recipe: RecipeView | null; instacartReady: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Drawer open={!!recipe} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md">{recipe ? <RecipeDetail recipe={recipe} instacartReady={instacartReady} /> : null}</DrawerContent>
    </Drawer>
  )
}

function RecipeDetail({ recipe, instacartReady }: { recipe: RecipeView; instacartReady: boolean }) {
  const { group, dates } = useGroup()
  const [linking, start] = useTransition()
  const { add, pending } = useAddToCart(recipe.id)
  const open = () =>
    start(async () => {
      const res = await recipeInstacartLink(group.id, recipe.id)
      if (!res.ok) return void toast.add({ title: "Couldn't make the link", description: res.error, type: "error" })
      if (!res.data?.url) return void toast.add({ title: "Instacart isn't available", description: res.data?.unavailable ?? undefined, type: "error" })
      window.open(res.data.url, "_blank", "noopener")
    })
  return (
    <>
      <DrawerHeader>
        <DrawerTitle className="type-heading">{recipe.title}</DrawerTitle>
        <DrawerDescription>
          {forWhen(recipe, dates.dueLabel)}
          {recipe.cookingTimeMinutes ? ` About ${recipe.cookingTimeMinutes} minutes.` : ""}
        </DrawerDescription>
      </DrawerHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <section aria-labelledby="recipe-ingredients" className="flex flex-col gap-2">
          <h3 id="recipe-ingredients" className="type-heading">
            Ingredients
          </h3>
          <ItemGroup className="gap-0 rounded-3xl border py-1">
            {recipe.ingredients.map((i, k) => (
              <Item key={`${i.name}-${k}`} size="sm">
                <ItemContent className="min-w-0">
                  <ItemTitle className="font-normal">{i.text}</ItemTitle>
                </ItemContent>
                {i.have ? (
                  <ItemActions>
                    <Badge variant="secondary">Have</Badge>
                  </ItemActions>
                ) : null}
              </Item>
            ))}
          </ItemGroup>
        </section>
        <section aria-labelledby="recipe-steps" className="flex flex-col gap-2">
          <h3 id="recipe-steps" className="type-heading">
            Steps
          </h3>
          <ol className="type-body flex list-decimal flex-col gap-2 pl-5">
            {recipe.steps.map((s, k) => (
              <li key={k}>{s}</li>
            ))}
          </ol>
        </section>
      </div>
      <DrawerFooter className="border-t pt-4">
        <Button size="lg" disabled={!instacartReady || linking} onClick={open} aria-describedby={instacartReady ? undefined : "recipe-instacart-hint"}>
          {linking ? <Spinner data-icon="inline-start" /> : null}
          Open in Instacart
        </Button>
        {instacartReady ? null : (
          <p id="recipe-instacart-hint" className="type-caption text-center text-muted-foreground">
            The Instacart link isn&apos;t available yet.
          </p>
        )}
        <Button size="lg" variant="outline" disabled={pending} onClick={add}>
          Add ingredients to cart
        </Button>
        <DrawerClose render={<Button variant="ghost" size="lg" />}>Close</DrawerClose>
      </DrawerFooter>
    </>
  )
}

function NewRecipeDrawer({ open, onOpenChange, pantry }: { open: boolean; onOpenChange: (o: boolean) => void; pantry: string[] }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md">{open ? <NewRecipe pantry={pantry} onDone={() => onOpenChange(false)} /> : null}</DrawerContent>
    </Drawer>
  )
}

function NewRecipe({ pantry, onDone }: { pantry: string[]; onDone: () => void }) {
  const { group, active, cheer } = useGroup()
  const [request, setRequest] = useState("")
  const [servings, setServings] = useState(String(active.length || 2))
  const [draft, setDraft] = useState<RecipeDraftView | null>(null)
  const [writing, startWrite] = useTransition()
  const [saving, startSave] = useTransition()
  const n = Number(servings)
  const servingsOk = Number.isInteger(n) && n > 0 && n <= 100

  const write = () =>
    startWrite(async () => {
      const res = await draftRecipe(group.id, { request: request.trim(), servings: n })
      if (!res.ok) return void toast.add({ title: "Couldn't write it", description: res.error, type: "error" })
      setDraft(res.data ?? null)
    })

  const save = (addToCart: boolean) =>
    startSave(async () => {
      if (!draft) return
      const res = await saveRecipe(group.id, draft, { addToCart })
      if (!res.ok) return void toast.add({ title: "Couldn't save it", description: res.error, type: "error" })
      cheer()
      toast.add({ title: `Saved ${draft.title}`, description: addToCart ? `${res.data?.added ?? 0} ingredients went into the Cart.` : "It's in Recipes. The Cart is untouched.", type: "success" })
      onDone()
    })

  return (
    <>
      <DrawerHeader>
        <DrawerTitle className="type-heading">{draft ? draft.title : "New recipe"}</DrawerTitle>
        <DrawerDescription>
          {draft ? `Serves ${draft.servings}${draft.cookingTimeMinutes ? `, about ${draft.cookingTimeMinutes} minutes` : ""}. ${draft.steps.length} steps.` : "Tell Roomie what you're making. It writes it for everyone eating, and leaves the Pantry off the shopping list."}
        </DrawerDescription>
      </DrawerHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {draft ? (
          <>
            <IngredientList title="Need" names={draft.ingredients.filter((i) => draft.need.includes(i.name))} />
            {draft.have.length ? <IngredientList title="Have" names={draft.ingredients.filter((i) => draft.have.includes(i.name))} note="In the Pantry, so they stay off the Cart." /> : null}
          </>
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="recipe-request">What are you making?</FieldLabel>
              <Textarea id="recipe-request" placeholder="Tacos on Friday, nothing too spicy" value={request} onChange={(e) => setRequest(e.target.value)} />
            </Field>
            <Field data-invalid={servingsOk ? undefined : true}>
              <FieldLabel htmlFor="recipe-servings">How many people</FieldLabel>
              <Input id="recipe-servings" inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value)} aria-invalid={servingsOk ? undefined : true} />
              <FieldDescription>{pantry.length ? `Pantry: ${pantry.join(", ")}.` : "Nothing in the Pantry yet."}</FieldDescription>
            </Field>
          </FieldGroup>
        )}
      </div>
      <DrawerFooter className="border-t pt-4">
        {draft ? (
          <>
            <Button size="lg" disabled={saving || draft.need.length === 0} onClick={() => save(true)}>
              {saving ? <Spinner data-icon="inline-start" /> : null}
              Save and add {draft.need.length} to cart
            </Button>
            <Button size="lg" variant="outline" disabled={saving} onClick={() => save(false)}>
              Save recipe
            </Button>
            <Button size="lg" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
              Start over
            </Button>
          </>
        ) : (
          <>
            <Button size="lg" disabled={!request.trim() || !servingsOk || writing} onClick={write}>
              {writing ? <Spinner data-icon="inline-start" /> : null}
              {writing ? "Writing it…" : "Write it"}
            </Button>
            <DrawerClose render={<Button variant="ghost" size="lg" />}>Cancel</DrawerClose>
          </>
        )}
      </DrawerFooter>
    </>
  )
}

function IngredientList({ title, names, note }: { title: string; names: { name: string; quantity: number; unit: string }[]; note?: string }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h3 className="type-heading">{title}</h3>
        {note ? <span className="type-caption text-muted-foreground">{note}</span> : null}
      </div>
      <ItemGroup className="gap-0 rounded-3xl border py-1">
        {names.map((i, k) => (
          <Item key={`${i.name}-${k}`} size="sm">
            <ItemContent className="min-w-0">
              <ItemTitle className="truncate font-normal">{cap(i.name)}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <span className="type-body text-muted-foreground">{amountOf(i)}</span>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </section>
  )
}

/** What the Group always has. Any active Member can change it. */
export function PantryCard({ pantry }: { pantry: string[] }) {
  const { group } = useGroup()
  const [name, setName] = useState("")
  const [pending, start] = useTransition()
  const change = (c: { add?: string[]; remove?: string[] }) =>
    start(async () => {
      const res = await updatePantry(group.id, c)
      if (!res.ok) return void toast.add({ title: "Couldn't change the Pantry", description: res.error, type: "error" })
      setName("")
    })
  return (
    <Card className="rounded-3xl">
      <CardHeader>
        <CardTitle className="type-heading">Pantry</CardTitle>
        <CardDescription>Things you always have. Recipes leave them off the Cart.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {pantry.length ? (
          <ul aria-label="Pantry" className="flex flex-wrap gap-2">
            {pantry.map((p) => (
              <li key={p}>
                <Button size="xs" variant="secondary" disabled={pending} aria-label={`Take ${p} out of the Pantry`} onClick={() => change({ remove: [p] })}>
                  {cap(p)}
                  <XIcon data-icon="inline-end" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-body text-muted-foreground">Nothing yet. Salt, oil and rice are a good start.</p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) change({ add: name.split(",").map((s) => s.trim()).filter(Boolean) })
          }}
        >
          <InputGroup>
            <InputGroupInput aria-label="Add to the Pantry" placeholder="Add to the Pantry…" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="submit" size="sm" variant="secondary" disabled={!name.trim() || pending}>
                Add
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </CardContent>
    </Card>
  )
}
