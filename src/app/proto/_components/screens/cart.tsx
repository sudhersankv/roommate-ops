"use client"

import { useState } from "react"
import { CheckIcon, ShoppingCart, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { ME, recipe, type CartItem } from "../../_data"
import { dueLabel } from "../../_lib/dates"
import { centsToInput, formatMoney, parseMoney, splitByWeights } from "../../_lib/money"
import { useMemberName, useStore } from "../../_lib/store"
import { Amount } from "../money-bits"
import { PageHeader, TopBar } from "../shell"

export function CartScreen() {
  const { state, addCartItem } = useStore()
  const [name, setName] = useState("")
  const [shared, setShared] = useState(true)
  const [paying, setPaying] = useState(false)
  const total = state.cart.reduce((a, c) => a + c.estCents, 0)
  const sharedItems = state.cart.filter((c) => c.shared)
  const personal = state.cart.filter((c) => !c.shared)

  const add = () => {
    const clean = name.trim()
    if (!clean) return
    addCartItem({ name: clean.charAt(0).toUpperCase() + clean.slice(1), addedBy: ME, shared, estCents: 399 })
    setName("")
    toast.add({ title: `Added ${clean}`, description: shared ? "Shared, so it's split evenly." : "Personal, so it's on you." })
  }

  return (
    <>
      <TopBar title="Cart" />
      <PageHeader title="Cart">
        <p className="type-body text-muted-foreground">
          {state.cart.length ? (
            <>
              About <Amount cents={total} className="font-semibold text-foreground" /> for {state.cart.length} {state.cart.length === 1 ? "thing" : "things"}.
            </>
          ) : (
            "Nothing to buy right now."
          )}
        </p>
      </PageHeader>

      <div className="flex flex-col gap-8 px-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <InputGroup>
            <InputGroupInput aria-label="Add to the Cart" placeholder="Add to the Cart…" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="submit" variant="default" size="sm" disabled={!name.trim()}>
                Add
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="shared">Shared with the group</FieldLabel>
              <FieldDescription>Shared things are split evenly. Personal ones go to whoever added them.</FieldDescription>
            </FieldContent>
            <Switch id="shared" checked={shared} onCheckedChange={setShared} />
          </Field>
        </form>

        {state.cart.length === 0 ? (
          <Empty className="rounded-3xl bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShoppingCart />
              </EmptyMedia>
              <EmptyTitle>The Cart is empty</EmptyTitle>
              <EmptyDescription>Add something above, or say “roomie add oat milk” in the chat.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <CartGroup title="Shared" note="Split evenly between everyone" items={sharedItems} />
            <CartGroup title="Personal" note="Charged to whoever wants it" items={personal} />
            <div className="flex flex-col gap-2">
              <Button size="lg" onClick={() => setPaying(true)}>
                I paid for these
              </Button>
              <Button size="lg" variant="outline" disabled aria-describedby="instacart-hint">
                Get Instacart link
              </Button>
              <p id="instacart-hint" className="type-caption text-center text-muted-foreground">
                Coming soon. Roomie will turn the Cart into an Instacart list.
              </p>
            </div>
          </>
        )}

        <RecipeCard />
      </div>
      <PaidDrawer open={paying} onOpenChange={setPaying} />
    </>
  )
}

function CartGroup({ title, note, items }: { title: string; note: string; items: CartItem[] }) {
  const { removeCartItem } = useStore()
  const name = useMemberName()
  if (items.length === 0) return null
  return (
    <section aria-labelledby={`cart-${title}`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 id={`cart-${title}`} className="type-heading">
          {title}
        </h2>
        <span className="type-caption text-muted-foreground">{note}</span>
      </div>
      <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
        {items.map((c) => (
          <Item key={c.id} className="py-2 pr-1.5">
            <ItemContent className="min-w-0">
              <ItemTitle className="truncate">
                {c.name}
                {c.qty ? <span className="font-normal text-muted-foreground">{c.qty}</span> : null}
              </ItemTitle>
              <ItemDescription>{c.shared ? `Added by ${name(c.addedBy) === "You" ? "you" : name(c.addedBy)}` : `For ${name(c.addedBy) === "You" ? "you" : name(c.addedBy)}`}</ItemDescription>
            </ItemContent>
            <ItemActions className="gap-1">
              <Amount cents={c.estCents} className="type-body text-muted-foreground" />
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.name}`} onClick={() => removeCartItem(c.id)}>
                <XIcon />
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </section>
  )
}

function RecipeCard() {
  const { state, addIngredients } = useStore()
  const inCart = new Set(state.cart.map((c) => c.name.toLowerCase()))
  const missing = recipe.ingredients.filter((i) => !inCart.has(i.name.toLowerCase()))
  return (
    <Card className="rounded-3xl">
      <CardHeader>
        <CardTitle className="type-heading">{recipe.title}</CardTitle>
        <CardDescription>
          For {dueLabel(recipe.forDay)}. Roomie scaled it for {recipe.servings} people in the chat.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col">
          {recipe.ingredients.map((i) => {
            const have = inCart.has(i.name.toLowerCase())
            return (
              <li key={i.name} className="type-body flex items-center gap-3 border-b py-2 last:border-b-0">
                <span className="flex size-5 items-center justify-center text-owed" aria-hidden>
                  {have ? <CheckIcon className="size-4" /> : null}
                </span>
                <span className="flex-1">{i.name}</span>
                <span className="text-muted-foreground">{i.qty}</span>
                {have ? <span className="sr-only">(in the Cart)</span> : null}
              </li>
            )
          })}
        </ul>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2">
        <Button
          disabled={missing.length === 0}
          onClick={() => {
            addIngredients(missing.map((i) => ({ name: i.name, qty: i.qty, addedBy: ME, shared: true, estCents: i.estCents })))
            toast.add({ title: `Added ${missing.length} ingredients`, description: `Shared, about ${formatMoney(missing.reduce((a, i) => a + i.estCents, 0))}.`, type: "success" })
          }}
        >
          {missing.length === 0 ? "All in the Cart" : "Add ingredients to cart"}
        </Button>
      </CardFooter>
    </Card>
  )
}

/** "I paid $X": previews the Expense split by who wanted what, scaled from estimates to the real total. */
function PaidDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md">{open ? <PaidForm onDone={() => onOpenChange(false)} /> : null}</DrawerContent>
    </Drawer>
  )
}

function PaidForm({ onDone }: { onDone: () => void }) {
  const { state, checkoutCart } = useStore()
  const name = useMemberName()
  const est = state.cart.reduce((a, c) => a + c.estCents, 0)
  const [amount, setAmount] = useState(centsToInput(est))
  const paid = parseMoney(amount)
  const people = state.members.filter((m) => m.status === "active").map((m) => m.id)

  // Each person's estimated part: their personal things plus an even cut of the shared ones.
  const sharedEst = state.cart.filter((c) => c.shared).reduce((a, c) => a + c.estCents, 0)
  const sharedCut = Object.fromEntries(splitByWeights(sharedEst, people, people.map(() => 1)).map((s) => [s.memberId, s.cents]))
  const estOf = (id: string) => (sharedCut[id] ?? 0) + state.cart.filter((c) => !c.shared && c.addedBy === id).reduce((a, c) => a + c.estCents, 0)
  const weights = people.map(estOf)
  const shares = paid && paid > 0 ? splitByWeights(paid, people, weights) : []

  return (
    <>
      <DrawerHeader>
        <DrawerTitle className="type-heading">You paid for the Cart</DrawerTitle>
        <DrawerDescription>
          Roomie splits the receipt by who wanted what, scaled from the estimates to what you paid.
        </DrawerDescription>
      </DrawerHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <Field data-invalid={paid === null || paid <= 0 ? true : undefined}>
          <FieldLabel htmlFor="paid">Receipt total</FieldLabel>
          <InputGroup className="h-14">
            <InputGroupAddon>
              <InputGroupText className="type-heading">$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput id="paid" inputMode="decimal" className="type-title money" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={paid === null || paid <= 0 ? true : undefined} />
          </InputGroup>
          <FieldDescription>The estimate was {formatMoney(est)}.</FieldDescription>
        </Field>
        <ItemGroup className="gap-0 rounded-3xl border py-1">
          {people.map((id) => {
            const mine = state.cart.filter((c) => !c.shared && c.addedBy === id).map((c) => c.name)
            return (
              <Item key={id} className="py-2.5">
                <ItemContent>
                  <ItemTitle>{name(id)}</ItemTitle>
                  <ItemDescription>{mine.length ? `Shared things, plus ${mine.join(" and ").toLowerCase()}` : "Shared things only"}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Amount cents={shares.find((s) => s.memberId === id)?.cents ?? 0} className="type-heading" />
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      </div>
      <DrawerFooter className="border-t pt-4">
        <Button
          size="lg"
          disabled={!paid || paid <= 0}
          onClick={() => {
            if (!paid) return
            checkoutCart({
              description: "Groceries",
              category: "groceries",
              date: "2026-10-28",
              cents: paid,
              payers: [{ memberId: ME, cents: paid }],
              split: { method: "exact", members: people, values: Object.fromEntries(shares.map((s) => [s.memberId, s.cents])) },
              addedBy: ME,
              note: "Split by who wanted what in the Cart.",
            })
            toast.add({ title: "Groceries added", description: `${formatMoney(paid)}, split by who wanted what. The Cart is clear.`, type: "success" })
            onDone()
          }}
        >
          Add as expense
        </Button>
        <DrawerClose render={<Button variant="ghost" size="lg" />}>Cancel</DrawerClose>
      </DrawerFooter>
    </>
  )
}
