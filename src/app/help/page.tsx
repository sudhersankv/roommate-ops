import type { Metadata } from "next"
import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import { ChevronDownIcon } from "lucide-react"
import "./help.css"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ToolkitIcon } from "@/components/app/toolkit-icon"
import { Roomie } from "@/components/roomie/mascot"
import { GITHUB_URL, TelegramMark, WhatsAppMark, linkClass, telegramAddUrl } from "../_landing/marks"
import { accentOf, builtTricks, comingSoonTricks, onForRoommates, teachLine } from "../_landing/tricks"
import { FAQ, faqJsonLd } from "./faq"

const TITLE = "How Roomie works"
const DESCRIPTION =
  "Add Roomie to your apartment's group chat, answer one question, and talk to it by name. Rent, splits, groceries, chores and the landlord; the Tricks, the dashboard, privacy and answers to common questions."

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/help" },
  openGraph: { type: "article", siteName: "Roomie", title: `${TITLE} | Roomie`, description: DESCRIPTION, url: "/help", images: [{ url: "/landing/og.png", width: 1200, height: 630 }] },
}

const SECTIONS = [
  ["what", "What it is"],
  ["add", "Add it"],
  ["joins", "When it joins"],
  ["talk", "Talking to it"],
  ["tricks", "Tricks"],
  ["dashboard", "Dashboard"],
  ["privacy", "Privacy"],
  ["faq", "FAQ"],
] as const

