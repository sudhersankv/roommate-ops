"use client"

import { useState, type ReactNode } from "react"
import { ArrowUpIcon, PlusIcon, ShoppingCart, TriangleAlertIcon } from "lucide-react"
import { cn } from "cn"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Roomie, type RoomieMood } from "@/components/roomie/mascot"
import { useCheer } from "@/components/roomie/use-cheer"
import { Doorway } from "../_components/doorway"
import { MemberAvatar } from "../_components/member-avatar"
import { RoomieAvatar } from "../_components/roomie-avatar"
import { useThemePreference, type ThemePreference } from "../_components/theme"
import { ColorPair } from "./_showcase/color-pair"
import { previewState, StateMatrix } from "./_showcase/state-matrix"

const sections = [
  ["color", "Color"],
  ["type", "Type"],
  ["shape", "Shape"],
  ["mascot", "Mascot"],
  ["actions", "Actions"],
  ["inputs", "Inputs"],
  ["feedback", "Feedback"],
  ["overlays", "Overlays"],
  ["conversation", "Conversation"],
  ["rules", "Do and don't"],
] as const

export function DesignSystem() {
  const [theme, setTheme] = useThemePreference()
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-14 px-5 pt-8 pb-24">
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="type-title">Roomie design system</h1>
          <ToggleGroup variant="segmented" spacing={1} className="w-auto" value={[theme]} onValueChange={(v) => v[0] && setTheme(v[0] as ThemePreference)} aria-label="Theme">
            <ToggleGroupItem value="system">System</ToggleGroupItem>
            <ToggleGroupItem value="light">Light</ToggleGroupItem>
            <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <p className="type-body max-w-[60ch] text-muted-foreground">
          WhatsApp&apos;s dark neutrals with Roomie&apos;s greens, one typeface (Figtree), pill buttons and generous corners. Dark is the main target; light gets the same care.
        </p>
        <nav aria-label="Sections" className="flex flex-wrap gap-2">
          {sections.map(([id, label]) => (
            <Button key={id} variant="tint" size="sm" nativeButton={false} render={<a href={`#${id}`} />}>
              {label}
            </Button>
          ))}
        </nav>
        <div className="overflow-hidden rounded-3xl">
          <Doorway label="Roomie in the doorway">
            <Roomie size={112} mood="happy" animated decorative />
          </Doorway>
        </div>
      </header>

      <Section id="color" title="Color" note="Roles, shown as the surface with its text and the measured contrast. Body text needs 4.5:1.">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <ColorPair name="Background" background="background" foreground="foreground" />
          <ColorPair name="Card" background="card" foreground="card-foreground" />
          <ColorPair name="Muted text on card" background="card" foreground="muted-foreground" />
          <ColorPair name="Primary" background="primary" foreground="primary-foreground" />
          <ColorPair name="Secondary" background="secondary" foreground="secondary-foreground" />
          <ColorPair name="Muted" background="muted" foreground="muted-foreground" />
          <ColorPair name="Accent" background="accent" foreground="accent-foreground" />
          <ColorPair name="Popover" background="popover" foreground="popover-foreground" />
          <ColorPair name="Destructive on background" background="background" foreground="destructive" />
          <ColorPair name="You're owed" background="background" foreground="owed" />
          <ColorPair name="You owe" background="background" foreground="owe" />
          <ColorPair name="Owed badge" background="owed-soft" foreground="owed" />
          <ColorPair name="Owe badge" background="owe-soft" foreground="owe" />
        </div>
        <h3 className="type-heading pt-4">Brand art</h3>
        <p className="type-caption text-muted-foreground">Fixed in both themes. Used for the doorway, the mascot and Roomie&apos;s avatar, never for text.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Forest", "bg-forest", "#0F3B2C", "Doorway, Roomie's avatar"],
            ["Moss", "bg-moss", "#1F5B43", "Outer arch"],
            ["Leaf", "bg-leaf", "#4FCB78", "Arch, spikes, feet"],
            ["Sprout", "bg-sprout", "#86EFA0", "Primary in dark, the dino"],
            ["Mint", "bg-mint", "#D7F8DF", "Belly, soft highlights"],
            ["Ink", "bg-ink", "#0B2A1E", "Outlines, text on green"],
            ["Beak", "bg-beak", "#FFB547", "You owe, in dark"],
            ["Ring", "bg-ring", "Theme", "Focus rings"],
          ].map(([name, cls, hex, use]) => (
            <div key={name} className="flex flex-col gap-2">
              <span className={cn("h-16 rounded-2xl border", cls)} />
              <span className="type-caption">
                {name} <span className="money text-muted-foreground">{hex}</span>
              </span>
              <span className="type-caption text-muted-foreground">{use}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="type" title="Type" note="Figtree at 400, 500, 600 and 800. Sentence case everywhere. Money always uses tabular figures.">
        <div className="flex flex-col divide-y rounded-3xl border">
          {[
            ["type-display", "48/48, 800, -3.5%", "The one big number on a screen", "$42.50"],
            ["type-title", "26/30, 800, -2%", "Page titles", "Money"],
            ["type-heading", "17/23, 600", "Section heads, sheet titles", "Settle plan"],
            ["type-body", "15/22, 400", "Running text, descriptions", "Dev owes you $30.00 and Sam owes you $12.50."],
            ["type-caption", "13/18, 500", "Small notes, timestamps", "Coming soon"],
          ].map(([token, spec, use, sample]) => (
            <div key={token} className="grid gap-1 p-4 sm:grid-cols-[10rem_1fr]">
              <div className="flex flex-col">
                <span className="type-caption">{token}</span>
                <span className="type-caption text-muted-foreground">{spec}</span>
                <span className="type-caption text-muted-foreground">{use}</span>
              </div>
              <span className={cn(token, "truncate")}>{sample}</span>
            </div>
          ))}
        </div>
        <p className="type-body max-w-[60ch]">
          Roomie talks like a groupmate: brief, a little witty, exact about money. Copy is written from your side (“Settle up”, “Mark done”), and empty screens say what to do next. Amounts like <span className="money font-semibold">$1,204.37</span> line up in columns.
        </p>
      </Section>

      <Section id="shape" title="Shape" note="Buttons are pills. Rows sit in 20 to 28px surfaces. Sheets get the biggest corners.">
        <div className="flex flex-wrap items-end gap-4">
          {[
            ["rounded-xl", "16px", "Inputs, selects"],
            ["rounded-2xl", "20px", "Bordered rows, icon tiles"],
            ["rounded-3xl", "28px", "Grouped lists, cards, drawers"],
            ["rounded-full", "pill", "Buttons, toggles, badges"],
          ].map(([cls, v, use]) => (
            <div key={cls} className="flex w-36 flex-col gap-2">
              <span className={cn("h-20 border bg-card", cls)} />
              <span className="type-caption">
                {cls} <span className="text-muted-foreground">{v}</span>
              </span>
              <span className="type-caption text-muted-foreground">{use}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="mascot" title="Mascot" note="Mood follows your Balance. Animation is CSS only and stops when reduced motion is on.">
        <MascotRow />
      </Section>

      <Section id="actions" title="Actions" note="One primary per group. Tint reads on any surface, including the forest hero.">
        <StateMatrix
          rows={["default", "secondary", "outline", "tint", "ghost", "destructive", "link"] as const}
          render={(variant, state) => (
            <Button variant={variant} size="sm" {...previewState(state)}>
              Settle up
            </Button>
          )}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="xs">Extra small</Button>
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Button>
            <PlusIcon data-icon="inline-start" />
            Add expense
          </Button>
          <Button variant="secondary" size="icon" aria-label="Send">
            <ArrowUpIcon />
          </Button>
          <Button disabled>
            <Spinner data-icon="inline-start" />
            Saving…
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Admin</Badge>
          <Badge variant="outline">Pending</Badge>
          <Badge variant="owed">owes you $30.00</Badge>
          <Badge variant="owe">you owe $12.50</Badge>
          <Badge variant="destructive">Failed</Badge>
          <Badge variant="secondary" className="max-w-40">
            <span className="truncate">A very long badge label that truncates</span>
          </Badge>
        </div>
        <ToggleGroup variant="segmented" spacing={1} defaultValue={["normal"]} aria-label="Chattiness">
          <ToggleGroupItem value="quiet">Quiet</ToggleGroupItem>
          <ToggleGroupItem value="normal">Normal</ToggleGroupItem>
          <ToggleGroupItem value="chatty">Chatty</ToggleGroupItem>
        </ToggleGroup>
      </Section>

      <Section id="inputs" title="Inputs" note="44px tall, 16px text so phones don't zoom. Errors say how to fix it.">
        <StateMatrix
          rows={["input"] as const}
          states={["default", "hover", "focus", "disabled", "invalid"]}
          render={(_, state) => <Input placeholder="Pizza night" aria-label={`Example ${state}`} aria-invalid={state === "invalid" || undefined} {...previewState(state)} />}
        />
        <FieldGroup className="max-w-md">
          <Field>
            <FieldLabel htmlFor="ds-amount">Total</FieldLabel>
            <InputGroup className="h-14">
              <InputGroupAddon>
                <InputGroupText className="type-heading">$</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput id="ds-amount" inputMode="decimal" placeholder="0.00" className="type-title money" />
            </InputGroup>
          </Field>
          <Field data-invalid>
            <FieldLabel htmlFor="ds-desc">What was it for?</FieldLabel>
            <Input id="ds-desc" aria-invalid />
            <FieldDescription>Add a few words so people know what it was.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="ds-payer">Paid by</FieldLabel>
            <Select
              items={[
                { label: "You", value: "maya" },
                { label: "Dev", value: "dev" },
              ]}
              defaultValue="maya"
            >
              <SelectTrigger id="ds-payer" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="maya">You</SelectItem>
                  <SelectItem value="dev">Dev</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="ds-switch">Groceries</FieldLabel>
              <FieldDescription>The Cart and Recipes</FieldDescription>
            </FieldContent>
            <Switch id="ds-switch" defaultChecked />
          </Field>
          <Field orientation="horizontal" data-disabled>
            <FieldContent>
              <FieldLabel htmlFor="ds-switch-off">Trips</FieldLabel>
              <FieldDescription>Coming soon</FieldDescription>
            </FieldContent>
            <Switch id="ds-switch-off" disabled />
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="ds-check" defaultChecked />
            <FieldLabel htmlFor="ds-check">Sam is in this split</FieldLabel>
          </Field>
        </FieldGroup>
      </Section>

      <Section id="feedback" title="Feedback" note="Toasts confirm with the same verb as the button. Empty states point at the next step.">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => toast.add({ title: "Expense added", description: "Pizza night, $48.00", type: "success" })}>
            Show a toast
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.add({ title: "Expense deleted", description: "Movie snacks, $15.00", actionProps: { children: "Undo", onClick: () => toast.add({ title: "Restored" }) } })}
          >
            Toast with undo
          </Button>
        </div>
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Priya is waiting for approval</AlertTitle>
          <AlertDescription>Roomie answers her, but won&apos;t log anything for her until an Admin approves.</AlertDescription>
        </Alert>
        <div className="grid gap-3 sm:grid-cols-2">
          <Empty className="rounded-3xl bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShoppingCart />
              </EmptyMedia>
              <EmptyTitle>The Cart is empty</EmptyTitle>
              <EmptyDescription>Add something, or say “roomie add oat milk” in the chat.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm">Add to the Cart</Button>
            </EmptyContent>
          </Empty>
          <div className="flex flex-col gap-3 rounded-3xl bg-card p-4" aria-label="Loading">
            <Skeleton className="h-5 w-1/2 rounded-full" />
            <Skeleton className="h-12 w-3/4 rounded-2xl" />
            <Skeleton className="h-4 w-full rounded-full" />
            <Skeleton className="h-4 w-5/6 rounded-full" />
          </div>
        </div>
        <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
          <Item className="py-3">
            <ItemMedia>
              <MemberAvatar name="Dev" size="lg" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Dev</ItemTitle>
              <ItemDescription>
                <Badge variant="owed">owes you $30.00</Badge>
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button size="sm" variant="secondary">
                Settle
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
        <Card className="max-w-sm rounded-3xl">
          <CardHeader>
            <CardTitle className="type-heading">Tacos for 5</CardTitle>
            <CardDescription>For Friday. Roomie scaled it in the chat.</CardDescription>
          </CardHeader>
          <CardContent className="type-body text-muted-foreground">Corn tortillas, ground turkey, avocados, limes and 5 more.</CardContent>
          <CardFooter>
            <Button className="w-full">Add ingredients to cart</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section id="overlays" title="Overlays" note="Bottom drawers on mobile. Every drawer and dialog has a title.">
        <div className="flex flex-wrap gap-3">
          <Drawer>
            <DrawerTrigger render={<Button variant="outline" />}>Open a drawer</DrawerTrigger>
            <DrawerContent className="mx-auto max-w-md">
              <DrawerHeader>
                <DrawerTitle className="type-heading">Settle up</DrawerTitle>
                <DrawerDescription>Pick who you&apos;re settling with.</DrawerDescription>
              </DrawerHeader>
              <DrawerFooter>
                <DrawerClose render={<Button size="lg" />}>Done</DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" />}>Open a confirm</AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Movie snacks?</AlertDialogTitle>
                <AlertDialogDescription>Balances change for everyone in it.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogCancel variant="destructive">Delete</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>Open a menu</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuItem>Members</DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" />}>Hover for a tip</TooltipTrigger>
            <TooltipContent>Shares are worked out to the cent</TooltipContent>
          </Tooltip>
        </div>
      </Section>

      <Section id="conversation" title="Conversation" note="Roomie on the left with the dino avatar, you on the right in green.">
        <div className="flex flex-col gap-3 rounded-3xl border p-4">
          <Marker variant="separator">
            <MarkerContent>Today</MarkerContent>
          </Marker>
          <Message align="end">
            <MessageContent>
              <Bubble align="end">
                <BubbleContent>who owes what right now?</BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
          <Message align="start">
            <MessageAvatar>
              <RoomieAvatar />
            </MessageAvatar>
            <MessageContent>
              <Bubble variant="secondary">
                <BubbleContent>Dev owes you $30.00 and Sam owes you $12.50.</BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
          <Message align="start">
            <MessageAvatar>
              <RoomieAvatar />
            </MessageAvatar>
            <MessageContent>
              <Bubble variant="secondary">
                <BubbleContent>
                  <span className="shimmer">Roomie is typing</span>
                </BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
          <InputGroup className="rounded-3xl">
            <InputGroupTextarea aria-label="Message Roomie" placeholder="Message Roomie…" rows={1} className="min-h-11 py-3 pl-4" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton variant="default" size="icon-sm" aria-label="Send">
                <ArrowUpIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </Section>

      <Section id="rules" title="Do and don't" note="The rules that are easiest to break.">
        <div className="grid gap-4 md:grid-cols-2">
          <Rule ok caption="One primary action per group.">
            <Button>Settle up</Button>
            <Button variant="ghost">Not now</Button>
          </Rule>
          <Rule caption="Two primaries compete for the tap.">
            <Button>Settle up</Button>
            <Button>Not now</Button>
          </Rule>
          <Rule ok caption="Owing is amber. Red is only for deleting.">
            <Badge variant="owe">you owe $12.50</Badge>
          </Rule>
          <Rule caption="Red makes a normal debt look like an error.">
            <Badge variant="destructive">you owe $12.50</Badge>
          </Rule>
          <Rule ok caption="Sentence case, plain verbs.">
            <Button variant="secondary">Mark done</Button>
          </Rule>
          <Rule caption="Shouty labels and arrows add nothing.">
            <Button variant="secondary" className="uppercase">
              Mark done →
            </Button>
          </Rule>
        </div>
      </Section>
    </div>
  )
}

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-6 flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="type-title">
          {title}
        </h2>
        <p className="type-body text-muted-foreground">{note}</p>
      </div>
      {children}
    </section>
  )
}

