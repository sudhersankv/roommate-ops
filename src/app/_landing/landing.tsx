import Image from "next/image"
import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import { LayoutDashboardIcon, LockIcon } from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ToolkitIcon } from "@/components/app/toolkit-icon"
import { Roomie } from "@/components/roomie/mascot"
import { SignOutLink } from "@/components/app/sign-out-link"
import { APP_PATH, SIGNIN_PATH } from "@/lib/auth/oauth-paths"
import { ARCHETYPES } from "@/lib/personality"
import { SHOW_COUNT_FROM } from "@/services/trick-votes"
import { BetaForm } from "./beta-form"
import { ChatWindow, ReceiptPhoto, cuesFor } from "./chat"
import { DEMOS, HERO, VIBE_LINES } from "./demos"
import { GITHUB_URL, TelegramMark, WhatsAppMark, linkClass, shareLinks, telegramAddUrl } from "./marks"
import { CopyLink } from "./share-row"
import { Stage } from "./stage"
import { GROUP_KINDS, accentOf, builtTricks, comingSoonTricks, taughtBy, trickName } from "./tricks"
import { VoteButton } from "./vote-button"
import "./landing.css"

export { GITHUB_URL, telegramAddUrl } from "./marks"

/** The headline, also used by the metadata and the share image (scripts/og-image.ts keeps its own copy). */
export const HEADLINE = "Your group chat finally has a brain."
export const SUBLINE = "An AI that joins your group chat and learns Tricks: splitting, groceries, chores and more."

const accent = (id: string) => ({ "--accent": accentOf(id) }) as CSSProperties

/**
 * The public landing page. Server components, except the stages (the dino watching a chat), the vote buttons, the
 * copy-link button and the beta form. `signedIn` only swaps the nav's Sign in for Open dashboard; `votes` are the
 * coming-soon Tricks' vote counts (shown from 5).
 */
export function Landing({ signedIn = false, votes = {} }: { signedIn?: boolean; votes?: Record<string, number> }) {
  const addUrl = telegramAddUrl()
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-background focus:px-4 focus:py-2">
        Skip to content
      </a>
      <Hero addUrl={addUrl} signedIn={signedIn} />
      <main id="main">
        <Demos addUrl={addUrl} />
        <Tricks votes={votes} />
        <Vibes addUrl={addUrl} />
        <Groups />
        <HowItWorks addUrl={addUrl} />
        <DashboardPeek />
        <Beta addUrl={addUrl} />
        <Share />
      </main>
      <Footer signedIn={signedIn} />
    </>
  )
}

/* ---------- hero: headline, one line, two buttons, one chat ---------- */

