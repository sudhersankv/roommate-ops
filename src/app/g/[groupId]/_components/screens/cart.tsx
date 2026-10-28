"use client"

import { useState, useTransition } from "react"
import { ShoppingCart, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { Amount, useFormatMoney } from "@/components/app/money-bits"
import { centsToInput, currencySymbol, parseMoney, splitByWeights } from "@/lib/money"
import { addCartItem, purchaseCart, removeCartItem } from "../../actions"
import { useGroup } from "../group-context"
import { PageHeader, TopBar } from "../shell"
import type { CartItemView } from "../types"

export function CartScreen({ items }: { items: CartItemView[] }) {
  const { group } = useGroup()
  const [name, setName] = useState("")
  const [shared, setShared] = useState(true)
  const [paying, setPaying] = useState(false)
  const [pending, start] = useTransition()
  const total = items.reduce((a, c) => a + c.estCents, 0)
  const sharedItems = items.filter((c) => c.shared)
  const personal = items.filter((c) => !c.shared)

  const add = () => {
    const clean = name.trim()
    if (!clean) return
    start(async () => {
      const res = await addCartItem(group.id, { name: clean.charAt(0).toUpperCase() + clean.slice(1), shared })
      if (!res.ok) return void toast.add({ title: "Couldn't add it", description: res.error, type: "error" })
      setName("")
      toast.add({ title: `Added ${clean}`, description: shared ? "Shared, so it's split evenly." : "Personal, so it's on you." })
    })
  }

  return (
    <>
      <TopBar title="Cart" />
      <PageHeader title="Cart">
        <p className="type-body text-muted-foreground">
          {items.length ? (
            <>
              About <Amount cents={total} className="font-semibold text-foreground" /> for {items.length} {items.length === 1 ? "thing" : "things"}.
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
              <InputGroupButton type="submit" variant="default" size="sm" disabled={!name.trim() || pending}>
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

        {items.length === 0 ? (
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
      <PaidDrawer open={paying} onOpenChange={setPaying} items={items} />
    </>
  )
}

function CartGroup({ title, note, items }: { title: string; note: string; items: CartItemView[] }) {
  const { group, name } = useGroup()
  const [pending, start] = useTransition()
  if (items.length === 0) return null
  const remove = (c: CartItemView) =>
    start(async () => {
      const res = await removeCartItem(group.id, c.id)
      if (!res.ok) toast.add({ title: "Couldn't remove it", description: res.error, type: "error" })
    })
  const who = (id: string) => (name(id) === "You" ? "you" : name(id))
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
              <ItemDescription>{c.shared ? `Added by ${who(c.addedBy)}` : `For ${who(c.addedBy)}`}</ItemDescription>
            </ItemContent>
            <ItemActions className="gap-1">
              <Amount cents={c.estCents} className="type-body text-muted-foreground" />
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.name}`} disabled={pending} onClick={() => remove(c)}>
                <XIcon />
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </section>
  )
}

/** Recipes arrive with the Groceries Toolkit (step 6); the card shows where they'll live. */
function RecipeCard() {
  return (
    <Card className="rounded-3xl">
      <CardHeader>
        <CardTitle className="type-heading flex items-center gap-2">
          Recipes <Badge variant="secondary">Coming soon</Badge>
        </CardTitle>
        <CardDescription>Ask Roomie for “tacos for 5 friday” and the recipe shows up here, scaled for everyone eating.</CardDescription>
      </CardHeader>
      <CardFooter className="flex-col items-stretch gap-2">
        <Button disabled>Add ingredients to cart</Button>
      </CardFooter>
    </Card>
  )
}

/** "I paid $X": previews the Expense split by who wanted what, scaled from estimates to the real total. */
function PaidDrawer({ open, onOpenChange, items }: { open: boolean; onOpenChange: (o: boolean) => void; items: CartItemView[] }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md">{open ? <PaidForm items={items} onDone={() => onOpenChange(false)} /> : null}</DrawerContent>
    </Drawer>
  )
}

function PaidForm({ items, onDone }: { items: CartItemView[]; onDone: () => void }) {
  const { group, active, name, cheer } = useGroup()
  const money = useFormatMoney()
  const [pending, start] = useTransition()
  const est = items.reduce((a, c) => a + c.estCents, 0)
  const [amount, setAmount] = useState(centsToInput(est))
  const paid = parseMoney(amount)
  const people = active.map((m) => m.id)

  // Each person's estimated part: their personal things plus an even cut of the shared ones.
  const sharedEst = items.filter((c) => c.shared).reduce((a, c) => a + c.estCents, 0)
  const sharedCut = Object.fromEntries(splitByWeights(sharedEst, people, people.map(() => 1)).map((s) => [s.memberId, s.cents]))
  const estOf = (id: string) => (sharedCut[id] ?? 0) + items.filter((c) => !c.shared && c.addedBy === id).reduce((a, c) => a + c.estCents, 0)
  const shares = paid && paid > 0 ? splitByWeights(paid, people, people.map(estOf)) : []

  const save = () =>
    start(async () => {
      if (!paid) return
      const res = await purchaseCart(group.id, paid)
      if (!res.ok) return void toast.add({ title: "Couldn't add it", description: res.error, type: "error" })
      cheer()
      toast.add({ title: "Groceries added", description: `${money(paid)}, split by who wanted what. The Cart is clear.`, type: "success" })
      onDone()
    })

  return (
    <>
      <DrawerHeader>
        <DrawerTitle className="type-heading">You paid for the Cart</DrawerTitle>
        <DrawerDescription>Roomie splits the receipt by who wanted what, scaled from the estimates to what you paid.</DrawerDescription>
      </DrawerHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <Field data-invalid={paid === null || paid <= 0 ? true : undefined}>
          <FieldLabel htmlFor="paid">Receipt total</FieldLabel>
          <InputGroup className="h-14">
            <InputGroupAddon>
              <InputGroupText className="type-heading">{currencySymbol(group.currency)}</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput id="paid" inputMode="decimal" className="type-title money" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={paid === null || paid <= 0 ? true : undefined} />
          </InputGroup>
          <FieldDescription>The estimate was {money(est)}.</FieldDescription>
        </Field>
        <ItemGroup className="gap-0 rounded-3xl border py-1">
          {people.map((id) => {
            const mine = items.filter((c) => !c.shared && c.addedBy === id).map((c) => c.name)
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
        <Button size="lg" disabled={!paid || paid <= 0 || pending} onClick={save}>
          Add as expense
        </Button>
        <DrawerClose render={<Button variant="ghost" size="lg" />}>Cancel</DrawerClose>
      </DrawerFooter>
    </>
  )
}
