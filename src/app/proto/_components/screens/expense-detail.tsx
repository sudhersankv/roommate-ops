"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { ArrowLeftIcon, PencilIcon, ReceiptText, Trash2Icon } from "lucide-react"

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
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { toast } from "@/components/ui/toast"
import { ME } from "../../_data"
import { dayLabel } from "../../_lib/dates"
import { formatMoney } from "../../_lib/money"
import { useMemberName, useMoney, useStore, type ExpenseView } from "../../_lib/store"
import { ExpenseDrawer } from "../expense-drawer"
import { MemberAvatar } from "../member-avatar"
import { Amount, CategoryIcon, categoryOf } from "../money-bits"
import { base } from "../shell"

export function ExpenseDetailScreen({ id }: { id: string }) {
  const { expenses } = useMoney()
  const expense = expenses.find((e) => e.id === id)

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

const methodWords = {
  equal: "Split equally",
  exact: "Split by exact amounts",
  percent: "Split by percent",
  shares: "Split by shares",
} as const

function Detail({ expense: e }: { expense: ExpenseView }) {
  const router = useRouter()
  const { deleteExpense } = useStore()
  const name = useMemberName()
  const [editing, setEditing] = useState(false)
  const cat = categoryOf(e.category)
  const day = dayLabel(e.date)
  const when = day === "Today" || day === "Yesterday" ? day.toLowerCase() : day
  const weights = e.split.method !== "equal" && e.split.method !== "exact" ? e.split.members.map((m) => e.split.values?.[m] ?? 0) : null

  return (
    <div className="flex flex-col gap-8 px-5 pt-2">
      <section className="flex flex-col gap-3">
        <CategoryIcon category={e.category} className="size-14 rounded-3xl" />
        <h1 className="type-title">{e.description}</h1>
        <p className="type-display">{formatMoney(e.cents)}</p>
        <p className="type-body text-muted-foreground">
          {cat.label}, {when}. Added by {name(e.addedBy) === "You" ? "you" : name(e.addedBy)}.
        </p>
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
                <MemberAvatar name={p.memberId === ME ? "Maya" : name(p.memberId)} />
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
          <p className="type-caption text-muted-foreground">
            {methodWords[e.split.method]}
            {weights ? ` ${weights.join(e.split.method === "percent" ? "/" : ":")}${e.split.method === "percent" ? "%" : ""}` : ""}, worked out to the cent.
          </p>
        </div>
        <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
          {e.shares.map((s) => (
            <Item key={s.memberId} className="py-2.5">
              <ItemMedia>
                <MemberAvatar name={s.memberId === ME ? "Maya" : name(s.memberId)} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{name(s.memberId)}</ItemTitle>
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
          <p className="type-body text-muted-foreground">{e.note}</p>
        </section>
      ) : null}

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
              <AlertDialogDescription>
                Balances change for everyone in it. Roomie tells the group chat, and you can undo for a few seconds.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  const undo = deleteExpense(e)
                  router.push(`${base}/money?tab=expenses`)
                  toast.add({
                    title: "Expense deleted",
                    description: `${e.description}, ${formatMoney(e.cents)}`,
                    actionProps: { children: "Undo", onClick: undo },
                  })
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <ExpenseDrawer open={editing} onOpenChange={setEditing} expense={e} />
    </div>
  )
}
