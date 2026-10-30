import { existsSync } from "node:fs"
import { join } from "node:path"
import Image from "next/image"
import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import { LayoutDashboardIcon, ListChecksIcon, LockIcon, MailIcon, MilkIcon, ShoppingCartIcon, ThumbsUpIcon, WalletIcon, type LucideIcon } from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ToolkitIcon } from "@/components/app/toolkit-icon"
import { Roomie } from "@/components/roomie/mascot"
import { SignOutLink } from "@/components/app/sign-out-link"
import { APP_PATH, SIGNIN_PATH } from "@/lib/auth/oauth-paths"
import { ARCHETYPES } from "@/lib/personality"
import { SHOW_COUNT_FROM } from "@/services/trick-votes"
import { manifestOf } from "@/toolkits/manifests"
import { BetaForm } from "./beta-form"
import { ChatWindow, ListPhoto, ReceiptPhoto, cuesFor, lineDelay, type ChatLine } from "./chat"
import { ADD_FLOW, DEMOS, HERO, VIBE_LINES, type Demo } from "./demos"
import { GITHUB_URL, TelegramMark, WhatsAppMark, linkClass, shareLinks, telegramAddUrl } from "./marks"
import { CopyLink } from "./share-row"
import { Reveal, Stage } from "./stage"
import { GROUP_KINDS, NEXT_TRICK, accentOf, builtTricks, comingSoonTricks, pageOf, taughtBy, trickName } from "./tricks"
import { VoteButton } from "./vote-button"
import "./landing.css"

export { GITHUB_URL, telegramAddUrl } from "./marks"

/** The headline, also used by the metadata and the share image (scripts/og-image.ts keeps its own copy). */
export const HEADLINE = "Roomie keeps the receipts."
export const SUBLINE = "Add it to your roommate group chat. It tracks who paid, keeps the grocery list, runs the chore chart, and does the asking, so nobody has to be that roommate."

const accent = (id: string) => ({ "--accent": accentOf(id) }) as CSSProperties
const vars = (v: Record<string, string | number>) => v as CSSProperties

/** The "See it in 90 seconds" video: shown only once both files are in public/landing (docs/landing.md). */
const VIDEO = { src: "/landing/roomie.mp4", poster: "/landing/roomie-poster.jpg", captions: "/landing/roomie.vtt" }
const publicFile = (path: string) => existsSync(join(process.cwd(), "public", path))

/**
 * The public landing page. Server components, except the stages (the dino watching a chat, the play-once reveals),
 * the vote buttons, the copy-link button and the beta form. `signedIn` only swaps the nav's Sign in for Open
 * dashboard; `votes` are the coming-soon Tricks' vote counts (shown from 5).
 */
