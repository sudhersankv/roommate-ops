"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { ArrowLeftIcon, PencilIcon, ReceiptText, RepeatIcon, Trash2Icon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { toast } from "@/components/ui/toast"
import { MemberAvatar } from "@/components/app/member-avatar"
import { Amount, CategoryIcon, categoryOf, useFormatMoney } from "@/components/app/money-bits"
import { deleteExpense, restoreExpense } from "../../actions"
import { ExpenseDrawer } from "../expense-drawer"
import { useGroup } from "../group-context"
import type { ExpenseView } from "../types"

const methodText = {
  equal: "Split equally",
  exact: "Split by exact amounts",
  percent: "Split by percentage",
  shares: "Split by shares",
  cart: "Split by who wanted what",
} as const

export function ExpenseDetailScreen({ expense }: { expense: ExpenseView | null }) {
  const { base } = useGroup()
  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-2 bg-background/90 px-2 backdrop-blur-md">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link href={`${base}/money?tab=expenses`} />} aria-label="Back to Money">
          <ArrowLeftIcon />
        </Button>
        <span className="type-heading truncate">{expense?.description ?? "Expense"}</span>
      </header>
      {expense ? (
        <Detail expense={expense} />
      ) : (
        <Empty className="mx-4 mt-6 rounded-3xl bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ReceiptText />
            </EmptyMedia>
            <EmptyTitle>This expense isn&apos;t here anymore</EmptyTitle>
            <EmptyDescription>It may have been deleted. Activity on the Money page shows who changed what.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link href={`${base}/money?tab=activity`} />}>
              See activity
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </>
  )
}

function Detail({ expense: e }: { expense: ExpenseView }) {
  const router = useRouter()
  const { group, base, name, dates } = useGroup()
  const money = useFormatMoney()
  const [editing, setEditing] = useState(false)
  const [, start] = useTransition()
  const cat = categoryOf(e.category)
  const day = dates.dayLabel(e.date)
  const when = day === "Today" || day === "Yesterday" ? day.toLowerCase() : day
  const addedBy = e.addedBy ? (name(e.addedBy) === "You" ? "you" : name(e.addedBy)) : null

  const remove = () =>
    start(async () => {
      const res = await deleteExpense(group.id, e.id)
      if (!res.ok) return void toast.add({ title: "Couldn't delete it", description: res.error, type: "error" })
      router.push(`${base}/money?tab=expenses`)
      toast.add({
        title: "Expense deleted",
        description: `${e.description}, ${money(e.cents)}`,
        actionProps: {
          children: "Undo",
          onClick: async () => {
            const undo = await restoreExpense(group.id, e.id)
            if (!undo.ok) toast.add({ title: "Couldn't undo", description: undo.error, type: "error" })
          },
        },
      })
    })

  return (
    <div className="flex flex-col gap-8 px-5 pt-2">
      <section className="flex flex-col gap-3">
        <CategoryIcon category={e.category} className="size-14 rounded-3xl" />
        <h1 className="type-title">{e.description}</h1>
        <p className="type-display">{money(e.cents)}</p>
        <p className="type-body text-muted-foreground">
          {e.category === "other" ? `On ${when}` : `${cat.label}, ${when}`}.{addedBy ? ` Added by ${addedBy}.` : ""}
        </p>
        {e.recurring || e.repeated || e.inSplitwise || e.receiptUrl ? (
          <div className="flex flex-wrap gap-1.5">
            {e.recurring ? (
              <Badge variant="secondary">
                <RepeatIcon data-icon="inline-start" />
                Repeats {e.recurring}
              </Badge>
            ) : null}
            {e.repeated ? (
              <Badge variant="secondary">
                <RepeatIcon data-icon="inline-start" />
                Added by the repeat
              </Badge>
            ) : null}
            {e.inSplitwise ? <Badge variant="outline">In Splitwise</Badge> : null}
            {e.receiptUrl ? <Badge variant="outline">Receipt</Badge> : null}
          </div>
        ) : null}
        {e.yourShare > 0 || e.youPaid > 0 ? (
          <p className="type-body">
            {e.youPaid - e.yourShare > 0 ? (
              <>
                You lent <Amount cents={e.youPaid - e.yourShare} tone="owed" className="font-semibold" />
              </>
            ) : e.youPaid - e.yourShare < 0 ? (
              <>
                You borrowed <Amount cents={e.yourShare - e.youPaid} tone="owe" className="font-semibold" />
              </>
            ) : (
              "You paid exactly your share."
            )}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="paid-by" className="flex flex-col gap-2">
        <h2 id="paid-by" className="type-heading">
          Paid by
        </h2>
        <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
          {e.payers.map((p) => (
            <Item key={p.memberId} className="py-2.5">
              <ItemMedia>
                <MemberAvatar name={name(p.memberId)} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{name(p.memberId)}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <Amount cents={p.cents} className="type-heading" />
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </section>

      <section aria-labelledby="shares" className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id="shares" className="type-heading">
            Shares
          </h2>
          <p className="type-caption text-muted-foreground">{methodText[e.source === "cart" ? "cart" : e.method]}, worked out to the cent.</p>
        </div>
        <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
          {e.shares.map((s) => (
            <Item key={s.memberId} className="py-2.5">
              <ItemMedia>
                <MemberAvatar name={name(s.memberId)} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{name(s.memberId)}</ItemTitle>
                {s.weight != null ? (
                  <ItemDescription>{e.method === "percent" ? `${s.weight}%` : `${s.weight} ${s.weight === 1 ? "share" : "shares"}`}</ItemDescription>
                ) : null}
              </ItemContent>
              <ItemActions>
                <Amount cents={s.cents} className="type-heading" />
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </section>

      {e.note ? (
        <section aria-labelledby="note" className="flex flex-col gap-2">
          <h2 id="note" className="type-heading">
            Note
          </h2>
          <p className="type-body whitespace-pre-line text-muted-foreground">{e.note}</p>
        </section>
      ) : null}

      {e.receiptUrl ? (
        <section aria-labelledby="receipt" className="flex flex-col gap-2">
          <h2 id="receipt" className="type-heading">
            Receipt
          </h2>
          <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={e.receiptUrl} alt={`Receipt for ${e.description}`} className="max-h-72 rounded-2xl border object-contain" />
          </a>
        </section>
      ) : null}

      {e.canChange ? (
        <div className="flex gap-3">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => setEditing(true)}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" size="lg" className="flex-1" />}>
              <Trash2Icon data-icon="inline-start" />
              Delete
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {e.description}?</AlertDialogTitle>
                <AlertDialogDescription>Balances change for everyone in it. You can undo for a few seconds.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={remove}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <p className="type-caption text-muted-foreground">Only the people in this expense, or an Admin, can change it.</p>
      )}

      <ExpenseDrawer open={editing} onOpenChange={setEditing} expense={e} />
    </div>
  )
}
