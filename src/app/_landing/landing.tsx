import Image from "next/image"
import Link from "next/link"
import type { ReactNode } from "react"
import { LayoutDashboardIcon, LockIcon, MessageCircleIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Roomie } from "@/components/roomie/mascot"
import { ARCHETYPES, ARCHETYPE_IDS } from "@/lib/personality"
import { BetaForm } from "./beta-form"
import { ChatWindow, ReceiptPhoto } from "./chat"
import { DEMOS, HERO, VIBE_DEMO } from "./demos"
import "./landing.css"

export const GITHUB_URL = "https://github.com/sudhersankv/roommate-ops"

/** Telegram's "add to group" link: opens the group picker for the bot (t.me/<bot>?startgroup=<param>). */
export const telegramAddUrl = (username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || "imroomiebot") =>
  `https://t.me/${username}?startgroup=true`

const link = "underline decoration-2 underline-offset-4 decoration-primary hover:decoration-foreground"

/** The public landing page (`/` when signed out). Static content; only the beta form talks to the server. */
export function Landing() {
  const addUrl = telegramAddUrl()
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-background focus:px-4 focus:py-2">
        Skip to content
      </a>
      <Hero addUrl={addUrl} />
      <main id="main">
        <Demos />
        <Vibes />
        <HowItWorks addUrl={addUrl} />
        <DashboardPeek />
        <Beta />
      </main>
      <Footer />
    </>
  )
}

/* ---------- hero: the forest band, the promise, a chat playing ---------- */