/** /help: how Roomie works, for someone new to the apartment's chat. Public and indexable. The Tricks come from the manifests. */
export default function HelpPage() {
  const addUrl = telegramAddUrl()
  return (
    <>
      <div className="dark bg-forest text-foreground">
        <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" aria-label="Roomie home" className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/roomie-logo-on-dark.svg" alt="" width={419} height={128} className="h-8 w-auto" />
          </Link>
          <Button size="sm" nativeButton={false} render={<Link href="/#whatsapp-beta" />}>
            <WhatsAppMark />
            WhatsApp beta
          </Button>
        </header>
        <div className="mx-auto flex max-w-3xl items-end justify-between gap-6 px-5 pt-6 pb-10 sm:px-8 sm:pt-10">
          <div className="flex flex-col gap-3">
            <h1 className="m-0 text-[clamp(2.4rem,7vw,3.75rem)] leading-[0.98] font-extrabold tracking-[-0.04em] text-mint">How Roomie works</h1>
            <p className="m-0 max-w-[40ch] text-base leading-snug text-mint/80 sm:text-lg">Everything a new person in the apartment&apos;s chat needs, on one page.</p>
          </div>
          <Roomie mood="happy" size={88} animated className="hidden shrink-0 sm:block" />
        </div>
      </div>

      <nav aria-label="On this page" className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <ul className="m-0 mx-auto flex max-w-3xl list-none gap-1 overflow-x-auto px-3 py-2 sm:px-6">
          {SECTIONS.map(([id, label]) => (
            <li key={id} className="shrink-0">
              <a href={`#${id}`} className="block rounded-full px-3 py-1.5 text-[0.875rem] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-16 px-5 py-12 sm:px-8 sm:py-16">
        <Part id="what" title="What Roomie is">
          <p>Roomie is the roommate who actually keeps track. Add it to your apartment&apos;s group chat and it handles rent, splits, groceries, chores and the landlord, so none of you have to.</p>
          <p>
            It knows Tricks: Money, Groceries, House and Lease Inbox. Roommates start with the first three; Lease Inbox is taught when you&apos;re ready to give the landlord an
            address for the group.
          </p>
          <p>Not roommates? It works for trips and friends too.</p>
        </Part>

        <Part id="add" title="Add it to the group chat">
          <p>
            <strong>WhatsApp</strong> is in a small beta.{" "}
            <Link href="/#whatsapp-beta" className={linkClass}>
              Tell us about your apartment
            </Link>{" "}
            and we&apos;ll get Roomie into your group. Whoever adds it becomes its first Admin.
          </p>
          <p>
            <strong>Telegram</strong> works today: open{" "}
            <a href={addUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {addUrl.replace(/^https:\/\//, "").replace(/\?.*$/, "")}
            </a>
            , pick your group, done.
          </p>
          <p>Discord and iMessage are on the way. Vote for them on the home page.</p>
        </Part>

        <Part id="joins" title="What happens when it joins">
          <ol>
            <li>It says hi and introduces itself in one short message.</li>
            <li>It asks one setup question: what&apos;s the group for, your currency and your city. One reply covers it all.</li>
            <li>Skip it and it uses the defaults: USD, Chicago time and the roommates Tricks (Money, Groceries, House).</li>
            <li>When setup&apos;s done it posts one Join link: that&apos;s everyone&apos;s way into the dashboard.</li>
          </ol>
          <p>On Telegram it also asks everyone to press Start with @imroomiebot once, so it can message you privately.</p>
        </Part>

        <Part id="talk" title="Talking to it">
          <p>Roomie answers when you:</p>
          <ul>
            <li>say &ldquo;roomie&rdquo; anywhere in a message,</li>
            <li>@mention it, or</li>
            <li>reply to one of its messages.</li>
          </ul>
          <p>
            It mostly answers when addressed; sometimes it chimes in when a message is clearly for it, and it answers voice notes addressed to it. Once a morning it posts
            what matters today: rent due, a landlord visit, chores due, things you&apos;re probably low on. Otherwise it keeps quiet.
          </p>
          <p>
            You can also message it privately: <q>what do I owe</q>, <q>remind me Friday</q>. Your rent share and your pay links come that way too.
          </p>
          <p>
            Send <Kbd>/pet</Kbd> and it tells you about its day.
          </p>
        </Part>

        <Part id="tricks" title="Tricks">
          <p>
            A Trick is something Roomie knows how to do. To teach it one, say <q>{teachLine({ name: "Lease Inbox" })}</q>, or tap Teach on the dashboard&apos;s Tricks page
            (Admins). Three things to say for each:
          </p>
          <div className="not-prose mt-2 flex flex-col gap-3">
            {builtTricks().map((m) => (
              <section key={m.id} aria-labelledby={`trick-${m.id}`} style={{ "--accent": accentOf(m.id) } as CSSProperties} className="flex flex-col gap-3 rounded-3xl border bg-card p-5 text-foreground">
                <div className="flex items-center gap-3">
                  <span aria-hidden className="flex size-10 items-center justify-center rounded-2xl bg-(--accent) text-ink">
                    <ToolkitIcon name={m.icon} className="size-5" />
                  </span>
                  <h3 id={`trick-${m.id}`} className="type-title m-0">
                    {m.name}
                  </h3>
                </div>
                <p className="type-body m-0 text-muted-foreground">{m.summary}</p>
                <ul aria-label={`Things to say for ${m.name}`} className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {m.gate.examples.slice(0, 3).map((ex) => (
                    <li key={ex} className="w-fit max-w-full rounded-2xl rounded-bl-md bg-raised px-3 py-1.5 text-[0.9375rem]">
                      roomie, {ex}
                    </li>
                  ))}
                </ul>
                <p className="type-caption m-0 text-muted-foreground">{onForRoommates(m.id) ? "On from the start for roommates." : `Taught on purpose: “${teachLine(m)}”.`}</p>
              </section>
            ))}
          </div>
          <h3 className="type-heading m-0 mt-4 text-foreground">Coming soon</h3>
          <ul className="not-prose m-0 flex list-none flex-wrap gap-2 p-0">
            {comingSoonTricks().map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-full border border-dashed py-1.5 pr-3 pl-2 text-[0.9375rem] text-muted-foreground saturate-50">
                <ToolkitIcon name={m.icon} className="size-4" />
                {m.name}
                <Badge variant="secondary">Soon</Badge>
              </li>
            ))}
          </ul>
          <p>
            Want one sooner?{" "}
            <Link href="/#tricks" className={linkClass}>
              Vote for it
            </Link>
            .
          </p>
        </Part>

        <Part id="dashboard" title="The dashboard">
          <p>Every group gets its own page: rent and Balances, the Cart, the chore chart, the landlord&apos;s mail and what Roomie did.</p>
          <p>
            To get in, open the Join link Roomie posted when setup finished (or say <q>roomie send us the dashboard</q>). Sign in with Google once and pick your name. Your
            own private link also works: <q>roomie send me the dashboard</q>.
          </p>
          <dl>
            <dt>Members</dt>
            <dd>Everyone in the group that Roomie knows. Members can open the dashboard and log things.</dd>
            <dt>Admins</dt>
            <dd>Whoever added Roomie, plus anyone they promote. Admins approve people, teach Roomie Tricks or make it forget them, and change the group&apos;s settings.</dd>
            <dt>Pending</dt>
            <dd>
              Someone who joined after Roomie did. Roomie answers them but won&apos;t log anything for them until an Admin approves, with <q>roomie approve Priya</q> or on
              the Members page.
            </dd>
          </dl>
        </Part>

        <Part id="privacy" title="Privacy">
          <p>Each group is separate: its own memory, its own dashboard. Nothing crosses between groups.</p>
          <p>
            Every message goes to a small model that decides whether Roomie should answer; the ones it answers go to Claude. Chat messages, its memory of conversations and
            its debug records are kept for 30 days, then deleted. Say <q>roomie forget me</q> and it deletes what it knows about you and takes you out of the group&apos;s
            Members. What goes where, and who can see it, is on the{" "}
            <Link href="/privacy" className={linkClass}>
              privacy page
            </Link>
            .
          </p>
        </Part>

        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-16">
          <h2 id="faq-title" className="m-0 text-[clamp(1.75rem,4.5vw,2.5rem)] leading-[1.05] font-extrabold tracking-[-0.03em]">
            Questions
          </h2>
          <div className="mt-6 flex flex-col gap-2">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-2xl border bg-card open:bg-card">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-4 py-3.5 text-[1rem] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDownIcon aria-hidden className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                </summary>
                <div className="help-prose px-4 pb-4 text-muted-foreground">{f.a}</div>
              </details>
            ))}
          </div>
        </section>

        <div className="flex flex-col items-start gap-4 rounded-3xl border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Roomie mood="happy" size={52} animated />
            <p className="type-heading m-0">Ready when your apartment is.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button nativeButton={false} render={<Link href="/#whatsapp-beta" />}>
              <WhatsAppMark />
              WhatsApp beta
            </Button>
            <Button variant="secondary" nativeButton={false} render={<a href={addUrl} target="_blank" rel="noopener noreferrer" />}>
              <TelegramMark />
              Works on Telegram today
              <span className="sr-only">(opens Telegram in a new tab)</span>
            </Button>
          </div>
        </div>
      </main>

      <footer className="border-t">
        <nav aria-label="Footer" className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-5 py-8 text-[0.9375rem] sm:px-8">
          <Link href="/" className={linkClass}>
            Home
          </Link>
          <Link href="/privacy" className={linkClass}>
            Privacy
          </Link>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
            GitHub
          </a>
        </nav>
      </footer>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd() }} />
    </>
  )
}

function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-16 flex-col gap-4">
      <h2 id={`${id}-title`} className="m-0 text-[clamp(1.75rem,4.5vw,2.5rem)] leading-[1.05] font-extrabold tracking-[-0.03em]">
        {title}
      </h2>
      <div className="help-prose flex flex-col gap-3 text-[1.0625rem] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border bg-raised px-1.5 py-0.5 font-sans text-[0.9375rem] font-semibold text-foreground">{children}</kbd>
}
