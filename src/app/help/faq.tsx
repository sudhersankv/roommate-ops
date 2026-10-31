// The /help FAQ (docs/landing.md "/help"). `text` is the plain answer for search engines (FAQPage JSON-LD); `a` is
// what the page shows. They must say the same thing: faq.test.ts renders `a` and compares. No CSS import here, so
// the test can load it. Plain words about what Roomie does; no talk of models or the stack.
import Link from "next/link"
import type { ReactNode } from "react"

import { linkClass } from "../_landing/marks"

export type Faq = { q: string; a: ReactNode; text: string }

export const FAQ: Faq[] = [
  {
    q: "What can Roomie do?",
    text: "It's the roommate who keeps track. It splits rent and bills and knows who owes who, keeps one shared grocery list, keeps the chore chart fair, remembers the house stuff nobody does (the air filter, the smoke alarms), reminds people, and can handle the landlord's emails. You talk to it in the group chat like you'd talk to a roommate.",
    a: (
      <p>
        It&apos;s the roommate who keeps track. It splits rent and bills and knows who owes who, keeps one shared grocery list, keeps the chore chart fair, remembers the
        house stuff nobody does (the air filter, the smoke alarms), reminds people, and can handle the landlord&apos;s emails. You talk to it in the group chat like
        you&apos;d talk to a roommate.
      </p>
    ),
  },
  {
    q: "How do I talk to it?",
    text: "Say \"roomie\", @mention it or reply to it, and just say what's going on: you paid for pizza, you're out of eggs, the trash goes out Tuesday. It answers in a line or two, and stays out of conversations that aren't for it.",
    a: (
      <p>
        Say &ldquo;roomie&rdquo;, @mention it or reply to it, and just say what&apos;s going on: you paid for pizza, you&apos;re out of eggs, the trash goes out
        Tuesday. It answers in a line or two, and stays out of conversations that aren&apos;t for it.
      </p>
    ),
  },
  {
    q: "Is it free?",
    a: <p>Yes, while it&apos;s in beta.</p>,
    text: "Yes, while it's in beta.",
  },
  {
    q: "Does it read everything we say?",
    text: "It sees the group's messages so it can tell when someone's talking to it, but it only answers when it's addressed or clearly needed. Chat messages and its memory of conversations are deleted after 30 days, and each group's memory is separate. The privacy page has the details.",
    a: (
      <p>
        It sees the group&apos;s messages so it can tell when someone&apos;s talking to it, but it only answers when it&apos;s addressed or clearly needed. Chat messages
        and its memory of conversations are deleted after 30 days, and each group&apos;s memory is separate. The{" "}
        <Link href="/privacy" className={linkClass}>
          privacy page
        </Link>{" "}
        has the details.
      </p>
    ),
  },
  {
    q: "Can it message people privately?",
    text: "Yes. Your rent share, what you owe and your dashboard link come to you privately, and you can message it yourself, like asking what you owe or for a reminder on Friday. On Telegram, only after you press Start with @imroomiebot (a Telegram rule). On WhatsApp, anyone in the group.",
    a: (
      <p>
        Yes. Your rent share, what you owe and your dashboard link come to you privately, and you can message it yourself, like asking what you owe or for a reminder on
        Friday. On Telegram, only after you press Start with @imroomiebot (a Telegram rule). On WhatsApp, anyone in the group.
      </p>
    ),
  },
  {
    q: "Does it nag people about money in the group?",
    text: "No. If you've owed the same person more than $20 for over a week, Roomie reminds you privately, once a week, with a pay link. Nobody else sees it, and you can tell it to stop.",
    a: (
      <p>
        No. If you&apos;ve owed the same person more than $20 for over a week, Roomie reminds you privately, once a week, with a pay link. Nobody else sees it, and you
        can tell it to stop.
      </p>
    ),
  },
  {
    q: "Can it order groceries by itself?",
    text: "No. It turns the shared list into an Instacart list, and a person checks out. When you tell it what you paid, it splits the shop by who added what.",
    a: <p>No. It turns the shared list into an Instacart list, and a person checks out. When you tell it what you paid, it splits the shop by who added what.</p>,
  },
  {
    q: "Does it work with Venmo or Splitwise?",
    text: "Settling up gives you Venmo, PayPal or Cash App links with the amount filled in; Roomie never moves money itself. An Admin can bring in a Splitwise group's history, copy expenses there, or keep the two in sync.",
    a: (
      <p>
        Settling up gives you Venmo, PayPal or Cash App links with the amount filled in; Roomie never moves money itself. An Admin can bring in a Splitwise group&apos;s
        history, copy expenses there, or keep the two in sync.
      </p>
    ),
  },
  {
    q: "Does the landlord know it's a shared inbox?",
    text: "Yes. Every email it sends says it's the residents' shared inbox and names who asked. When a new landlord address shows up, Roomie offers to send a short intro email first, signed by everyone in the group.",
    a: (
      <p>
        Yes. Every email it sends says it&apos;s the residents&apos; shared inbox and names who asked. When a new landlord address shows up, Roomie offers to send a short
        intro email first, signed by everyone in the group.
      </p>
    ),
  },
  {
    q: "Does it work on iMessage?",
    text: "Soon, through a relay we run. Vote for it on the home page and we'll tell you when it's ready.",
    a: (
      <p>
        Soon, through a relay we run.{" "}
        <Link href="/#channels" className={linkClass}>
          Vote for it
        </Link>{" "}
        on the home page and we&apos;ll tell you when it&apos;s ready.
      </p>
    ),
  },
  {
    q: "Why didn't it answer?",
    text: "The message didn't say \"roomie\", @mention it or reply to it. You're Pending: an Admin hasn't approved you yet. The group hasn't taught it that Trick yet; an Admin can, on the dashboard's Tricks page or by asking it. It got a lot of messages at once and is pacing itself. Try again in a minute.",
    a: (
      <ul>
        <li>The message didn&apos;t say &ldquo;roomie&rdquo;, @mention it or reply to it.</li>
        <li>You&apos;re Pending: an Admin hasn&apos;t approved you yet.</li>
        <li>The group hasn&apos;t taught it that Trick yet; an Admin can, on the dashboard&apos;s Tricks page or by asking it.</li>
        <li>It got a lot of messages at once and is pacing itself. Try again in a minute.</li>
      </ul>
    ),
  },
  {
    q: "Can it forget a Trick?",
    text: "Yes. An Admin asks it to, or taps Forget on the dashboard's Tricks page. What it kept stays, so teaching it again picks up where you left off.",
    a: <p>Yes. An Admin asks it to, or taps Forget on the dashboard&apos;s Tricks page. What it kept stays, so teaching it again picks up where you left off.</p>,
  },
  {
    q: "Can I use it in more than one group?",
    text: "Yes. Each group gets its own Roomie, memory and dashboard. Signed in with Google, you can switch between your groups on the dashboard.",
    a: <p>Yes. Each group gets its own Roomie, memory and dashboard. Signed in with Google, you can switch between your groups on the dashboard.</p>,
  },
  {
    q: "What's different on WhatsApp and Telegram?",
    text: "WhatsApp is a beta we set up with you; there Roomie knows everyone in the group from the start and can message anyone privately. Telegram is open to everyone: add it yourself. Roomie meets people as they first speak, and can only message you privately after you press Start.",
    a: (
      <>
        <p>
          <strong>WhatsApp</strong> is a beta we set up with you; there Roomie knows everyone in the group from the start and can message anyone privately.
        </p>
        <p>
          <strong>Telegram</strong> is open to everyone: add it yourself. Roomie meets people as they first speak, and can only message you privately after you press
          Start.
        </p>
      </>
    ),
  },
  {
    q: "What does \"Pending\" mean?",
    text: "Someone who joined after Roomie did (on Telegram, anyone who first speaks more than a day after it joined). Roomie answers them but won't log anything for them until an Admin approves them, in the chat or on the Members page.",
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
    text: "In that group: your chat messages, what Roomie remembered about you (like a diet or a Venmo handle), its memory of you under any name you had, the photos of yours it read and the records of your messages. You leave the group's Members and show as Former member; write again and you're a new member an Admin approves. Expenses you were part of stay so everyone else's Balances still add up.",
    a: (
      <p>
        In that group: your chat messages, what Roomie remembered about you (like a diet or a Venmo handle), its memory of you under any name you had, the photos of yours
        it read and the records of your messages. You leave the group&apos;s Members and show as &ldquo;Former member&rdquo;; write again and you&apos;re a new member an
        Admin approves. Expenses you were part of stay so everyone else&apos;s Balances still add up.
      </p>
    ),
  },
  {
    q: "Who runs this?",
    text: "A small independent team. No ads, and we don't sell your data.",
    a: <p>A small independent team. No ads, and we don&apos;t sell your data.</p>,
  },
]

export const faqJsonLd = () =>
  JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.text } })),
  }).replace(/</g, "\\u003c")
