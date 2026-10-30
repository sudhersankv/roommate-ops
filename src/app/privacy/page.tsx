import type { Metadata } from "next"
import Link from "next/link"
import type { ReactNode } from "react"

import { Roomie } from "@/components/roomie/mascot"

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Roomie sends where, what it keeps and for how long, who can see it, and how to make it forget you.",
}

const link = "underline decoration-2 underline-offset-4 decoration-primary hover:decoration-foreground"

/**
 * The privacy page linked from the landing page's footer. It has to say what the code does (audit B4): keep it in step
 * with ADR 0006, jobs/retention.ts, services/members.ts forgetMe and services/groups.ts deleteGroupData.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 py-14 sm:py-20">
      <header className="flex flex-col gap-5">
        <Link href="/" aria-label="Roomie home" className="w-fit rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Roomie size={56} decorative />
        </Link>
        <h1 className="m-0 text-[clamp(2.25rem,6vw,3.25rem)] leading-[1.02] font-extrabold tracking-[-0.035em]">Privacy</h1>
        <p className="m-0 text-lg leading-relaxed text-muted-foreground">
          Roomie lives in your group chat, so it reads the group&apos;s messages. Here&apos;s what it sends where, what it keeps and for how long, who can see it, and how
          to make it forget.
        </p>
      </header>

      <Part title="Where your messages go">
        <ul>
          <li>
            <strong>Every message</strong> in the group, with the 6 before it, goes to a small AI model (TypeSafe&apos;s Jev, through Neon&apos;s AI Gateway) that
            decides whether Roomie should answer. That&apos;s how it knows when it&apos;s being talked to.
          </li>
          <li>
            Messages for Roomie (addressed to it, or ones it decides to chime in on) go to Anthropic&apos;s Claude, also through Neon&apos;s AI Gateway, with up to 30
            recent lines of the chat, what it remembers about the group and what Members asked it to remember. Photos it&apos;s asked to read, like receipts, go there
            too. So do private messages to Roomie and questions from the dashboard.
          </li>
          <li>Voice notes addressed to it are sent to Google&apos;s Gemini (through OpenRouter) to turn them into text.</li>
          <li>About every 50 messages, a batch goes to a small Claude model that picks out how the group talks (phrases, emoji), and about 1 in 10 replies is checked by it for quality.</li>
          <li>The messages it passes to Claude, and its replies, are turned into search vectors on Neon&apos;s AI Gateway, so it can recall earlier conversations.</li>
          <li>Splitwise and Instacart only get what you ask Roomie to send them.</li>
        </ul>
        <p>We don&apos;t sell your data, show ads, or use your group&apos;s messages for anything but your group.</p>
      </Part>

      <Part title="What Roomie keeps, and for how long">
        <p>Per group, in a Postgres database on Neon (photos are files on our server, on Fly.io):</p>
        <ul>
          <li>
            <strong>Chat messages: 30 days.</strong> Every message in the group is saved so Roomie can follow the conversation. A job deletes older ones every day.
          </li>
          <li>
            <strong>Its memory of conversations: 30 days.</strong> The messages it passed to Claude and its replies, deleted the same way.
          </li>
          <li>
            <strong>Debug records (traces): 30 days.</strong> For each message: who sent it, what Roomie decided, and, when it went to Claude, what the AI models were
            given and said back. A message that didn&apos;t go to Claude keeps no text in its own record, but it can appear as recent chat in the record of a later
            message that did.
          </li>
          <li>
            <strong>Until you delete them:</strong> Expenses, Settlements, the Cart and Recipes, Chores, upkeep and Reminders, the Activity of who changed what, what a
            Member asked it to remember (a diet, a Venmo handle), counts of how the group talks, and photos sent to it.
          </li>
          <li>
            <strong>Who&apos;s who:</strong> each Member&apos;s name and Telegram id, or on WhatsApp their phone number (that&apos;s their WhatsApp id) and the number
            behind the ids WhatsApp shows in groups. If you open the dashboard, your Google name and email; Neon, which runs the sign-in, keeps your sessions (IP address
            and browser).
          </li>
          <li>
            <strong>Our server&apos;s logs</strong> (on Fly.io) note each message with the sender&apos;s name and its first few words, and Fly.io keeps them for a limited time.
          </li>
          <li>Database backups cover the last 7 days, so something deleted can live in a backup for up to a week.</li>
        </ul>
      </Part>

      <Part title="Who can see it">
        <p>
          Members of a group see its dashboard; each group is separate, and Roomie in one group can&apos;t see another group&apos;s messages, money or notes, even when
          the same person is in both. The people who run Roomie can see everything above, including the debug records, and look at it to fix problems and stop abuse.
        </p>
      </Part>

      <Part title="Making it forget">
        <p>
          Say <strong>&ldquo;roomie forget me&rdquo;</strong> in the group and Roomie deletes, for that group: your chat messages, what it remembered about you, your
          messages in its memory (under any name you had) and its replies that name you, the photos of yours it read, reminders set for you, the debug records of your messages
          (and of others&apos; messages that carried your lines as context), and the WhatsApp number pairing behind your id. Your name in the Activity becomes &ldquo;Former member&rdquo;, and you leave the group&apos;s Members (if you write again, you&apos;re a
          new member an Admin approves).
        </p>
        <p>
          What stays: Expenses and Shares you were part of (as &ldquo;Former member&rdquo;), so everyone else&apos;s Balances still add up, with any receipt photo on
          them; what other people said about you; the logs and backups above until they expire.
        </p>
        <p>
          An Admin can delete the whole group&apos;s data from the dashboard&apos;s Settings: every Expense, list, chat message, note, photo, debug record and
          Roomie&apos;s memory for that group. The group, its Members and settings stay, so Roomie keeps working.
        </p>
      </Part>

      <Part title="The WhatsApp beta form">
        <p>
          What you send in the form (name, email, group, an optional number and note) is only used to set you up with Roomie, and isn&apos;t added to any list. We also
          keep your browser name and a scrambled code made from your IP address (not the address) to spot spam; votes for upcoming Tricks keep only that code.
        </p>
      </Part>

      <Part title="Questions">
        <p>
          Ask through the{" "}
          <Link href="/#whatsapp-beta" className={link}>
            form on the home page
          </Link>{" "}
          and say it&apos;s about privacy, for example to have your data deleted. We&apos;ll get back to you. How Roomie works day to day is on{" "}
          <Link href="/help" className={link}>
            the help page
          </Link>
          .
        </p>
      </Part>
    </main>
  )
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="type-title m-0">{title}</h2>
      <div className="type-body flex flex-col gap-3 text-[1rem] leading-relaxed text-foreground/90 [&_li]:pl-1 [&_p]:m-0 [&_ul]:m-0 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5">{children}</div>
    </section>
  )
}
