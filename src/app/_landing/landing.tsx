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
import { SHOW_COUNT_FROM, SOON_CHANNELS } from "@/services/trick-votes"
import { BetaForm } from "./beta-form"
import { ChatWindow, cuesFor } from "./chat"
import { DEMOS, HERO } from "./demos"
import { TelegramMark, WhatsAppMark, linkClass, shareLinks, telegramAddUrl } from "./marks"
import { CopyLink } from "./share-row"
import { Peek } from "./peek"
import { Stage } from "./stage"
import { accentOf, builtTricks, comingSoonTricks } from "./tricks"
import { VoteButton } from "./vote-button"
import "./landing.css"

export { telegramAddUrl } from "./marks"

/** The words (ADR 0015). The headline is also the metadata's and the share image's (scripts/og-image.ts keeps its own copy). */
export const HEADLINE = "The roommate who actually keeps track."
export const SUBLINE = "A tiny dino that lives in your group chat. Rent, splits, groceries, chores and the landlord's emails: it keeps track, so nothing gets buried."
/** The launch video (unlisted YouTube Short), embedded without cookies. */
export const VIDEO_ID = "3wBbhV3xV8Q"
export const VIDEO_TITLE = "Nothing gets buried."
export const DEMOS_TITLE = "Five apps and a group mom. Or Roomie."
export const DEMOS_SUBLINE = "Splitwise, a list app, a chores app, calendar reminders and the landlord thread one of you is stuck forwarding. One roommate instead."
export const OTHER_GROUPS_LINE = "Not roommates? It works for trips and friends too."

const accent = (id: string) => ({ "--accent": accentOf(id) }) as CSSProperties

/**
 * The public landing page. Server components, except the stages (the dino watching a chat), the vote buttons, the
 * copy-link button and the beta form. `signedIn` only swaps the nav's Sign in for Open dashboard; `votes` are the
 * coming-soon Tricks' and Channels' vote counts (shown from 5).
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
        <Channels addUrl={addUrl} votes={votes} />
        <Video addUrl={addUrl} />
        <Demos addUrl={addUrl} />
        <Tricks votes={votes} />
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

/** The hero's buttons: Telegram first (it works today), the WhatsApp waitlist second. Reused after the demos. */
function AddButtons({ addUrl, size = "lg" }: { addUrl: string; size?: "lg" | "default" }) {
  const small = size === "lg" ? "max-sm:h-11 max-sm:px-4 max-sm:text-sm" : ""
  return (
    <div className="flex flex-wrap gap-2 sm:gap-3">
      <Button size={size} nativeButton={false} render={<a href={addUrl} target="_blank" rel="noopener noreferrer" />} className={small}>
        <TelegramMark />
        Add it on Telegram
        <span className="sr-only">(opens Telegram in a new tab)</span>
      </Button>
      <Button size={size} variant="tint" nativeButton={false} render={<a href="#whatsapp-beta" />} className={small}>
        <WhatsAppMark />
        WhatsApp waitlist
      </Button>
    </div>
  )
}

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
          <AddButtons addUrl={addUrl} />
          <p className="type-caption m-0 text-mint/70">Free while in beta.</p>
        </div>

        <div className="relative mx-auto w-full max-w-md lg:mx-0 lg:max-w-none">
          <Arches className="absolute -top-4 left-1/2 w-[min(130%,40rem)] max-w-none -translate-x-1/2 lg:-top-10" />
          <Stage cues={cuesFor(HERO.lines)} start="load" size={76} className="pt-12" dinoClassName="top-0 right-8 sm:right-12">
            <Peek free="right">
              <ChatWindow
                title={HERO.title}
                people={HERO.people}
                lines={HERO.lines}
                motion="stage"
                label="An example apartment chat: Sam asks if rent is this week, and Roomie says $2,400 is due Saturday and Maya pays the landlord. Dev paid $60 for internet, so Maya and Sam owe him $20 each. Maya asks about the landlord, and Roomie says a tech comes Thursday 1 to 3 and it will remind them Wednesday night."
                className="relative -mb-24 shadow-2xl shadow-black/40"
              />
            </Peek>
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