function Hero({ addUrl, signedIn }: { addUrl: string; signedIn: boolean }) {
  return (
    // Brand art: the band is forest in both themes, so its tokens are the dark ones.
    <div className="lp-hero dark relative isolate overflow-x-clip bg-forest text-foreground">
      <Embers />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/" aria-label="Roomie" className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/roomie-logo-on-dark.svg" alt="" width={419} height={128} className="h-8 w-auto sm:h-9" />
        </Link>
        <nav aria-label="Site" className="flex items-center gap-1">
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/help" />}>
            How it works
          </Button>
          <Button variant="tint" size="sm" nativeButton={false} render={<Link href={signedIn ? APP_PATH : SIGNIN_PATH} />}>
            {signedIn ? "Open dashboard" : "Sign in"}
          </Button>
        </nav>
      </header>

      <section aria-labelledby="hero-title" className="mx-auto grid max-w-6xl gap-8 px-5 pt-4 sm:px-8 sm:pt-8 lg:grid-cols-[1.05fr_1fr] lg:items-end lg:gap-14 lg:pt-12">
        <div className="flex flex-col gap-5 lg:self-center lg:pb-16">
          <h1 id="hero-title" className="m-0 max-w-[12ch] text-[clamp(2.6rem,8.5vw,5rem)] leading-[0.94] font-extrabold tracking-[-0.045em] text-balance text-mint">
            {HEADLINE}
          </h1>
          <p className="m-0 max-w-[40ch] text-base leading-snug text-mint/80 sm:text-xl sm:leading-relaxed">{SUBLINE}</p>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            <Button size="lg" nativeButton={false} render={<a href={addUrl} target="_blank" rel="noopener noreferrer" />} className="max-sm:h-11 max-sm:px-4 max-sm:text-sm">
              <TelegramMark />
              Add to Telegram
              <span className="sr-only">(opens Telegram in a new tab)</span>
            </Button>
            <Button size="lg" variant="tint" nativeButton={false} render={<a href="#whatsapp-beta" />} className="max-sm:h-11 max-sm:px-4 max-sm:text-sm">
              <WhatsAppMark />
              WhatsApp beta
            </Button>
          </div>
          <p className="type-caption m-0 text-mint/70">Free while in beta.</p>
        </div>

        <div className="relative mx-auto w-full max-w-md lg:mx-0 lg:max-w-none">
          <Arches className="absolute -top-4 left-1/2 w-[min(130%,40rem)] max-w-none -translate-x-1/2 lg:-top-10" />
          <Stage cues={cuesFor(HERO.lines)} start="load" size={76} className="pt-12" dinoClassName="top-0 right-8 sm:right-12">
            <ChatWindow
              title={HERO.title}
              people={HERO.people}
              lines={HERO.lines}
              motion="stage"
              label="An example group chat: Maya says Dev still owes her for pizza, Dev says he paid, and Roomie settles it: Dev paid Maya $18 on Tuesday, and Maya owes Dev $4."
              className="relative -mb-24 shadow-2xl shadow-black/40"
            />
          </Stage>
        </div>
      </section>
    </div>
  )
}

/** A dozen embers rising through the hero, and a slow warm glow behind them. CSS only; still with reduced motion. */
function Embers() {
  const embers = [
    [6, 0, 9, 6],
    [14, 3.2, 11, 5],
    [23, 6.1, 8, 7],
    [31, 1.4, 12, 4],
    [42, 4.6, 10, 5],
    [55, 7.8, 9, 4],
    [63, 2.3, 13, 8],
    [71, 5.4, 10, 5],
    [79, 0.8, 11, 5],
    [86, 6.9, 9, 4],
    [93, 3.9, 12, 4],
  ]
  return (
    <div aria-hidden className="lp-embers pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <span className="lp-glow" />
      {embers.map(([x, delay, dur, size], k) => (
        <i key={k} style={{ ["--x" as string]: `${x}%`, ["--d" as string]: `${delay}s`, ["--t" as string]: `${dur}s`, ["--s" as string]: `${size}px` }} />
      ))}
    </div>
  )
}

/** The Home doorway's arches, bigger: moss, leaf, sprout, forest. */
function Arches({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 210" aria-hidden className={className} preserveAspectRatio="xMidYMax meet">
      <path d="M62 210V128A118 118 0 0 1 298 128V210Z" className="fill-moss stroke-ink" strokeWidth="2" />
      <path d="M80 210V128A100 100 0 0 1 280 128V210Z" className="fill-leaf stroke-ink" strokeWidth="2" />
      <path d="M96 210V128A84 84 0 0 1 264 128V210Z" className="fill-sprout stroke-ink" strokeWidth="2" />
      <path d="M112 210V128A68 68 0 0 1 248 128V210Z" className="fill-forest stroke-ink" strokeWidth="2" />
    </svg>
  )
}

/* ---------- shared bits ---------- */

function SectionHead({ id, title, children, className }: { id: string; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex max-w-2xl flex-col gap-3", className)}>
      <h2 id={id} className="m-0 text-[clamp(2rem,5vw,3.25rem)] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance">
        {title}
      </h2>
      {children && <p className="m-0 max-w-[46ch] text-base leading-snug text-muted-foreground sm:text-lg sm:leading-relaxed">{children}</p>}
    </div>
  )
}

