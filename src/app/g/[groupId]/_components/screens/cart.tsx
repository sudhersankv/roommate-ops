"use client"

import { useState, useTransition } from "react"
import { ShoppingCart, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { Amount, useFormatMoney } from "@/components/app/money-bits"
import { currencySymbol, parseMoney } from "@/lib/money"
import { computeCartSplits } from "@/services/cart-split"
import { addCartItem, addProbablyLow, checkoutCart, muteProbablyLow, purchaseCart, removeCartItem } from "../../actions"
import { useGroup } from "../group-context"
import { PantryCard, RecipesSection } from "../recipes"
import { PageHeader, TopBar } from "../shell"
import type { CartItemView, CartPageView, ProbablyLowView } from "../types"

export function CartScreen({ view, openRecipeId }: { view: CartPageView; openRecipeId: string | null }) {
  const { group } = useGroup()
  const { items } = view
  const [name, setName] = useState("")
  const [qty, setQty] = useState("")
  const [shared, setShared] = useState(true)
  const [paying, setPaying] = useState(false)
  const [pending, start] = useTransition()
  const [linking, startLink] = useTransition()

  const add = () => {
    const clean = name.trim()
    if (!clean) return
    start(async () => {
      const res = await addCartItem(group.id, { name: clean.charAt(0).toUpperCase() + clean.slice(1), qty: qty.trim() || undefined, shared })
      if (!res.ok) return void toast.add({ title: "Couldn't add it", description: res.error, type: "error" })
      setName("")
      setQty("")
      toast.add({ title: `Added ${clean}`, description: shared ? "Shared, so it's split evenly." : "Personal, so it's on you." })
    })
  }

  const instacart = () =>
    startLink(async () => {
      const res = await checkoutCart(group.id)
      if (!res.ok) return void toast.add({ title: "Couldn't make the list", description: res.error, type: "error" })
      if (!res.data?.url) return void toast.add({ title: "Instacart isn't available", description: res.data?.unavailable ?? undefined, type: "error" })
      window.open(res.data.url, "_blank", "noopener")
      toast.add({ title: "Instacart list ready", description: `${res.data.itemCount} ${res.data.itemCount === 1 ? "thing" : "things"}. Tell Roomie what you paid once it's bought.` })
    })

  return (
    <>
      <TopBar title="Cart" />
      <PageHeader title="Cart">
        <p className="type-body text-muted-foreground">
          {items.length ? `${items.length} ${items.length === 1 ? "thing" : "things"} to buy.` : "Nothing to buy right now."}
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
            <InputGroupInput aria-label="How much" placeholder="Qty" autoComplete="off" className="max-w-20" value={qty} onChange={(e) => setQty(e.target.value)} />
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

        <ProbablyLowSection rows={view.probablyLow} />

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
            <CartSection title="Shared" note="Split evenly between everyone" items={items.filter((c) => c.shared)} />
            <CartSection title="Personal" note="Charged to whoever wants it" items={items.filter((c) => !c.shared)} />
            <div className="flex flex-col gap-2">
              <Button size="lg" onClick={() => setPaying(true)}>
                I paid for these
              </Button>
              <Button size="lg" variant="outline" disabled={!view.instacart.ready || linking} aria-describedby={view.instacart.ready ? undefined : "instacart-hint"} onClick={instacart}>
                {linking ? <Spinner data-icon="inline-start" /> : null}
                Get Instacart link
              </Button>
              {view.instacart.ready ? null : (
                <p id="instacart-hint" className="type-caption text-center text-muted-foreground">
                  {view.instacart.hint ?? "The Instacart link isn't available yet."}
                </p>
              )}
            </div>
          </>
        )}

        <RecipesSection recipes={view.recipes} pantry={view.pantry} instacartReady={view.instacart.ready} openRecipeId={openRecipeId} />
        <PantryCard pantry={view.pantry} />
      </div>
      <PaidDrawer open={paying} onOpenChange={setPaying} items={items} splitMemberIds={view.splitMemberIds} />
    </>
  )
}

