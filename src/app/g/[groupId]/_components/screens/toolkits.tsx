"use client"

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import { CheckIcon, SearchIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ToolkitCategory, ToolkitId } from "@/toolkits/types"
import { setToolkit } from "../../actions"
import { useGroup } from "../group-context"
import { PageHeader, TopBar } from "../shell"
import type { ToolkitCardView } from "../types"

const CATEGORY_LABEL: Record<ToolkitCategory, string> = {
  money: "Money",
  home: "Home",
  food: "Food",
  planning: "Planning",
  fun: "Fun",
  integrations: "Integrations",
}

/** Admins teach Roomie a Trick or make it forget one; everyone else browses. The services check the role again. */
function useToggle() {
  const { group, cheer } = useGroup()
  const [pending, start] = useTransition()
  const toggle = (t: ToolkitCardView, enabled: boolean) =>
    start(async () => {
      const res = await setToolkit(group.id, t.id as ToolkitId, enabled)
      if (!res.ok) return void toast.add({ title: enabled ? `Roomie couldn't learn ${t.name}` : `Roomie couldn't forget ${t.name}`, description: res.error, type: "error" })
      if (enabled) {
        cheer()
        toast.add({
          title: `Roomie learned ${t.name}`,
          description: res.data?.tryThis ? `Roomie told the chat. Try: "roomie, ${res.data.tryThis}"` : "Roomie can use it in the chat now.",
          type: "success",
        })
      } else toast.add({ title: `Roomie forgot ${t.name}`, description: "Nothing is deleted. Teach it again any time." })
    })
  return { toggle, pending }
}

