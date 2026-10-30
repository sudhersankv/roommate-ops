import type { Metadata } from "next"
import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import { ChevronDownIcon } from "lucide-react"
import "./help.css"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ToolkitIcon } from "@/components/app/toolkit-icon"
import { Roomie } from "@/components/roomie/mascot"
import { ARCHETYPES, ARCHETYPE_IDS } from "@/lib/personality"
import { GITHUB_URL, TelegramMark, linkClass, telegramAddUrl } from "../_landing/marks"
import { accentOf, builtTricks, comingSoonTricks, taughtBy, teachLine } from "../_landing/tricks"

const TITLE = "How Roomie works"
const DESCRIPTION =
  "Add Roomie to a Telegram or WhatsApp group, tell it what the group's for, and talk to it by name. Tricks, the dashboard, vibes, privacy and answers to common questions."

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
  ["vibes", "Vibes"],
  ["privacy", "Privacy"],
  ["faq", "FAQ"],
] as const

/** /help: how Roomie works, for someone new. Public and indexable. Facts come from the toolkit manifests and ARCHETYPES. */
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
          <Button size="sm" nativeButton={false} render={<a href={addUrl} target="_blank" rel="noopener noreferrer" />}>
            <TelegramMark />
            Add to Telegram
            <span className="sr-only">(opens Telegram in a new tab)</span>
          </Button>
        </header>
        <div className="mx-auto flex max-w-3xl items-end justify-between gap-6 px-5 pt-6 pb-10 sm:px-8 sm:pt-10">
          <div className="flex flex-col gap-3">
            <h1 className="m-0 text-[clamp(2.4rem,7vw,3.75rem)] leading-[0.98] font-extrabold tracking-[-0.04em] text-mint">How Roomie works</h1>
            <p className="m-0 max-w-[40ch] text-base leading-snug text-mint/80 sm:text-lg">Everything a new person in the group needs, on one page.</p>
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
          <p>Roomie is an AI that joins your group chat. It&apos;s a little dino that becomes the group&apos;s newest member.</p>
          <p>It knows Tricks: splitting costs, the shared grocery Cart, chores. Teach it more whenever you like.</p>
          <p>Any group works: roommates, a trip, friends, family, a team, a club.</p>
        </Part>

        <Part id="add" title="Add it to a group">
          <p>
            <strong>Telegram:</strong> open{" "}
            <a href={addUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {addUrl.replace(/^https:\/\//, "").replace(/\?.*$/, "")}
            </a>
            , pick your group, done. Whoever adds it becomes its first Admin.
          </p>
          <p>
            <strong>WhatsApp</strong> is in a small beta.{" "}
            <Link href="/#whatsapp-beta" className={linkClass}>
              Ask to join
            </Link>{" "}
            and we&apos;ll get it into your group.
          </p>
        </Part>

        <Part id="joins" title="What happens when it joins">
          <ol>
            <li>It says hi and introduces itself in one short message.</li>
            <li>It asks one setup question: what&apos;s the group for, your currency, your city, and which vibe. One reply covers it all.</li>
            <li>Skip it and it uses the defaults: USD, Chicago time, the chill vibe, and Money, Groceries and House.</li>
          </ol>
          <p>On Telegram it also asks everyone to press Start with @imroomiebot once, so it can message you privately.</p>
        </Part>

        <Part id="talk" title="Talking to it">
          <p>Roomie answers when you:</p>
          <ul>
            <li>say &ldquo;roomie&rdquo; (or the name your group gave it) anywhere in a message,</li>
            <li>@mention it, or</li>
            <li>reply to one of its messages.</li>
          </ul>
          <p>
            It mostly answers when addressed. Sometimes it chimes in when a message is clearly for it, and it answers voice notes addressed to it. It also posts a short
            hello once a day, a cheer when someone hits a streak, and a morning nudge when a chore is due.
          </p>
          <p>
            Send <Kbd>/pet</Kbd> and it tells you about its day.
          </p>
        </Part>

        <Part id="tricks" title="Tricks">
          <p>
            A Trick is something Roomie knows how to do. To teach it one, say <q>{teachLine({ name: "House" })}</q>, or switch it on in the dashboard&apos;s Settings (Admins).
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
                <p className="type-caption m-0 text-muted-foreground">On from the start for {taughtBy(m.id).join(", ")}.</p>
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
          <p>Every group gets its own page: Balances, the Cart, the chore chart and what Roomie did.</p>
          <p>
            To get in, say <q>roomie send me the dashboard</q>. It messages you a private link. Open it and sign in with Google once. The link is yours alone, so
            don&apos;t forward it: everyone asks for their own.
          </p>
          <dl>
            <dt>Members</dt>
            <dd>Everyone in the group that Roomie knows. Members can open the dashboard and log things.</dd>
            <dt>Admins</dt>
            <dd>Whoever added Roomie, plus anyone they promote. Admins approve people, teach or drop Tricks, and change the vibe, name and settings.</dd>
            <dt>Pending</dt>
            <dd>
              Someone who joined after Roomie did. Roomie answers them but won&apos;t log anything for them until an Admin approves, with <q>roomie approve Priya</q> or on
              the Members page.
            </dd>
          </dl>
        </Part>

        <Part id="vibes" title="Vibes">
          <p>Each group picks how its Roomie talks. The facts are the same in every vibe.</p>
          <ul className="not-prose m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {ARCHETYPE_IDS.map((id) => {
              const a = ARCHETYPES[id]
              return (
                <li key={id} className="flex items-center gap-3 rounded-2xl border bg-card px-3 py-2.5">
                  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-lg">
                    {a.accessory}
                  </span>
                  <span className="text-[0.9375rem] leading-snug">
                    <span className="font-semibold">{a.label}</span> <span className="text-muted-foreground">{a.tagline}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          <p>An Admin can also give it a name and up to three quirks (&ldquo;obsessed with the plant&rdquo;).</p>
        </Part>

        <Part id="privacy" title="Privacy">
          <p>Each group is separate: its own memory, its own dashboard. Nothing crosses between groups.</p>
          <p>
            Every message goes to a small AI model that decides whether Roomie should answer; the ones it answers go to Claude. Chat messages, its memory of
            conversations and its debug records are kept for 30 days, then deleted. Say <q>roomie forget me</q> and it deletes what it knows about you and takes you out of
            the group&apos;s Members. What goes where, and who can see it, is on the{" "}
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
            <p className="type-heading m-0">Ready when your group is.</p>
          </div>
          <Button nativeButton={false} render={<a href={addUrl} target="_blank" rel="noopener noreferrer" />}>
            <TelegramMark />
            Add to Telegram
            <span className="sr-only">(opens Telegram in a new tab)</span>
          </Button>
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

/** The FAQ. `text` is the plain answer for search engines (FAQPage JSON-LD); `a` is what the page shows. */
const FAQ: { q: string; a: ReactNode; text: string }[] = [
  {
    q: "Is it free?",
    a: <p>Yes, while it&apos;s in beta.</p>,
    text: "Yes, while it's in beta.",
  },
  {
    q: "Does it read everything we say?",
    text: "Yes. Every message, with the few before it, goes to a small AI model that decides whether Roomie should answer. It mostly answers when addressed; sometimes it chimes in, and it answers voice notes addressed to it. What it answers goes to Claude with recent chat for context. Chat messages, its memory of conversations and its debug records are deleted after 30 days. Each group's memory is separate. The privacy page has the details.",
    a: (
      <>
        <p>
          Yes. Every message, with the few before it, goes to a small AI model that decides whether Roomie should answer. It mostly answers when addressed; sometimes
          it chimes in, and it answers voice notes addressed to it. What it answers goes to Claude with recent chat for context.
        </p>
        <p>
          Chat messages, its memory of conversations and its debug records are deleted after 30 days. Each group&apos;s memory is separate. The{" "}
          <Link href="/privacy" className={linkClass}>
            privacy page
          </Link>{" "}
          has the details.
        </p>
      </>
    ),
  },
  {
    q: "Can it message people privately?",
    text: "Yes, for private things like your dashboard link. On Telegram, only people who pressed Start with @imroomiebot (a Telegram rule). On WhatsApp, any Member of the group.",
    a: (
      <p>
        Yes, for private things like your dashboard link. On Telegram, only people who pressed Start with @imroomiebot (a Telegram rule). On WhatsApp, any Member
        of the group.
      </p>
    ),
  },
  {
    q: "Why didn't it answer?",
    text: "Most often the message didn't say roomie (or its name), @mention it or reply to it. Other reasons: you're Pending and an Admin hasn't approved you yet, the group hasn't taught it that Trick, or it was asked a lot in a short time and is pacing itself.",
    a: (
      <ul>
        <li>The message didn&apos;t say &ldquo;roomie&rdquo; (or its name), @mention it or reply to it.</li>
        <li>You&apos;re Pending: an Admin hasn&apos;t approved you yet.</li>
        <li>The group hasn&apos;t taught it that Trick. Say &ldquo;roomie, learn …&rdquo;.</li>
        <li>It got a lot of messages at once and is pacing itself. Try again in a minute.</li>
      </ul>
    ),
  },
  {
    q: "How do I change its vibe or name?",
    text: "An Admin says it in the chat (\"roomie, be gremlin\", \"roomie, your name is Dino\") or changes it in the dashboard under Settings, Personality.",
    a: (
      <p>
        An Admin says it in the chat (<q>roomie, be gremlin</q>, <q>roomie, your name is Dino</q>) or changes it in the dashboard under Settings → Personality.
      </p>
    ),
  },
  {
    q: "Can I turn a Trick off?",
    text: "Yes. An Admin says \"roomie, turn off chores\" or switches it off in the dashboard's Settings. What it kept stays, so turning it back on picks up where you left off.",
    a: <p>Yes. An Admin says <q>roomie, turn off chores</q> or switches it off in Settings. What it kept stays, so turning it back on picks up where you left off.</p>,
  },
  {
    q: "Can I use it in more than one group?",
    text: "Yes. Each group gets its own Roomie, memory and dashboard. Signed in with Google, you can switch between your groups on the dashboard.",
    a: <p>Yes. Each group gets its own Roomie, memory and dashboard. Signed in, you switch between your groups on the dashboard.</p>,
  },
  {
    q: "What's different on WhatsApp and Telegram?",
    text: "Telegram is open to everyone: add it yourself. Roomie meets people as they first speak, and can only message you privately after you press Start. WhatsApp is a beta that we set up with you; there Roomie knows everyone in the group from the start and can message any Member privately.",
    a: (
      <>
        <p>
          <strong>Telegram</strong> is open to everyone: add it yourself. Roomie meets people as they first speak, and can only message you privately after you press
          Start.
        </p>
        <p>
          <strong>WhatsApp</strong> is a beta we set up with you. There Roomie knows everyone in the group from the start and can message any Member privately.
        </p>
      </>
    ),
  },
  {
    q: "What does \"Pending\" mean?",
    text: "Someone who joined after Roomie did (on Telegram, anyone who first speaks more than a day after it joined). Roomie answers them but won't log anything for them until an Admin approves them in the chat or on the Members page.",
    a: (
      <p>
        Someone who joined after Roomie did (on Telegram, anyone who first speaks more than a day after it joined). Roomie answers them but won&apos;t log anything for
        them until an Admin approves them, in the chat or on the Members page.
      </p>
    ),
  },
  {
    q: "How do I remove it?",
    text: "Remove it from the group like any other member. To wipe what it kept, an Admin can delete the group's data in the dashboard's Settings first.",
    a: <p>Remove it from the group like any other member. To wipe what it kept, an Admin can delete the group&apos;s data in the dashboard&apos;s Settings first.</p>,
  },
  {
    q: "What does \"forget me\" delete?",
    text: "In that group: your chat messages, what Roomie remembered about you (like a diet or a Venmo handle), its memory of you under any name you had, the photos of yours it read and the debug records of your messages. You leave the group's Members and show as Former member; write again and you're a new member an Admin approves. Expenses you were part of stay so everyone else's Balances still add up.",
    a: (
      <p>
        In that group: your chat messages, what it remembered about you (a diet, a Venmo handle), its memory of you under any name you had, the photos of yours it read
        and the debug records of your messages. You leave the group&apos;s Members and show as &ldquo;Former member&rdquo;; write again and you&apos;re a new member an
        Admin approves. Expenses you were part of stay so everyone else&apos;s Balances still add up.
      </p>
    ),
  },
  {
    q: "Who runs this?",
    text: "A small independent team. Roomie is open source on GitHub, and the data lives in a Postgres database on Neon. We don't sell data or show ads.",
    a: (
      <p>
        A small independent team. Roomie is{" "}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
          open source on GitHub
        </a>
        , and the data lives in a Postgres database on Neon. No ads, and we don&apos;t sell data.
      </p>
    ),
  },
  {
    q: "Can it order groceries by itself?",
    text: "No. It turns the Cart into an Instacart shopping list; a person opens it and checks out. Then \"roomie I paid 84\" splits the shop by who added what.",
    a: <p>No. It turns the Cart into an Instacart list, and a person checks out. Then <q>roomie I paid 84</q> splits the shop by who added what.</p>,
  },
  {
    q: "Does it work with Venmo or Splitwise?",
    text: "Settle up gives you Venmo, PayPal or Cash App links with the amount filled in; Roomie never moves money itself. An Admin can bring in a Splitwise group's history, copy expenses to Splitwise, or keep the two in sync.",
    a: (
      <p>
        Settle up gives you Venmo, PayPal or Cash App links with the amount filled in; Roomie never moves money itself. An Admin can bring in a Splitwise group&apos;s
        history, copy expenses there, or keep the two in sync.
      </p>
    ),
  },
]

const faqJsonLd = () =>
  JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.text } })),
  }).replace(/</g, "\\u003c")