/** What's probably low, from how often the group buys it: Add puts it in the Cart, Mute stops Roomie mentioning it. */
function ProbablyLowSection({ rows }: { rows: ProbablyLowView[] }) {
  const { group } = useGroup()
  const [pending, start] = useTransition()
  if (rows.length === 0) return null
  const add = (r: ProbablyLowView) =>
    start(async () => {
      const res = await addProbablyLow(group.id, r.item, r.scope)
      if (!res.ok) return void toast.add({ title: "Couldn't add it", description: res.error, type: "error" })
      if (!res.data?.added.length) return void toast.add({ title: `${r.item} isn't low anymore` })
      toast.add({ title: `Added ${r.item}`, description: r.scope === "shared" ? "Shared, so it's split evenly." : "Personal, so it's on you." })
    })
  const mute = (r: ProbablyLowView) =>
    start(async () => {
      const res = await muteProbablyLow(group.id, r.item)
      if (!res.ok) return void toast.add({ title: "Couldn't mute it", description: res.error, type: "error" })
      toast.add({ title: `Roomie won't mention ${r.item}`, description: "Say “actually we do buy it” to bring it back." })
    })
  return (
    <section aria-labelledby="cart-probably-low" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 id="cart-probably-low" className="type-heading">
          Probably low
        </h2>
        <span className="type-caption text-muted-foreground">From how often you buy it</span>
      </div>
      <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
        {rows.map((r) => (
          <Item key={`${r.scope}-${r.item}`} className="py-2 pr-1.5">
            <ItemContent className="min-w-0">
              <ItemTitle className="truncate">{r.item.charAt(0).toUpperCase() + r.item.slice(1)}</ItemTitle>
              <ItemDescription>
                {r.when.charAt(0).toUpperCase() + r.when.slice(1)} · {r.scope === "shared" ? "Shared" : "Yours"}
              </ItemDescription>
            </ItemContent>
            <ItemActions className="gap-1">
              <Button variant="ghost" size="sm" disabled={pending} aria-label={`Stop mentioning ${r.item}`} onClick={() => mute(r)}>
                Mute
              </Button>
              <Button variant="outline" size="sm" disabled={pending} aria-label={`Add ${r.item} to the Cart`} onClick={() => add(r)}>
                Add
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </section>
  )
}

/** One section (Shared or Personal): loose items first, then one block per Recipe ("From Tacos for 5"). */
function CartSection({ title, note, items }: { title: string; note: string; items: CartItemView[] }) {
  if (items.length === 0) return null
  const loose = items.filter((c) => !c.recipeId)
  const byRecipe = new Map<string, CartItemView[]>()
  for (const c of items.filter((x) => x.recipeId)) byRecipe.set(c.recipeId!, [...(byRecipe.get(c.recipeId!) ?? []), c])
  return (
    <section aria-labelledby={`cart-${title}`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 id={`cart-${title}`} className="type-heading">
          {title}
        </h2>
        <span className="type-caption text-muted-foreground">{note}</span>
      </div>
      {loose.length ? <CartItems items={loose} /> : null}
      {[...byRecipe].map(([id, list]) => (
        <div key={id} className="flex flex-col gap-2 pt-2">
          <h3 className="type-caption px-1 text-muted-foreground">From {list[0].recipeTitle ?? "a recipe"}</h3>
          <CartItems items={list} />
        </div>
      ))}
    </section>
  )
}

function CartItems({ items }: { items: CartItemView[] }) {
  const { group, name } = useGroup()
  const [pending, start] = useTransition()
  const remove = (c: CartItemView) =>
    start(async () => {
      const res = await removeCartItem(group.id, c.id)
      if (!res.ok) toast.add({ title: "Couldn't remove it", description: res.error, type: "error" })
    })
  const who = (id: string) => (name(id) === "You" ? "you" : name(id))
  return (
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
            {c.canRemove ? (
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.name}`} disabled={pending} onClick={() => remove(c)}>
                <XIcon />
              </Button>
            ) : (
              <span aria-hidden className="size-9" />
            )}
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  )
}

/** "I paid $X": previews the Expense with the same split services/cart.ts saves (computeCartSplits), to the cent. */
function PaidDrawer({ open, onOpenChange, items, splitMemberIds }: { open: boolean; onOpenChange: (o: boolean) => void; items: CartItemView[]; splitMemberIds: string[] }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md">{open ? <PaidForm items={items} splitMemberIds={splitMemberIds} onDone={() => onOpenChange(false)} /> : null}</DrawerContent>
    </Drawer>
  )
}

function PaidForm({ items, splitMemberIds, onDone }: { items: CartItemView[]; splitMemberIds: string[]; onDone: () => void }) {
  const { group, me, name, cheer } = useGroup()
  const money = useFormatMoney()
  const [pending, start] = useTransition()
  const [amount, setAmount] = useState("")
  const paid = parseMoney(amount)
  const shares = paid && paid > 0 ? computeCartSplits(items, splitMemberIds, paid, me.id) : []

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
        <DrawerDescription>Roomie splits what you paid by who wanted what: your own things are yours, shared things are split evenly.</DrawerDescription>
      </DrawerHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <Field data-invalid={amount.trim() && (paid === null || paid <= 0) ? true : undefined}>
          <FieldLabel htmlFor="paid">Receipt total</FieldLabel>
          <InputGroup className="h-14">
            <InputGroupAddon>
              <InputGroupText className="type-heading">{currencySymbol(group.currency)}</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput id="paid" inputMode="decimal" placeholder="0.00" className="type-title money" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount.trim() && (paid === null || paid <= 0) ? true : undefined} />
          </InputGroup>
          <FieldDescription>What the receipt says, tax included.</FieldDescription>
        </Field>
        <ItemGroup className="gap-0 rounded-3xl border py-1">
          {splitMemberIds.map((id) => {
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