export function Landing({ signedIn = false, votes = {} }: { signedIn?: boolean; votes?: Record<string, number> }) {
  const addUrl = telegramAddUrl()
  const video = publicFile(VIDEO.src) && publicFile(VIDEO.poster) ? { ...VIDEO, captions: publicFile(VIDEO.captions) ? VIDEO.captions : null } : null
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-background focus:px-4 focus:py-2">
        Skip to content
      </a>
      <Hero addUrl={addUrl} signedIn={signedIn} />
      <main id="main">
        <Pains />
        <HowItWorks addUrl={addUrl} />
        <Demos addUrl={addUrl} />
        {video && <Video {...video} />}
        <Tricks votes={votes} />
        <Groups />
        <Vibes addUrl={addUrl} />
        <DashboardPeek />
        <Beta addUrl={addUrl} />
        <TryIt addUrl={addUrl} />
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
          <img src="/brand/roomie-logo-on-dark.svg" alt="" width={419} height={128} fetchPriority="high" className="h-8 w-auto sm:h-9" />
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
          <p className="m-0 max-w-[44ch] text-base leading-snug text-pretty text-mint/80 sm:text-xl sm:leading-relaxed">{SUBLINE}</p>
          <CtaButtons addUrl={addUrl} />
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

/** Add to Telegram and WhatsApp beta, the page's two ways in. */
function CtaButtons({ addUrl, className }: { addUrl: string; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-2 sm:gap-3", className)}>
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
      {children && <p className="m-0 max-w-[46ch] text-base leading-snug text-pretty text-muted-foreground sm:text-lg sm:leading-relaxed">{children}</p>}
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
      Add to Telegram
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

/* ---------- sound familiar: the pains, each with what Roomie does about it ---------- */

const PAINS: { id: string; problem: string; fix: string; icon: LucideIcon; soon?: boolean; art: ReactNode }[] = [
  { id: "tab", problem: "Day 21 of asking for $4. They liked the request.", fix: "Roomie keeps the tab and hands out the pay buttons.", icon: WalletIcon, art: <ArtRequest /> },
  { id: "milk", problem: "Three cartons of eggs. Zero milk.", fix: "One shared Cart. Say it in the chat, it's on the list.", icon: ShoppingCartIcon, art: <ArtCartons /> },
  { id: "sink", problem: "The sink is a Jenga tower.", fix: "Chores rotate, and Roomie calls out whose turn it is.", icon: ListChecksIcon, art: <ArtPlates /> },
  { id: "inbox", problem: "The water shut off mid-shower. The email was in your inbox.", fix: "Soon: Roomie reads the leasing office's emails for you.", icon: MailIcon, soon: true, art: <ArtInbox /> },
]

function Pains() {
  return (
    <section aria-labelledby="pains-title" className="mx-auto max-w-6xl px-5 pt-36 sm:px-8 lg:pt-44">
      <SectionHead id="pains-title" title="Sound familiar?">
        Every shared place has these. Roomie takes the awkward jobs.
      </SectionHead>
      <ul className="m-0 mt-10 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {PAINS.map(({ id, problem, fix, icon: Icon, soon, art }) => (
          <li key={id} className="flex flex-col gap-4 rounded-3xl border bg-card p-4 sm:p-5">
            <Reveal className="h-28 overflow-hidden rounded-2xl bg-raised">{art}</Reveal>
            <div className="flex flex-col gap-2">
              {soon && <Badge variant="secondary">Coming soon</Badge>}
              <h3 className="m-0 text-xl leading-tight font-extrabold tracking-[-0.02em] text-pretty">{problem}</h3>
              <p className="type-body m-0 flex gap-2 text-muted-foreground">
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-owed" />
                <span>{fix}</span>
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A $4 request, seen and liked: the thumbs-up pops onto its corner. */
function ArtRequest() {
  return (
    <div aria-hidden className="flex size-full items-center justify-center">
      <div className="relative flex w-40 flex-col gap-0.5 rounded-2xl border bg-card px-3.5 py-2.5 shadow-sm">
        <span className="type-caption text-muted-foreground">Request, day 21</span>
        <span className="money text-2xl leading-none font-extrabold">$4.00</span>
        <span className="text-[0.6875rem] text-muted-foreground">Seen</span>
        <span className="lp-thumb absolute -top-3 -right-3 flex size-9 items-center justify-center rounded-full bg-owed text-background shadow-md">
          <ThumbsUpIcon className="size-4" />
        </span>
      </div>
    </div>
  )
}

/** Three egg cartons drop in next to an empty "milk?" slot. */
function ArtCartons() {
  return (
    <div aria-hidden className="flex size-full items-end justify-center gap-2 pb-4">
      {[0, 1, 2].map((k) => (
        <span key={k} style={vars({ "--k": k })} className="lp-carton relative flex h-7 w-12 items-start justify-around rounded-md border border-owe/40 bg-owe-soft px-1 pt-1">
          {[0, 1, 2].map((e) => (
            <span key={e} className="size-2.5 rounded-full bg-card" />
          ))}
        </span>
      ))}
      <span className="ml-1 flex h-16 w-12 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-muted-foreground/50 text-muted-foreground">
        <MilkIcon className="size-5 opacity-60" />
        <span className="text-[0.6875rem] font-semibold">milk?</span>
      </span>
    </div>
  )
}

/** A short stack of plates that wobbles once and holds. */
function ArtPlates() {
  // [nudge left/right, width]: plates, a bowl, a smaller plate, the pan on top.
  const plates: [number, number][] = [
    [0, 84],
    [4, 80],
    [-5, 84],
    [6, 60],
    [-3, 76],
    [7, 52],
    [-6, 70],
  ]
  return (
    <div aria-hidden className="flex size-full items-end justify-center pb-2.5">
      <span className="lp-plates flex flex-col-reverse items-center">
        {plates.map(([dx, w], k) => (
          <span
            key={k}
            style={{ ...vars({ "--dx": `${dx}px` }), width: w }}
            className="lp-plate -mt-0.5 block h-3.5 rounded-[50%] border-2 border-foreground/35 bg-card shadow-[inset_0_-3px_0_rgb(0_0_0/0.12)]"
          />
        ))}
      </span>
    </div>
  )
}

/** An inbox whose unread badge counts up to 47 (the last of TICKS, where it rests). */
const TICKS = [1, 4, 9, 16, 24, 33, 41, 47]

function ArtInbox() {
  return (
    <div aria-hidden className="flex size-full items-center justify-center">
      <span className="relative flex size-16 items-center justify-center rounded-2xl border bg-card text-muted-foreground shadow-sm">
        <MailIcon className="size-8" />
        <span className="money absolute -top-2.5 -right-3.5 h-6 overflow-hidden rounded-full bg-owe px-2 text-[0.8125rem] leading-6 font-extrabold text-background">
          <span style={vars({ "--n": TICKS.length - 1 })} className="lp-ticker flex flex-col">
            {TICKS.map((n) => (
              <span key={n} className="block h-6 text-center">
                {n}
              </span>
            ))}
          </span>
        </span>
      </span>
    </div>
  )
}

/* ---------- how it works: the real add flow ---------- */

const STEPS: { title: string; body: ReactNode }[] = [
  { title: "Add Roomie to the group", body: "Telegram today. WhatsApp is in beta." },
  { title: "Tell it what the group's for", body: "One reply covers it: roommates, a trip, friends. Currency and city if you like." },
  { title: "It learns the right Tricks", body: <>Roommates get all four. Say &ldquo;roomie send me the dashboard&rdquo; for your page.</> },
]

function HowItWorks({ addUrl }: { addUrl: string }) {
  const lines: ChatLine[] = [
    { who: "Roomie", text: ADD_FLOW.intro, time: "7:30 PM" },
    { who: "Maya", text: ADD_FLOW.answer, time: "7:31 PM", me: true },
    { who: "Roomie", text: ADD_FLOW.learned, time: "7:31 PM", after: <LearnedChips ids={ADD_FLOW.tricks} /> },
  ]
  // The dino lands as the chat starts and hops when the learned line does.
  const cues = { callMs: null, replyMs: null, winMs: Math.round((lineDelay(lines.length - 1) + 0.3) * 1000) }
  return (
    <section id="how" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-6 px-5 pt-32 sm:px-8 lg:pt-40">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div className="flex flex-col gap-10">
          <SectionHead id="how-title" title="Add it to the group chat. One question and it's set." />
          <ol className="m-0 flex list-none flex-col gap-7 p-0">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[3rem_1fr] gap-x-3">
                <span aria-hidden className="money text-[2.75rem] leading-none font-extrabold tracking-[-0.05em] text-owed">
                  {i + 1}
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="m-0 text-xl font-extrabold tracking-[-0.015em]">{s.title}</h3>
                  <p className="type-body m-0 max-w-[40ch] text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button size="lg" nativeButton={false} render={<a href={addUrl} target="_blank" rel="noopener noreferrer" />}>
              <TelegramMark />
              Add to Telegram
              <span className="sr-only">(opens Telegram in a new tab)</span>
            </Button>
            <Link href="/help" className={cn(linkClass, "text-[0.9375rem] font-semibold")}>
              The full guide and FAQ
            </Link>
          </div>
        </div>
        <Stage cues={cues} drop size={60} className="pt-9 lg:self-center" dinoClassName="top-0 right-8">
          <ChatWindow
            title={ADD_FLOW.title}
            people={ADD_FLOW.people}
            lines={lines}
            motion="stage"
            label={`Roomie joins Apt 4B. It says: "${ADD_FLOW.intro.replace(/\n/g, " ")}" Maya answers "${ADD_FLOW.answer}", and Roomie says: "${ADD_FLOW.learned}"`}
          />
        </Stage>
      </div>
      <div className="mt-16 grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-3xl border bg-card p-5">
          <Roomie mood="sleepy" size={52} animated className="-ml-1" />
          <h3 className="type-heading m-0">Mostly naps</h3>
          <p className="type-body m-0 text-muted-foreground">Say &ldquo;roomie&rdquo;, @mention it or reply to it. It chimes in only when it&apos;s clearly needed.</p>
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

/** The Tricks Roomie just learned, popping in one by one under its line. */
function LearnedChips({ ids }: { ids: readonly string[] }) {
  return (
    <ul aria-label="Tricks learned" className="m-0 flex max-w-[85%] list-none flex-wrap gap-1.5 p-0">
      {ids.map((id, k) => {
        const m = manifestOf(id)
        return (
          <li key={id} style={{ ...accent(id), ...vars({ "--k": k }) }} className="lp-learned inline-flex items-center gap-1.5 rounded-full bg-(--accent) py-1 pr-2.5 pl-2 text-[0.8125rem] font-semibold text-ink">
            {m && <ToolkitIcon name={m.icon} className="size-3.5" />}
            {trickName(id)}
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- the fixes, one chat each ---------- */

function Demos({ addUrl }: { addUrl: string }) {
  return (
    <section aria-labelledby="demos-title" className="mx-auto max-w-6xl px-5 pt-32 sm:px-8 lg:pt-40">
      <SectionHead id="demos-title" title="Say it in the chat. Roomie keeps track.">
        The list, the split, the chart. Nobody has to chase anyone.
      </SectionHead>
      <div className="mt-12 grid items-start gap-x-12 gap-y-16 md:grid-cols-2">
        {DEMOS.map((d) => (
          <article key={d.id} aria-labelledby={`demo-${d.id}`} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <TrickChip id={d.trick} />
              <h3 id={`demo-${d.id}`} className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-balance">
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
                lines={withPhoto(d)}
              />
              {d.totals && <Totals totals={d.totals} afterLine={d.lines.findIndex((l) => "who" in l && l.who === "Roomie")} />}
            </Stage>
            <TinyAdd addUrl={addUrl} />
          </article>
        ))}
      </div>
    </section>
  )
}

const withPhoto = (d: Demo): ChatLine[] => {
  const photo = d.photo === "receipt" ? <ReceiptPhoto /> : d.photo === "list" ? <ListPhoto /> : null
  return photo ? d.lines.map((l, i) => (i === 0 && "who" in l ? { ...l, photo } : l)) : d.lines
}

/** Each person's share, landing under the chat once Roomie's reply does (lines run down to them). */
function Totals({ totals, afterLine }: { totals: NonNullable<Demo["totals"]>; afterLine: number }) {
  return (
    <ul aria-label="Each person's share" style={vars({ "--at": `${lineDelay(afterLine) + 0.45}s` })} className="m-0 mt-4 grid list-none grid-cols-3 gap-2 p-0">
      {totals.map((t, k) => (
        <li key={t.who} style={vars({ "--k": k })} className="relative">
          <span aria-hidden className="lp-tick absolute -top-4 left-1/2 h-4 w-0.5 -translate-x-1/2 rounded-full bg-owed" />
          <span className="lp-total flex flex-col items-center rounded-2xl border bg-card px-2 py-2">
            <span className="type-caption text-muted-foreground">{t.who}</span>
            <span className="money text-lg leading-tight font-extrabold">{t.amount}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ---------- see it in 90 seconds (only once the video is in public/landing) ---------- */

function Video({ src, poster, captions }: { src: string; poster: string; captions: string | null }) {
  return (
    <section aria-labelledby="video-title" className="mx-auto max-w-6xl px-5 pt-32 sm:px-8 lg:pt-40">
      <SectionHead id="video-title" title="See it in 90 seconds." />
      <video controls preload="none" playsInline poster={poster} width={1280} height={720} className="mt-10 block aspect-video h-auto w-full rounded-3xl border bg-raised">
        <source src={src} type="video/mp4" />
        {captions && <track kind="captions" src={captions} srcLang="en" label="English" default />}
      </video>
    </section>
  )
}

/* ---------- Tricks: blocks that snap on, then what's next (vote) ---------- */

function Tricks({ votes }: { votes: Record<string, number> }) {
  const built = builtTricks()
  const next = manifestOf(NEXT_TRICK)
  // Bottom of the stack first: the first Trick is the base.
  const stack = [...built].reverse()
  return (
    <section id="tricks" aria-labelledby="tricks-title" className="mx-auto max-w-6xl scroll-mt-6 px-5 pt-32 sm:px-8 lg:pt-40">
      <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
        <div className="flex flex-col gap-5">
          <SectionHead id="tricks-title" title="Teach it Tricks. They snap on.">
            Each Trick brings its own page on the dashboard.
          </SectionHead>
          <p className="type-body m-0 max-w-[44ch] text-muted-foreground">
            Say &ldquo;roomie, learn chores&rdquo; in the chat, or tap Teach on the dashboard. &ldquo;roomie, forget chores&rdquo; takes it off again.
          </p>
        </div>
        <Reveal className="mx-auto w-full max-w-md lg:mx-0">
          <ul aria-label="Tricks, stacked: what Roomie knows, and what's next" className="m-0 flex list-none flex-col gap-2.5 p-0 pt-3">
            {next && (
              <li style={{ ...accent(next.id), ...vars({ "--k": built.length, "--dx": "-3px" }) }} className="lp-block lp-block-next relative flex items-center gap-3 rounded-2xl border-2 border-dashed border-(--accent) bg-card px-4 py-3">
                <Studs />
                <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--accent) text-ink">
                  <ToolkitIcon name={next.icon} className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-lg leading-tight font-extrabold tracking-[-0.015em]">{next.name}</span>
                    <Badge variant="secondary">Coming soon</Badge>
                  </span>
                  <span className="text-[0.875rem] leading-snug text-muted-foreground">{next.summary}</span>
                </span>
              </li>
            )}
            {stack.map((m, i) => {
              const page = pageOf(m)
              return (
                <li key={m.id} style={{ ...accent(m.id), ...vars({ "--k": stack.length - 1 - i, "--dx": `${[3, -3, 4, 0][i % 4]}px` }) }} className="lp-block relative flex items-center gap-3 rounded-2xl bg-(--accent) px-4 py-3 text-ink">
                  <Studs />
                  <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink/10">
                    <ToolkitIcon name={m.icon} className="size-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-lg leading-tight font-extrabold tracking-[-0.015em]">{m.name}</span>
                    <span className="text-[0.875rem] leading-snug text-ink/75">{m.summary}</span>
                  </span>
                  {page && <span className="hidden shrink-0 rounded-full bg-ink/10 px-2.5 py-0.5 text-[0.8125rem] font-semibold sm:inline">{page} page</span>}
                </li>
              )
            })}
          </ul>
        </Reveal>
      </div>

      <h3 className="type-heading m-0 mt-16 text-muted-foreground">Coming soon. Vote for what it learns next.</h3>
      <ul className="m-0 -mx-5 mt-4 flex list-none snap-x snap-mandatory gap-3 overflow-x-auto px-5 pt-2 pb-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-5">
        {comingSoonTricks().map((m) => (
          <li
            key={m.id}
            style={accent(m.id)}
            className={cn(
              "lp-trick is-soon flex w-[64vw] max-w-64 shrink-0 snap-start flex-col gap-2.5 rounded-3xl border border-dashed bg-card/60 p-4 sm:w-auto sm:max-w-none",
              m.id === NEXT_TRICK && "is-next border-solid ring-2 ring-(--accent)",
            )}
          >
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

/** The two bumps on top of a block. */
function Studs() {
  return (
    <span aria-hidden className="pointer-events-none absolute -top-2.5 left-5 flex gap-3">
      <span className="lp-stud block h-2.5 w-7 rounded-t-md bg-(--accent)" />
      <span className="lp-stud block h-2.5 w-7 rounded-t-md bg-(--accent)" />
    </span>
  )
}

/* ---------- vibes: one killer line each ---------- */

function Vibes({ addUrl }: { addUrl: string }) {
  return (
    <section aria-labelledby="vibes-title" className="mx-auto max-w-6xl px-5 pt-32 sm:px-8 lg:pt-40">
      <SectionHead id="vibes-title" title="It does the nagging. You pick the voice.">
        Six vibes. Then give it a name and a quirk or two.
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

/* ---------- what's your group: roommates first ---------- */

function Groups() {
  const [first, ...rest] = GROUP_KINDS
  return (
    <section aria-labelledby="groups-title" className="mx-auto max-w-6xl px-5 pt-32 sm:px-8 lg:pt-40">
      <SectionHead id="groups-title" title="What's your group?">
        Tell Roomie what the group&apos;s for. It starts with the right Tricks.
      </SectionHead>
      <div className="mt-10 flex flex-col gap-3">
        <div className="flex flex-col gap-3 rounded-3xl border border-owed/30 bg-owed-soft p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-7">
          <div className="flex items-center gap-3 sm:gap-4">
            <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full bg-owed text-background sm:size-14">
              <ToolkitIcon name={first.icon} className="size-6" />
            </span>
            <h3 className="m-0 text-[1.75rem] leading-tight font-extrabold tracking-[-0.025em] sm:text-[2.25rem]">{first.label}</h3>
          </div>
          <p className="m-0 text-[1rem] leading-snug sm:flex-1 sm:text-[1.0625rem]">{first.scenario}</p>
          <GroupTricks kind={first} />
        </div>
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-5">
          {rest.map((g) => (
            <li key={g.id} className="flex flex-col gap-2.5 rounded-3xl border bg-card p-4 sm:gap-3 sm:p-5">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-owed-soft text-owed sm:size-10">
                  <ToolkitIcon name={g.icon} className="size-5" />
                </span>
                <h3 className="m-0 text-lg leading-tight font-extrabold tracking-[-0.02em] sm:text-[1.375rem]">{g.label}</h3>
              </div>
              <p className="m-0 text-[0.875rem] leading-snug text-muted-foreground sm:text-[0.9375rem]">{g.scenario}</p>
              <GroupTricks kind={g} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function GroupTricks({ kind }: { kind: (typeof GROUP_KINDS)[number] }) {
  return (
    <ul aria-label={`${kind.label} starts with`} className="m-0 mt-auto flex list-none flex-wrap gap-1.5 p-0">
      {kind.tricks.map((t) => (
        <li key={t} style={accent(t)} className="inline-flex items-center gap-1.5 rounded-full bg-raised py-0.5 pr-2.5 pl-1.5 text-[0.8125rem] font-medium">
          <span aria-hidden className="size-2 rounded-full bg-(--accent)" />
          {trickName(t)}
        </li>
      ))}
    </ul>
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
          Balances, the Cart, the chore chart, and a page for every Trick you teach.
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

/* ---------- try it: the line again, the two ways in, and pass it on ---------- */

function TryIt({ addUrl }: { addUrl: string }) {
  const s = shareLinks()
  return (
    <section aria-labelledby="try-title" className="mx-auto max-w-6xl px-5 pt-28 pb-24 sm:px-8">
      <div className="lp-share relative flex flex-col gap-8 overflow-hidden rounded-[2rem] border bg-card p-6 sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Roomie mood="happy" size={64} animated className="shrink-0" />
            <h2 id="try-title" className="m-0 text-[clamp(1.75rem,4.5vw,2.75rem)] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance">
              Roomie keeps the receipts. Try it.
            </h2>
          </div>
          <CtaButtons addUrl={addUrl} className="sm:shrink-0" />
        </div>
        <Separator />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="type-heading m-0">Know a group chat that needs this?</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" nativeButton={false} render={<a href={s.telegram} target="_blank" rel="noopener noreferrer" />}>
              <TelegramMark />
              Send on Telegram
              <span className="sr-only">(opens Telegram in a new tab)</span>
            </Button>
            <Button variant="secondary" size="sm" nativeButton={false} render={<a href={s.whatsapp} target="_blank" rel="noopener noreferrer" />}>
              <WhatsAppMark />
              Send on WhatsApp
              <span className="sr-only">(opens WhatsApp in a new tab)</span>
            </Button>
            <CopyLink url={s.url} size="sm" />
          </div>
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