function Hero({ addUrl }: { addUrl: string }) {
  return (
    // Brand art: the band is forest in both themes, so its tokens are the dark ones.
    <div className="dark overflow-x-clip bg-forest text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/" aria-label="Roomie" className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/roomie-logo-on-dark.svg" alt="" width={419} height={128} className="h-9 w-auto" />
        </Link>
        <nav aria-label="Site" className="flex items-center gap-1">
          <Button variant="ghost" size="sm" nativeButton={false} render={<a href="#how" />} className="hidden sm:inline-flex">
            How it works
          </Button>
          <Button variant="tint" size="sm" nativeButton={false} render={<Link href="/signin" />}>
            Sign in
          </Button>
        </nav>
      </header>

      <section aria-labelledby="hero-title" className="mx-auto grid max-w-6xl gap-12 px-5 pt-8 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-14 lg:pt-12">
        <div className="flex flex-col gap-6 lg:self-center lg:pb-12">
          <h1 id="hero-title" className="m-0 max-w-[14ch] text-[clamp(2.75rem,7vw,4.75rem)] leading-[0.95] font-extrabold tracking-[-0.045em] text-balance text-mint">
            The groupmate who remembers who paid.
          </h1>
          <p className="m-0 max-w-[36ch] text-lg leading-relaxed text-mint/80 sm:text-xl">
            Roomie is a little dino that lives in your group chat. It splits costs, keeps the shared Cart and tracks chores, and it only talks when you talk to it.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" nativeButton={false} render={<a href={addUrl} target="_blank" rel="noopener noreferrer" />}>
              <TelegramMark />
              Add to Telegram
              <span className="sr-only">(opens Telegram in a new tab)</span>
            </Button>
            <Button size="lg" variant="tint" nativeButton={false} render={<a href="#whatsapp-beta" />}>
              <WhatsAppMark />
              Join the WhatsApp beta
            </Button>
          </div>
          <p className="type-caption m-0 text-mint/70">Free while in beta.</p>
        </div>

        <div className="relative mx-auto w-full max-w-md lg:mx-0 lg:max-w-none">
          <Arches className="absolute -top-6 left-1/2 w-[min(130%,40rem)] max-w-none -translate-x-1/2 lg:-top-10" />
          <div className="relative pt-14">
            <Roomie mood="happy" size={84} animated className="absolute top-0 right-8 z-10 sm:right-12" />
            <ChatWindow lines={HERO} motion="play" label="An example group chat: Roomie logs the internet bill, says who owes what, and adds oat milk to the Cart." className="relative -mb-20 shadow-2xl shadow-black/40 lg:-mb-24" />
          </div>
        </div>
      </section>
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

/* ---------- the toolkits, as chats ---------- */

function SectionHead({ id, title, children, className }: { id: string; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex max-w-2xl flex-col gap-3", className)}>
      <h2 id={id} className="m-0 text-[clamp(2rem,5vw,3.25rem)] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance">
        {title}
      </h2>
      {children && <p className="m-0 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">{children}</p>}
    </div>
  )
}

function Demos() {
  return (
    <section aria-labelledby="demos-title" className="mx-auto max-w-6xl px-5 pt-36 sm:px-8 lg:pt-44">
      <SectionHead id="demos-title" title="It just lives in the chat.">
        No app to install and nothing new to learn. Say &ldquo;roomie&rdquo; and ask, the way you&apos;d ask the one friend who keeps track of everything.
      </SectionHead>
      <div className="mt-14 grid items-start gap-x-12 gap-y-16 md:grid-cols-2">
        {DEMOS.map((d) => (
          <article key={d.id} aria-labelledby={`demo-${d.id}`} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h3 id={`demo-${d.id}`} className="m-0 text-2xl font-extrabold tracking-[-0.02em]">
                {d.title}
              </h3>
              <p className="type-body m-0 max-w-[46ch] text-muted-foreground">{d.body}</p>
            </div>
            <ChatWindow
              label={`Example chat: ${d.title.toLowerCase()}`}
              lines={d.photo === "receipt" ? d.lines.map((l, i) => (i === 0 && "who" in l ? { ...l, photo: <ReceiptPhoto /> } : l)) : d.lines}
            />
          </article>
        ))}
      </div>
    </section>
  )
}

/* ---------- personality ---------- */

function Vibes() {
  return (
    <section aria-labelledby="vibes-title" className="mx-auto max-w-6xl px-5 pt-32 sm:px-8 lg:pt-40">
      <SectionHead id="vibes-title" title="Same facts, your group's voice.">
        Every group picks a vibe, a name and a few quirks for its Roomie. Over time it picks up how you talk, slowly, and never uses your slang more than you do.
      </SectionHead>
      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {VIBE_DEMO.map((v) => (
          <ChatWindow key={v.id} people={`Roomie's vibe: ${v.archetype.label.toLowerCase()} ${v.archetype.accessory}`} lines={v.lines} label={`The same chat with a ${v.archetype.label} Roomie`} />
        ))}
      </div>
      <ul aria-label="The six vibes" className="m-0 mt-10 flex list-none flex-wrap gap-2 p-0">
        {ARCHETYPE_IDS.map((id) => {
          const a = ARCHETYPES[id]
          return (
            <li key={id} className="flex items-center gap-2 rounded-full border bg-card py-2 pr-4 pl-2.5">
              <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-raised text-base">
                {a.accessory}
              </span>
              <span className="text-[0.9375rem]">
                <span className="font-semibold">{a.label}</span> <span className="text-muted-foreground">{a.tagline}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ---------- how it works ---------- */

const STEPS: { title: string; body: ReactNode }[] = [
  { title: "Add Roomie to your group", body: "On Telegram, today. WhatsApp is in a small beta. Roomie says hi and introduces itself." },
  { title: "Answer one question", body: "What the group's for, your currency and your city, in one reply. Roomie switches on what fits: splitting, the Cart, chores." },
  { title: "Get your dashboard by DM", body: <>Say &ldquo;roomie send me the dashboard&rdquo; and it messages you a private link to your group&apos;s page.</> },
]

const FACTS = [
  { icon: MessageCircleIcon, title: "Speaks when spoken to", body: "It answers when you say “roomie”, @mention it or reply to it. Otherwise it stays out of the way, apart from a morning nudge when chores are due and a weekly report." },
  { icon: LockIcon, title: "Stays in your group", body: "Each group has its own memory. Nothing crosses between groups, and “roomie forget me” wipes what it knows about you." },
  { icon: LayoutDashboardIcon, title: "A page per group", body: "Balances, the Cart, the chore chart and what Roomie did, on a dashboard only your group's Members can open." },
]

function HowItWorks({ addUrl }: { addUrl: string }) {
  return (
    <section id="how" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-6 px-5 pt-32 sm:px-8 lg:pt-40">
      <SectionHead id="how-title" title="Set up in about a minute." />
      <ol className="m-0 mt-12 grid list-none gap-10 p-0 md:grid-cols-3 md:gap-8">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-3">
            <span aria-hidden className="text-[3.5rem] leading-none font-extrabold tracking-[-0.05em] text-owed money">
              {i + 1}
            </span>
            <h3 className="m-0 text-xl font-extrabold tracking-[-0.015em]">{s.title}</h3>
            <p className="type-body m-0 max-w-[36ch] text-muted-foreground">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-10">
        <Button size="lg" nativeButton={false} render={<a href={addUrl} target="_blank" rel="noopener noreferrer" />}>
          <TelegramMark />
          Add to Telegram
          <span className="sr-only">(opens Telegram in a new tab)</span>
        </Button>
      </div>
      <div className="mt-16 grid gap-8 border-t pt-10 md:grid-cols-3">
        {FACTS.map((f) => (
          <div key={f.title} className="flex flex-col gap-2">
            <f.icon aria-hidden className="size-6 text-owed" />
            <h3 className="type-heading m-0">{f.title}</h3>
            <p className="type-body m-0 text-muted-foreground">{f.body}</p>
          </div>
        ))}
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
        <SectionHead id="peek-title" title="And a dashboard for the group." className="[&_h2]:text-mint [&_p]:text-mint/80">
          Everything Roomie keeps, on one page per group. Settle up, tick off a chore or check the Cart without scrolling back through the chat.
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

function Beta() {
  return (
    <section id="whatsapp-beta" aria-labelledby="beta-title" className="mx-auto grid max-w-6xl scroll-mt-6 gap-10 px-5 pt-32 pb-28 sm:px-8 lg:grid-cols-[1fr_1.35fr] lg:gap-16 lg:pt-40">
      <div className="flex flex-col gap-5">
        <Roomie mood="calm" size={72} animated />
        <SectionHead id="beta-title" title="Want Roomie on WhatsApp?">
          WhatsApp is in a small beta while we make sure Roomie behaves. Tell us about your group and we&apos;ll get it into your chat.
        </SectionHead>
        <p className="type-body m-0 max-w-[44ch] text-muted-foreground">
          On Telegram already? You don&apos;t need this.{" "}
          <a href={telegramAddUrl()} target="_blank" rel="noopener noreferrer" className={link}>
            Add Roomie to a Telegram group
          </a>{" "}
          and it starts right away.
        </p>
      </div>
      <BetaForm />
    </section>
  )
}

/* ---------- footer ---------- */

function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-3">
          <Roomie size={36} decorative />
          <p className="type-caption m-0 text-muted-foreground">Free while in beta. Built with Mastra + Neon.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[0.9375rem]">
          <Link href="/privacy" className={link}>
            Privacy
          </Link>
          <Link href="/signin" className={link}>
            Sign in
          </Link>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={link}>
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  )
}

/* ---------- marks ---------- */

function TelegramMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden data-icon="inline-start" fill="currentColor">
      <path d="M21.94 4.3 18.7 19.6c-.24 1.08-.88 1.35-1.78.84l-4.93-3.63-2.38 2.29c-.26.26-.48.48-.99.48l.35-5.02 9.14-8.26c.4-.35-.09-.55-.62-.2L6.2 13.2l-4.87-1.52c-1.06-.33-1.08-1.06.22-1.57L20.6 2.77c.88-.33 1.65.2 1.34 1.53Z" />
    </svg>
  )
}

function WhatsAppMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden data-icon="inline-start" fill="currentColor">
      <path d="M12.04 2a9.9 9.9 0 0 0-8.52 14.95L2 22l5.2-1.47A9.9 9.9 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.09.87.83-3-.2-.31a8.2 8.2 0 1 1 6.94 3.77Zm4.5-6.14c-.25-.12-1.46-.72-1.69-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.79.97-.14.16-.29.18-.54.06a6.7 6.7 0 0 1-1.97-1.22 7.4 7.4 0 0 1-1.37-1.7c-.14-.25-.01-.38.11-.5.11-.12.25-.29.37-.44.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.44-.06-.12-.56-1.35-.77-1.85-.2-.48-.4-.42-.56-.42h-.47a.9.9 0 0 0-.65.3 2.75 2.75 0 0 0-.86 2.05 4.78 4.78 0 0 0 1 2.54 10.9 10.9 0 0 0 4.18 3.69c.58.25 1.04.4 1.4.52.58.18 1.12.16 1.54.1.47-.07 1.46-.6 1.66-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.17-.48-.29Z" />
    </svg>
  )
}