export function ToolkitsScreen({ cards, openId }: { cards: ToolkitCardView[]; openId: string | null }) {
  const { group, isAdmin, active } = useGroup()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<ToolkitCategory | "all">("all")
  const [open, setOpen] = useState<string | null>(openId)
  const { toggle, pending } = useToggle()
  const admins = active.filter((m) => m.role === "admin").map((m) => m.name)

  const categories = useMemo(() => (Object.keys(CATEGORY_LABEL) as ToolkitCategory[]).filter((c) => cards.some((t) => t.category === c)), [cards])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return cards.filter(
      (t) => (category === "all" || t.category === category) && (!q || [t.name, t.summary, t.longDescription, ...t.tags, ...t.examples].some((s) => s.toLowerCase().includes(q)))
    )
  }, [cards, query, category])
  const on = shown.filter((t) => t.enabled)
  const available = shown.filter((t) => !t.enabled && t.status !== "coming-soon")
  const soon = shown.filter((t) => t.status === "coming-soon")
  const current = cards.find((t) => t.id === open) ?? null

  return (
    <>
      <TopBar title="Tricks" />
      <PageHeader title="Tricks">
        <p className="type-body text-pretty text-muted-foreground">
          What Roomie knows in {group.name}.{" "}
          {isAdmin ? "Teach it one and Roomie tells the chat." : `Only Admins teach Roomie new Tricks. Ask ${admins.join(" or ") || "an Admin"}.`}
        </p>
      </PageHeader>

      <div className="flex flex-col gap-4 px-5 pb-2">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput aria-label="Search Tricks" placeholder="Search: recipes, Splitwise, chores…" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
        </InputGroup>
        <div className="-mx-5 overflow-x-auto px-5 [scrollbar-width:none]">
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={2}
            value={[category]}
            onValueChange={(v) => setCategory((v[0] as ToolkitCategory | "all" | undefined) ?? "all")}
            aria-label="Category"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            {categories.map((c) => (
              <ToggleGroupItem key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <div className="flex flex-col gap-8 px-5 pt-4 pb-6">
        {shown.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No Trick matches “{query}”</EmptyTitle>
              <EmptyDescription>Try another word, or tell Roomie in the chat what you&apos;d like it to do.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        <CardGrid title="Learned" cards={on} onOpen={setOpen} onToggle={toggle} pending={pending} />
        <CardGrid title="Not yet" cards={available} onOpen={setOpen} onToggle={toggle} pending={pending} />
        <CardGrid title="Soon" cards={soon} onOpen={setOpen} onToggle={toggle} pending={pending} />
      </div>

      <Drawer open={!!current} onOpenChange={(o) => !o && setOpen(null)}>
        <DrawerContent className="mx-auto max-w-md">{current ? <ToolkitDetail toolkit={current} onToggle={toggle} pending={pending} /> : null}</DrawerContent>
      </Drawer>
    </>
  )
}

function CardGrid({
  title,
  cards,
  onOpen,
  onToggle,
  pending,
}: {
  title: string
  cards: ToolkitCardView[]
  onOpen: (id: string) => void
  onToggle: (t: ToolkitCardView, enabled: boolean) => void
  pending: boolean
}) {
  if (!cards.length) return null
  const id = `tk-${title.toLowerCase().replace(/\s+/g, "-")}`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="type-heading">
        {title}
      </h2>
      <ul className="grid grid-cols-2 gap-3">
        {cards.map((t) => (
          <li key={t.id}>
            <ToolkitCard toolkit={t} onOpen={() => onOpen(t.id)} onToggle={(v) => onToggle(t, v)} pending={pending} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function IconTile({ toolkit, className }: { toolkit: ToolkitCardView; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-2xl [&_svg]:size-5",
        toolkit.enabled ? "bg-primary/18 text-foreground" : "bg-muted text-muted-foreground",
        toolkit.status === "coming-soon" && "grayscale",
        className
      )}
      aria-hidden
    >
      {toolkit.icon}
    </span>
  )
}

function StatusBadge({ toolkit }: { toolkit: ToolkitCardView }) {
  if (toolkit.status === "coming-soon") return <Badge variant="secondary">Soon</Badge>
  if (toolkit.enabled) return <Badge variant="owed">Learned</Badge>
  if (toolkit.status === "beta") return <Badge variant="outline">Beta</Badge>
  return null
}

function ToolkitCard({ toolkit: t, onOpen, onToggle, pending }: { toolkit: ToolkitCardView; onOpen: () => void; onToggle: (on: boolean) => void; pending: boolean }) {
  const { isAdmin } = useGroup()
  const soon = t.status === "coming-soon"
  return (
    <div
      className={cn(
        "relative flex h-full flex-col gap-3 rounded-3xl p-4",
        t.enabled ? "bg-card" : soon ? "bg-muted/40 opacity-60 grayscale" : "border border-dashed border-foreground/15 bg-card/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <IconTile toolkit={t} />
        <StatusBadge toolkit={t} />
      </div>
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col gap-1 text-left outline-none after:absolute after:inset-0 after:rounded-3xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50">
        <span className={cn("font-semibold", !t.enabled && "text-muted-foreground")}>
          {t.name}
          <span className="sr-only">{t.enabled ? ", learned" : soon ? ", coming soon" : ", not learned yet"}</span>
        </span>
        <span className="line-clamp-3 text-[0.8125rem] text-muted-foreground">{t.summary}</span>
      </button>
      <div className="relative z-10 flex items-center justify-between gap-2">
        <Badge variant="outline">{CATEGORY_LABEL[t.category]}</Badge>
        {soon ? null : isAdmin ? (
          t.enabled ? (
            <Button size="xs" variant="outline" disabled={pending} onClick={() => onToggle(false)} aria-label={`Make Roomie forget ${t.name}`}>
              Forget
            </Button>
          ) : (
            <Button size="xs" disabled={pending || t.blocked.length > 0} onClick={() => onToggle(true)} aria-label={`Teach Roomie ${t.name}`}>
              Teach
            </Button>
          )
        ) : t.enabled ? null : (
          <span className="text-xs font-medium text-muted-foreground">Not yet</span>
        )}
      </div>
    </div>
  )
}

function ToolkitDetail({ toolkit: t, onToggle, pending }: { toolkit: ToolkitCardView; onToggle: (t: ToolkitCardView, on: boolean) => void; pending: boolean }) {
  const { isAdmin, active } = useGroup()
  const soon = t.status === "coming-soon"
  const admins = active.filter((m) => m.role === "admin").map((m) => m.name)
  return (
    <>
      <DrawerHeader className="flex-row items-center gap-3 text-left">
        <IconTile toolkit={t} className="size-12" />
        <div className="flex min-w-0 flex-col gap-1">
          <DrawerTitle className="type-heading flex items-center gap-2">
            {t.name}
            <StatusBadge toolkit={t} />
          </DrawerTitle>
          <DrawerDescription>{t.summary}</DrawerDescription>
        </div>
        <DrawerClose render={<Button variant="ghost" size="icon-sm" className="ml-auto self-start" aria-label="Close" />}>
          <XIcon />
        </DrawerClose>
      </DrawerHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <p className="type-body text-pretty">{t.longDescription}</p>

        {t.abilities.length ? (
          <section aria-labelledby="tk-can" className="flex flex-col gap-2">
            <h3 id="tk-can" className="type-heading">
              What it can do
            </h3>
            <ul className="type-body flex flex-col gap-1.5">
              {t.abilities.map((a) => (
                <li key={a} className="flex gap-2">
                  <CheckIcon className="mt-1 size-4 shrink-0 text-owed" aria-hidden />
                  {a}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="tk-try" className="flex flex-col gap-2">
          <h3 id="tk-try" className="type-heading">
            {soon ? "You'll be able to say" : "Try saying"}
          </h3>
          <div className="flex flex-col items-end gap-1.5">
            {t.examples.map((e) => (
              <Bubble key={e} className="max-w-[88%]">
                <BubbleContent>roomie {e}</BubbleContent>
              </Bubble>
            ))}
          </div>
        </section>

        <section aria-labelledby="tk-needs" className="flex flex-col gap-2">
          <h3 id="tk-needs" className="type-heading">
            Needs
          </h3>
          {t.requirements.length ? (
            <ul className="flex flex-col gap-2">
              {t.requirements.map((r) => (
                <li key={r.label} className="flex gap-2">
                  <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", r.ok ? "bg-owed-soft text-owed" : r.blocking ? "bg-destructive/10 text-destructive" : "bg-owe-soft text-owe")} aria-hidden>
                    {r.ok ? <CheckIcon className="size-3.5" /> : <XIcon className="size-3.5" />}
                  </span>
                  <span className="flex flex-col">
                    <span className="type-body">
                      {r.label}
                      <span className={r.ok ? "text-owed" : r.blocking ? "text-destructive" : "text-muted-foreground"}> · {r.ok ? "ready" : r.blocking ? "missing" : "not set up"}</span>
                    </span>
                    {r.detail && !r.ok ? <span className="type-caption text-muted-foreground">{r.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-body text-muted-foreground">Nothing to set up.</p>
          )}
        </section>

        {t.persona ? (
          <Collapsible className="flex flex-col gap-2">
            <CollapsibleTrigger render={<Button variant="link" size="xs" className="self-start px-0" />}>How Roomie behaves with it</CollapsibleTrigger>
            <CollapsibleContent>
              <p className="type-caption whitespace-pre-line rounded-2xl bg-muted p-3 text-muted-foreground">{t.persona}</p>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
      <DrawerFooter className="border-t pt-4">
        {!isAdmin && !t.enabled && !soon ? (
          <p className="type-body text-center text-muted-foreground">Ask an admin{admins.length ? ` (${admins.join(" or ")})` : ""} to teach Roomie this one.</p>
        ) : null}
        {t.blocked.length && isAdmin && !t.enabled && !soon ? <p className="type-caption text-center text-destructive">Roomie can&apos;t learn this yet: {t.blocked.join("; ")}.</p> : null}
        <div className="flex gap-2 *:flex-1">
          {soon ? (
            <Button size="lg" disabled>
              Soon
            </Button>
          ) : isAdmin && t.enabled ? (
            <Button size="lg" variant="outline" disabled={pending} onClick={() => onToggle(t, false)}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Forget {t.name}
            </Button>
          ) : isAdmin ? (
            <Button size="lg" disabled={pending || t.blocked.length > 0} onClick={() => onToggle(t, true)}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Teach Roomie {t.name}
            </Button>
          ) : null}
          {t.enabled && t.href ? (
            <Button size="lg" variant="secondary" nativeButton={false} render={<Link href={t.href} />}>
              Open {t.name}
            </Button>
          ) : null}
          {!isAdmin && !(t.enabled && t.href) ? <DrawerClose render={<Button variant="secondary" size="lg" />}>Close</DrawerClose> : null}
        </div>
      </DrawerFooter>
    </>
  )
}