/** The small "add it" link that follows each demo block. */
function TinyAdd({ addUrl, className }: { addUrl: string; className?: string }) {
  return (
    <a
      href={addUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex w-fit items-center gap-1.5 rounded-full text-[0.875rem] font-semibold text-owed outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4", className)}
    >
      <TelegramMark />
      Add Roomie to your group
      <span className="sr-only">(opens Telegram in a new tab)</span>
    </a>
  )
}

function TrickChip({ id }: { id: string }) {
  return (
    <span style={accent(id)} className="lp-chip inline-flex w-fit items-center gap-1.5 rounded-full bg-raised py-1 pr-3 pl-1.5 text-[0.8125rem] font-semibold">
      <span aria-hidden className="size-2.5 rounded-full bg-(--accent)" />
      {trickName(id)} Trick
    </span>
  )
}

/* ---------- the demos: moments people screenshot ---------- */

function Demos({ addUrl }: { addUrl: string }) {
  return (
    <section aria-labelledby="demos-title" className="mx-auto max-w-6xl px-5 pt-36 sm:px-8 lg:pt-44">
      <SectionHead id="demos-title" title="Moments worth a screenshot.">
        Say &ldquo;roomie&rdquo; and ask. Every Trick is one less thing to keep track of.
      </SectionHead>
      <div className="mt-12 grid items-start gap-x-12 gap-y-16 md:grid-cols-2">
        {DEMOS.map((d) => (
          <article key={d.id} aria-labelledby={`demo-${d.id}`} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <TrickChip id={d.trick} />
              <h3 id={`demo-${d.id}`} className="m-0 text-2xl font-extrabold tracking-[-0.02em]">
                {d.title}
              </h3>
              <p className="type-body m-0 max-w-[44ch] text-muted-foreground">{d.body}</p>
            </div>
            <Stage cues={cuesFor(d.lines)} size={52} className="pt-9" dinoClassName="top-0 right-6">
              <ChatWindow
                title={d.group.title}
                people={`${d.group.people} ${ARCHETYPES[d.group.vibe].accessory}`}
                motion="stage"
                label={`Example chat in "${d.group.title}" with a ${ARCHETYPES[d.group.vibe].label.toLowerCase()} Roomie: ${d.title}`}
                lines={d.photo === "receipt" ? d.lines.map((l, i) => (i === 0 && "who" in l ? { ...l, photo: <ReceiptPhoto /> } : l)) : d.lines}
              />
            </Stage>
            <TinyAdd addUrl={addUrl} />
          </article>
        ))}
      </div>
    </section>
  )
}

/* ---------- Tricks: what it knows, and what's next (vote) ---------- */

function Tricks({ votes }: { votes: Record<string, number> }) {
  return (
    <section id="tricks" aria-labelledby="tricks-title" className="mx-auto max-w-6xl scroll-mt-6 px-5 pt-32 sm:px-8 lg:pt-40">
      <SectionHead id="tricks-title" title="Teach it Tricks.">
        Say &ldquo;roomie, learn chores&rdquo; in the chat, or switch Tricks on in the dashboard.
      </SectionHead>
      <ul className="m-0 mt-12 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {builtTricks().map((m) => (
          <li key={m.id} style={accent(m.id)} className="lp-trick grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-1.5 rounded-3xl border bg-card p-4 sm:flex sm:flex-col sm:gap-3 sm:p-5">
            <span aria-hidden className="row-span-2 flex size-11 items-center justify-center rounded-2xl bg-(--accent) text-ink">
              <ToolkitIcon name={m.icon} className="size-5" />
            </span>
            <h3 className="m-0 text-xl leading-tight font-extrabold tracking-[-0.02em] sm:text-[1.625rem]">{m.name}</h3>
            <p className="type-body m-0 text-muted-foreground">{m.summary}</p>
            <div className="col-span-2 mt-auto flex flex-wrap items-center gap-1.5 pt-1.5">
              <span className="type-caption text-muted-foreground">Taught by</span>
              {taughtBy(m.id).map((g) => (
                <span key={g} className="rounded-full bg-raised px-2.5 py-0.5 text-[0.8125rem] font-medium">
                  {g}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <h3 className="type-heading m-0 mt-12 text-muted-foreground">Coming soon. Vote for what it learns next.</h3>
      <ul className="m-0 -mx-5 mt-4 flex list-none snap-x snap-mandatory gap-3 overflow-x-auto px-5 pt-2 pb-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-5">
        {comingSoonTricks().map((m) => (
          <li key={m.id} style={accent(m.id)} className="lp-trick is-soon flex w-[64vw] max-w-64 shrink-0 snap-start flex-col gap-2.5 rounded-3xl border border-dashed bg-card/60 p-4 sm:w-auto sm:max-w-none">
            <div className="flex items-center justify-between gap-2">
              <span aria-hidden className="lp-soon-icon flex size-9 items-center justify-center rounded-xl bg-(--accent) text-ink">
                <ToolkitIcon name={m.icon} className="size-4" />
              </span>
              <Badge variant="secondary">Coming soon</Badge>
            </div>
            <h4 className="type-heading m-0">{m.name}</h4>
            <p className="type-caption m-0 text-muted-foreground">{m.summary}</p>
            <div className="mt-auto pt-1">
              <VoteButton trickId={m.id} name={m.name} count={votes[m.id] ?? 0} showFrom={SHOW_COUNT_FROM} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ---------- vibes: one killer line each ---------- */

function Vibes({ addUrl }: { addUrl: string }) {
  return (
    <section aria-labelledby="vibes-title" className="mx-auto max-w-6xl px-5 pt-32 sm:px-8 lg:pt-40">
      <SectionHead id="vibes-title" title="Pick its vibe.">
        Six of them. Then give it a name and a quirk or two.
      </SectionHead>
      <ul className="m-0 -mx-5 mt-10 flex list-none snap-x snap-mandatory gap-4 overflow-x-auto px-5 pt-2 pb-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {VIBE_LINES.map(({ id, line }) => {
          const a = ARCHETYPES[id]
          return (
            <li key={id} data-vibe={id} className="lp-vibe relative flex w-[78vw] max-w-80 shrink-0 snap-center flex-col gap-4 overflow-hidden rounded-3xl border bg-card p-5 sm:w-auto sm:max-w-none">
              {id === "hype" && <Confetti />}
              <div className="flex items-center gap-3">
                <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-raised text-2xl">
                  {a.accessory}
                </span>
                <span className="flex flex-col">
                  <span className="type-title">{a.label}</span>
                  <span className="type-caption text-muted-foreground">{a.tagline}</span>
                </span>
              </div>
              <p className="m-0 w-fit max-w-full rounded-2xl rounded-bl-md bg-raised px-3.5 py-2 text-[1.0625rem] leading-snug font-medium">{line}</p>
            </li>
          )
        })}
      </ul>
      <TinyAdd addUrl={addUrl} className="mt-6" />
    </section>
  )
}

function Confetti() {
  const bits = [
    ["8%", "14%", "#ffb547", -18],
    ["22%", "6%", "#ff5fa2", 24],
    ["70%", "9%", "#86efa0", -30],
    ["84%", "18%", "#ff8a5c", 12],
    ["92%", "6%", "#7cc7ff", 40],
    ["58%", "4%", "#ffb547", -8],
    ["40%", "10%", "#ff5fa2", 55],
  ] as const
  return (
    <span aria-hidden className="lp-confetti">
      {bits.map(([x, y, c, r], k) => (
        <i key={k} style={{ left: x, top: y, background: c, ["--r" as string]: `${r}deg`, ["--k" as string]: k }} />
      ))}
    </span>
  )
}

/* ---------- what's your group ---------- */

function Groups() {
  return (
    <section aria-labelledby="groups-title" className="mx-auto max-w-6xl px-5 pt-32 sm:px-8 lg:pt-40">
      <SectionHead id="groups-title" title="What's your group?">
        Tell Roomie what the group&apos;s for. It starts with the right Tricks.
      </SectionHead>
      <ul className="m-0 mt-10 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-3">
        {GROUP_KINDS.map((g) => (
          <li key={g.id} className="flex flex-col gap-2.5 rounded-3xl border bg-card p-4 sm:gap-3 sm:p-5">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-owed-soft text-owed sm:size-10">
                <ToolkitIcon name={g.icon} className="size-5" />
              </span>
              <h3 className="m-0 text-lg leading-tight font-extrabold tracking-[-0.02em] sm:text-[1.625rem]">{g.label}</h3>
            </div>
            <p className="m-0 text-[0.875rem] leading-snug text-muted-foreground sm:text-[0.9375rem]">{g.scenario}</p>
            <ul aria-label={`${g.label} starts with`} className="m-0 mt-auto flex list-none flex-wrap gap-1.5 p-0">
              {g.tricks.map((t) => (
                <li key={t} style={accent(t)} className="inline-flex items-center gap-1.5 rounded-full bg-raised py-0.5 pr-2.5 pl-1.5 text-[0.8125rem] font-medium">
                  <span aria-hidden className="size-2 rounded-full bg-(--accent)" />
                  {trickName(t)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ---------- how it works ---------- */

const STEPS: { title: string; body: ReactNode }[] = [
  { title: "Add it to the group", body: "Telegram today. WhatsApp is in beta." },
  { title: "Answer one question", body: "What the group's for. It picks the Tricks." },
  { title: "Get your dashboard", body: <>Say &ldquo;roomie send me the dashboard&rdquo;.</> },
]

function HowItWorks({ addUrl }: { addUrl: string }) {
  return (
    <section id="how" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-6 px-5 pt-32 sm:px-8 lg:pt-40">
      <SectionHead id="how-title" title="Up and running in a minute." />
      <ol className="m-0 mt-10 grid list-none gap-8 p-0 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-2">
            <span aria-hidden className="text-[3.5rem] leading-none font-extrabold tracking-[-0.05em] text-owed money">
              {i + 1}
            </span>
            <h3 className="m-0 text-xl font-extrabold tracking-[-0.015em]">{s.title}</h3>
            <p className="type-body m-0 max-w-[36ch] text-muted-foreground">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Button size="lg" nativeButton={false} render={<a href={addUrl} target="_blank" rel="noopener noreferrer" />}>
          <TelegramMark />
          Add to Telegram
          <span className="sr-only">(opens Telegram in a new tab)</span>
        </Button>
        <Link href="/help" className={cn(linkClass, "text-[0.9375rem] font-semibold")}>
          The full guide and FAQ
        </Link>
      </div>
      <div className="mt-14 grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-3xl border bg-card p-5">
          <Roomie mood="sleepy" size={52} animated className="-ml-1" />
          <h3 className="type-heading m-0">Speaks when spoken to</h3>
          <p className="type-body m-0 text-muted-foreground">Say &ldquo;roomie&rdquo;, @mention it or reply to it. Otherwise it naps.</p>
        </div>
        <div className="flex flex-col gap-2 rounded-3xl border bg-card p-5">
          <LockIcon aria-hidden className="m-3 size-7 text-owed" />
          <h3 className="type-heading m-0">Stays in your group</h3>
          <p className="type-body m-0 text-muted-foreground">Each group has its own memory. &ldquo;roomie forget me&rdquo; works.</p>
        </div>
        <div className="flex flex-col gap-2 rounded-3xl border bg-card p-5">
          <LayoutDashboardIcon aria-hidden className="m-3 size-7 text-owed" />
          <h3 className="type-heading m-0">A dashboard per group</h3>
          <p className="type-body m-0 text-muted-foreground">Balances, the Cart and the chore chart, for Members only.</p>
        </div>
      </div>
    </section>
  )
}

/* ---------- the dashboard, in phones ---------- */

const SCREENS = [
  { src: "/landing/dashboard-money.jpg", alt: "The Money page: Dev owes you $30.00, Sam owes you $12.50, and the Settle plan." },
  { src: "/landing/dashboard-home.jpg", alt: "The group's Home page: Roomie in its doorway, you're owed $42.50, today's chore and the Cart." },
  { src: "/landing/dashboard-chores.jpg", alt: "The Chores page: your turn to take out the trash, with Mark done and Pass it on." },
]

function DashboardPeek() {
  return (
    <section aria-labelledby="peek-title" className="dark mt-32 bg-forest text-foreground lg:mt-40">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-28">
        <SectionHead id="peek-title" title="Every group gets a dashboard." className="[&_h2]:text-mint [&_p]:text-mint/80">
          Settle up, tick off a chore, check the Cart. No scrolling back.
        </SectionHead>
        <ul className="m-0 -mx-5 mt-14 flex list-none snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-4 sm:mx-0 sm:justify-center sm:overflow-visible sm:px-0 lg:gap-10">
          {SCREENS.map((s, i) => (
            <li key={s.src} className={cn("w-[min(72vw,280px)] shrink-0 snap-center", i === 1 ? "sm:-translate-y-6" : "sm:translate-y-6", i === 0 && "sm:-rotate-3", i === 2 && "sm:rotate-3")}>
              <div className="overflow-hidden rounded-[2.25rem] border-[7px] border-[#1b262d] bg-[#0b141a] shadow-2xl shadow-black/50">
                <Image src={s.src} alt={s.alt} width={600} height={1116} sizes="(min-width: 640px) 280px, 72vw" className="block h-auto w-full" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ---------- WhatsApp beta ---------- */

function Beta({ addUrl }: { addUrl: string }) {
  return (
    <section id="whatsapp-beta" aria-labelledby="beta-title" className="mx-auto grid max-w-6xl scroll-mt-6 gap-10 px-5 pt-32 sm:px-8 lg:grid-cols-[1fr_1.35fr] lg:gap-16 lg:pt-40">
      <div className="flex flex-col gap-5">
        <Roomie mood="calm" size={72} animated />
        <SectionHead id="beta-title" title="Want it on WhatsApp?">
          WhatsApp is in a small beta. Tell us about your group.
        </SectionHead>
        <p className="type-body m-0 max-w-[44ch] text-muted-foreground">
          On Telegram?{" "}
          <a href={addUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            Add it to a group
          </a>{" "}
          and it starts right away.
        </p>
      </div>
      <BetaForm />
    </section>
  )
}

/* ---------- share ---------- */

function Share() {
  const s = shareLinks()
  return (
    <section aria-labelledby="share-title" className="mx-auto max-w-6xl px-5 pt-28 pb-24 sm:px-8">
      <div className="lp-share relative flex flex-col gap-6 overflow-hidden rounded-[2rem] border bg-card p-6 sm:flex-row sm:items-center sm:justify-between sm:p-10">
        <div className="flex items-center gap-4">
          <Roomie mood="happy" size={64} animated className="shrink-0" />
          <h2 id="share-title" className="m-0 text-[clamp(1.6rem,4vw,2.25rem)] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance">
            Know a group chat that needs this?
          </h2>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button nativeButton={false} render={<a href={s.telegram} target="_blank" rel="noopener noreferrer" />}>
            <TelegramMark />
            Send on Telegram
            <span className="sr-only">(opens Telegram in a new tab)</span>
          </Button>
          <Button variant="secondary" nativeButton={false} render={<a href={s.whatsapp} target="_blank" rel="noopener noreferrer" />}>
            <WhatsAppMark />
            Send on WhatsApp
            <span className="sr-only">(opens WhatsApp in a new tab)</span>
          </Button>
          <CopyLink url={s.url} />
        </div>
      </div>
    </section>
  )
}

/* ---------- footer ---------- */

function Footer({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-3">
          <Roomie size={36} decorative />
          <p className="type-caption m-0 text-muted-foreground">Free while in beta. Built with Mastra + Neon.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[0.9375rem]">
          <Link href="/help" className={linkClass}>
            How it works
          </Link>
          <Link href="/privacy" className={linkClass}>
            Privacy
          </Link>
          <Link href={signedIn ? APP_PATH : SIGNIN_PATH} className={linkClass}>
            {signedIn ? "Open dashboard" : "Sign in"}
          </Link>
          {signedIn ? <SignOutLink className={linkClass} /> : null}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  )
}