function Rule({ ok = false, caption, children }: { ok?: boolean; caption: string; children: ReactNode }) {
  return (
    <figure className="flex flex-col gap-3 rounded-3xl border p-4">
      <div className="flex min-h-14 flex-wrap items-center gap-3">{children}</div>
      <figcaption className="type-caption">
        <span className={ok ? "text-owed" : "text-destructive"}>{ok ? "Do. " : "Don't. "}</span>
        <span className="text-muted-foreground">{caption}</span>
      </figcaption>
    </figure>
  )
}

const moods: { mood: RoomieMood; label: string }[] = [
  { mood: "calm", label: "Calm" },
  { mood: "happy", label: "Happy: you're owed" },
  { mood: "worried", label: "Worried: you owe a lot" },
  { mood: "sleepy", label: "Sleepy: nothing going on" },
]

function MascotRow() {
  const [cheering, cheer] = useCheer()
  const [animated, setAnimated] = useState(true)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {moods.map((m) => (
          <figure key={m.mood} className="flex flex-col items-center gap-2 rounded-3xl bg-card p-4">
            <Roomie size={96} mood={m.mood} animated={animated} cheer={cheering} />
            <figcaption className="type-caption text-center text-muted-foreground">{m.label}</figcaption>
          </figure>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={cheer}>
          Cheer
        </Button>
        <Field orientation="horizontal" className="w-auto">
          <Switch id="ds-animated" checked={animated} onCheckedChange={setAnimated} />
          <FieldLabel htmlFor="ds-animated">Idle animation</FieldLabel>
        </Field>
        <div className="flex items-end gap-3">
          {[24, 32, 48, 64].map((s) => (
            <Roomie key={s} size={s} decorative />
          ))}
          <RoomieAvatar size={32} />
        </div>
      </div>
    </div>
  )
}