function TrickChip({ id, name }: { id: string; name: string }) {
  return (
    <span style={accent(id)} className="lp-chip inline-flex w-fit items-center gap-1.5 rounded-full bg-raised py-1 pr-3 pl-1.5 text-[0.8125rem] font-semibold">
      <span aria-hidden className="size-2.5 rounded-full bg-(--accent)" />
      {name} Trick
    </span>
  )
}

/* ---------- channels: the apps, in the order roommates use them ---------- */

/** The Soon Channels' marks and glows, by their vote id (services/trick-votes.ts SOON_CHANNELS). */
const CHANNEL_LOOK: Record<string, { mark: ReactNode; accent: string }> = {
  "channel:discord": { mark: <DiscordMark />, accent: "#8ea1ff" },
  "channel:imessage": { mark: <IMessageMark />, accent: "#5ee07a" },
}

/** WhatsApp (beta) · Telegram (today) · Discord and iMessage (Soon, with a vote each; the votes share trick_votes). */
function Channels({ addUrl, votes }: { addUrl: string; votes: Record<string, number> }) {
  const tile = "flex flex-col gap-2 rounded-3xl border bg-card p-4"
  const name = "flex items-center gap-2 font-extrabold tracking-[-0.01em] [&_svg]:size-5"
  return (
    <section id="channels" aria-labelledby="channels-title" className="mx-auto max-w-6xl scroll-mt-6 px-5 pt-32 sm:px-8 lg:pt-36">
      <h2 id="channels-title" className="type-heading m-0 text-muted-foreground">
        Where it lives
      </h2>
      <ul className="m-0 mt-4 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4">
        <li className={cn(tile, "relative")}>
          <span className={name}>
            <WhatsAppMark />
            WhatsApp
          </span>
          <Badge className="absolute -top-2.5 right-3">Beta</Badge>
          <a href="#whatsapp-beta" className={cn(linkClass, "w-fit text-[0.875rem] font-semibold")}>
            Ask to join
          </a>
        </li>
        <li className={tile}>
          <span className={name}>
            <TelegramMark />
            Telegram
          </span>
          <a href={addUrl} target="_blank" rel="noopener noreferrer" className={cn(linkClass, "w-fit text-[0.875rem] font-semibold")}>
            Works today
            <span className="sr-only">(opens Telegram in a new tab)</span>
          </a>
        </li>
        {SOON_CHANNELS.map((c) => (
          <li key={c.id} className="lp-trick is-soon relative flex flex-col gap-2 rounded-3xl border-2 border-dashed bg-card/60 p-4" style={{ ["--accent" as string]: CHANNEL_LOOK[c.id].accent }}>
            <span className={name}>
              {CHANNEL_LOOK[c.id].mark}
              {c.name}
            </span>
            <Badge variant="secondary" className="absolute -top-2.5 right-3">
              Soon
            </Badge>
            <VoteButton trickId={c.id} name={c.name} count={votes[c.id] ?? 0} showFrom={SHOW_COUNT_FROM} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function DiscordMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M19.27 5.33A17.3 17.3 0 0 0 15.02 4l-.2.4a16 16 0 0 1 3.9 1.95 13.4 13.4 0 0 0-13.44 0A16 16 0 0 1 9.18 4.4L8.98 4a17.3 17.3 0 0 0-4.25 1.33C2.03 9.37 1.3 13.3 1.66 17.17a17.4 17.4 0 0 0 5.2 2.63l1.1-1.78a11.2 11.2 0 0 1-1.76-.85l.43-.33a12.4 12.4 0 0 0 10.74 0l.43.33c-.56.33-1.15.62-1.76.85l1.1 1.78a17.4 17.4 0 0 0 5.2-2.63c.43-4.48-.73-8.37-3.07-11.84ZM8.68 14.8c-1.03 0-1.88-.95-1.88-2.12s.83-2.12 1.88-2.12c1.06 0 1.9.96 1.88 2.12 0 1.17-.83 2.12-1.88 2.12Zm6.64 0c-1.03 0-1.88-.95-1.88-2.12s.83-2.12 1.88-2.12c1.06 0 1.9.96 1.88 2.12 0 1.17-.82 2.12-1.88 2.12Z" />
    </svg>
  )
}

function IMessageMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12 3C6.48 3 2 6.8 2 11.5c0 2.6 1.37 4.93 3.53 6.5-.1 1.1-.5 2.3-1.3 3.4 1.9-.2 3.5-.9 4.7-1.9.98.27 2.02.42 3.07.42 5.52 0 10-3.8 10-8.5S17.52 3 12 3Z" />
    </svg>
  )
}

/* ---------- the launch video ---------- */

/** The launch video beside the two things it says. A vertical YouTube Short on youtube-nocookie.com, loaded lazily. */
function Video({ addUrl }: { addUrl: string }) {
  return (
    <section id="video" aria-labelledby="video-title" className="mx-auto grid max-w-6xl scroll-mt-6 items-center gap-10 px-5 pt-32 sm:px-8 md:grid-cols-[1fr_minmax(0,22rem)] lg:gap-16 lg:pt-40">
      <div className="flex flex-col gap-5">
        <SectionHead id="video-title" title={VIDEO_TITLE}>
          Two minutes in Apt 4B: the milk, the trash, the wifi money and the leasing office email nobody read.
        </SectionHead>
        <ul className="m-0 flex list-none flex-col gap-3 p-0 text-base leading-snug sm:text-lg">
          <li><span className="font-extrabold">Just talk to it.</span> <span className="text-muted-foreground">Say what you paid, what you need or what broke.</span></li>
          <li><span className="font-extrabold">Never calls anyone out.</span> <span className="text-muted-foreground">Who owes what is a private reminder, until it&apos;s paid.</span></li>
        </ul>
        <AddButtons addUrl={addUrl} size="default" />
      </div>
      <div className="mx-auto w-full max-w-[22rem] overflow-hidden rounded-[2rem] border-[7px] border-[#1b262d] bg-[#0b141a] shadow-2xl shadow-black/40">
        <div className="relative aspect-[9/16] w-full">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?rel=0&playsinline=1`}
            title="Roomie: Nothing gets buried (video)"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            className="absolute inset-0 size-full border-0"
          />
        </div>
      </div>
    </section>
  )
}

/* ---------- the demos: one per bucket ---------- */

function Demos({ addUrl }: { addUrl: string }) {
  return (
    <section aria-labelledby="demos-title" className="mx-auto max-w-6xl px-5 pt-32 sm:px-8 lg:pt-40">
      <SectionHead id="demos-title" title={DEMOS_TITLE}>
        {DEMOS_SUBLINE}
      </SectionHead>
      <div className="mt-12 grid items-start gap-x-12 gap-y-16 md:grid-cols-2">
        {DEMOS.map((d, i) => (
          <article key={d.id} aria-labelledby={`demo-${d.id}`} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <TrickChip id={d.trick.id} name={d.trick.name} />
              <h3 id={`demo-${d.id}`} className="m-0 text-2xl font-extrabold tracking-[-0.02em]">
                {d.title}
              </h3>
              <p className="type-body m-0 max-w-[44ch] text-muted-foreground">{d.body}</p>
            </div>
            <Stage cues={cuesFor(d.lines)} size={52} className="pt-9" dinoClassName="top-0 right-6">
              {/* Text sits right above each demo chat, so the dino peeks from its outer side only. */}
              <Peek free={i % 2 ? "right" : "left"} top={false}>
                <ChatWindow title={d.group.title} people={d.group.people} motion="stage" label={`Example chat in ${d.group.title}: ${d.title} ${d.body}`} lines={d.lines} />
              </Peek>
            </Stage>
          </article>
        ))}
        <div className="flex flex-col gap-4 self-center">
          <p className="m-0 max-w-[36ch] text-xl leading-snug font-extrabold tracking-[-0.02em] text-balance">Say &ldquo;roomie&rdquo; and ask. Or message it privately: &ldquo;what do I owe?&rdquo;</p>
          <AddButtons addUrl={addUrl} size="default" />
        </div>
      </div>
    </section>
  )
}

/* ---------- Tricks: blocks that snap onto Roomie, and the ones waiting (vote) ---------- */

// When the stack's last block lands (landing.css: block k starts at 0.12 s + k * 0.16 s and takes 0.42 s). The dino
// is asleep until the stack is on screen, awake as the first block lands, and hops when the last one does; the sheen
// and glow start then too (--land).
const landMs = (blocks: number) => 120 + Math.max(blocks - 1, 0) * 160 + 420
// A hand-stacked look: each block sits a few px off the one below it.
const NUDGE = ["0px", "5px", "-4px", "3px"]

function Tricks({ votes }: { votes: Record<string, number> }) {
  const built = builtTricks()
  const land = landMs(built.length)
  return (
    <section id="tricks" aria-labelledby="tricks-title" className="mx-auto max-w-6xl scroll-mt-6 px-5 pt-32 sm:px-8 lg:pt-40">
      <SectionHead id="tricks-title" title="Teach it Tricks. They snap on.">
        Roommates start with the stack. Each Trick brings its own page on the dashboard.
      </SectionHead>
      <div className="mt-10 grid items-start gap-14 lg:mt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
        <div className="flex w-full max-w-md flex-col gap-4 lg:sticky lg:top-10">
          <Stage cues={{ callMs: 300, replyMs: land + 30, winMs: land + 30 }} size={72} className="pt-16" dinoClassName="top-0 right-5">
            {/* Money first in the list, at the bottom of the stack. */}
            <ul aria-label="Tricks Roomie knows" style={{ ["--land" as string]: `${land / 1000}s` }} className="m-0 flex list-none flex-col-reverse gap-2.5 p-0">
              {built.map((m, k) => {
                const page = m.dashboard?.nav?.label
                return (
                  <li key={m.id} style={{ ...accent(m.id), ["--k" as string]: k, ["--dx" as string]: NUDGE[k % NUDGE.length] }} className="lp-block">
                    <div className="lp-brick flex items-center gap-3 rounded-2xl bg-(--accent) px-4 py-3.5 text-ink">
                      <Studs />
                      <span aria-hidden className="lp-sheen" />
                      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink/10">
                        <ToolkitIcon name={m.icon} className="size-5" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <h3 className="m-0 text-lg leading-tight font-extrabold tracking-[-0.015em] sm:text-xl">{m.name}</h3>
                        <span className="text-[0.875rem] leading-snug text-ink/75">{m.summary}</span>
                      </span>
                      {page && <span className="hidden shrink-0 rounded-full bg-ink/10 px-2.5 py-0.5 text-[0.8125rem] font-semibold sm:inline">{page} page</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Stage>
          <p className="type-caption m-0 text-muted-foreground">Say &ldquo;roomie, learn lease inbox&rdquo; in the chat, or tap Teach on the dashboard.</p>
        </div>

        <div className="flex flex-col gap-4">
          <h3 className="type-heading m-0 text-muted-foreground">Waiting to snap on. Vote for what it learns next.</h3>
          <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-5 p-0 pt-2 sm:grid-cols-3 lg:grid-cols-2">
            {comingSoonTricks().map((m) => (
              <li key={m.id} style={accent(m.id)} className="lp-trick is-soon relative flex min-w-0 flex-col gap-2 rounded-2xl border-2 border-dashed bg-card/60 p-3 sm:p-4">
                <Studs ghost />
                <div className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="lp-soon-icon flex size-8 shrink-0 items-center justify-center rounded-xl bg-(--accent) text-ink">
                    <ToolkitIcon name={m.icon} className="size-4" />
                  </span>
                  <h4 className="type-heading m-0 min-w-0 break-words">{m.name}</h4>
                </div>
                <Badge variant="secondary" className="absolute -top-2.5 right-3">
                  Soon
                </Badge>
                <p className="type-caption m-0 break-words text-muted-foreground">{m.summary}</p>
                <div className="mt-auto pt-1">
                  <VoteButton trickId={m.id} name={m.name} count={votes[m.id] ?? 0} showFrom={SHOW_COUNT_FROM} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="m-0 mt-12 text-base leading-snug text-muted-foreground sm:text-lg">{OTHER_GROUPS_LINE}</p>
    </section>
  )
}

/** The two bumps on top of a block: solid on a learned Trick, a dashed outline on one that's waiting. */
function Studs({ ghost = false }: { ghost?: boolean }) {
  const stud = ghost ? "border-2 border-b-0 border-dashed border-border bg-transparent" : "lp-stud bg-(--accent)"
  return (
    <span aria-hidden className="pointer-events-none absolute -top-2 left-5 flex gap-3">
      <span className={cn("block h-2 w-6 rounded-t-md", stud)} />
      <span className={cn("block h-2 w-6 rounded-t-md", stud)} />
    </span>
  )
}

/* ---------- how it works ---------- */

const STEPS: { title: string; body: ReactNode }[] = [
  { title: "Add it to the group chat", body: "WhatsApp is in beta; Telegram works today." },
  { title: "Answer one question", body: "What the group's for. It learns the right Tricks." },
  { title: "Then just talk to it", body: "In the chat, or privately. A dashboard comes with it, if you want it." },
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
        <AddButtons addUrl={addUrl} size="default" />
        <Link href="/help" className={cn(linkClass, "text-[0.9375rem] font-semibold")}>
          The full guide and FAQ
        </Link>
      </div>
      <div className="mt-14 grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-3xl border bg-card p-5">
          <Roomie mood="sleepy" size={52} animated className="-ml-1" />
          <h3 className="type-heading m-0">Never nags in the group</h3>
          <p className="type-body m-0 text-muted-foreground">Money and chore reminders go to you privately. In the group it speaks when spoken to, plus one morning post.</p>
        </div>
        <div className="flex flex-col gap-2 rounded-3xl border bg-card p-5">
          <LockIcon aria-hidden className="m-3 size-7 text-owed" />
          <h3 className="type-heading m-0">Stays in your group</h3>
          <p className="type-body m-0 text-muted-foreground">Each group has its own memory. Who owes what is said privately. &ldquo;roomie forget me&rdquo; works.</p>
        </div>
        <div className="flex flex-col gap-2 rounded-3xl border bg-card p-5">
          <LayoutDashboardIcon aria-hidden className="m-3 size-7 text-owed" />
          <h3 className="type-heading m-0">A dashboard per group</h3>
          <p className="type-body m-0 text-muted-foreground">Rent, Balances, the Cart, the chart and the landlord&apos;s mail, for Members only.</p>
        </div>
      </div>
    </section>
  )
}

/* ---------- the dashboard, in phones ---------- */

const SCREENS = [
  { src: "/landing/dashboard-money.jpg", alt: "The Money page: Dev owes you $30.00, Sam owes you $12.50, and the Settle plan." },
  { src: "/landing/dashboard-home.jpg", alt: "The group's Home page: Roomie in its doorway, you're owed $42.50, today's chore and the Cart." },
  { src: "/landing/dashboard-chores.jpg", alt: "The House page: your turn to take out the trash, with Mark done and Pass it on." },
]

function DashboardPeek() {
  return (
    <section aria-labelledby="peek-title" className="dark mt-32 bg-forest text-foreground lg:mt-40">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-28">
        <SectionHead id="peek-title" title="And a dashboard, if you want it." className="[&_h2]:text-mint [&_p]:text-mint/80">
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
          WhatsApp is in a small beta. Join the waitlist and we&apos;ll add you.
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
            Know an apartment chat that needs this?
          </h2>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button nativeButton={false} render={<a href={s.whatsapp} target="_blank" rel="noopener noreferrer" />}>
            <WhatsAppMark />
            Send on WhatsApp
            <span className="sr-only">(opens WhatsApp in a new tab)</span>
          </Button>
          <Button variant="secondary" nativeButton={false} render={<a href={s.telegram} target="_blank" rel="noopener noreferrer" />}>
            <TelegramMark />
            Send on Telegram
            <span className="sr-only">(opens Telegram in a new tab)</span>
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
          <p className="type-caption m-0 text-muted-foreground">Free while in beta.</p>
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
        </nav>
      </div>
    </footer>
  )
}
