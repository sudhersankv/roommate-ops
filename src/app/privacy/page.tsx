import type { Metadata } from "next"
import Link from "next/link"
import type { ReactNode } from "react"

import { Roomie } from "@/components/roomie/mascot"

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Roomie keeps about your group, how long, and how to make it forget you.",
}

const link = "underline decoration-2 underline-offset-4 decoration-primary hover:decoration-foreground"

/** The short privacy page linked from the landing page's footer. Keep it in step with ADR 0006 and docs/landing.md. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 py-14 sm:py-20">
      <header className="flex flex-col gap-5">
        <Link href="/" aria-label="Roomie home" className="w-fit rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Roomie size={56} decorative />
        </Link>
        <h1 className="m-0 text-[clamp(2.25rem,6vw,3.25rem)] leading-[1.02] font-extrabold tracking-[-0.035em]">Privacy</h1>
        <p className="m-0 text-lg leading-relaxed text-muted-foreground">
          Roomie is a groupmate, so it remembers things about your group. Here&apos;s what, for how long, and how to make it forget.
        </p>
      </header>

      <Part title="What Roomie keeps">
        <p>For each group it&apos;s in:</p>
        <ul>
          <li>The Members: the name and id each person has on Telegram or WhatsApp, and who&apos;s an Admin.</li>
          <li>What the group asked it to track: Expenses and Settlements, the Cart and Recipes, Chores, upkeep and Reminders, and the Activity of who changed what.</li>
          <li>The last 30 days of chat messages, so it can follow the conversation. Older messages are deleted every day.</li>
          <li>What a Member asked it to remember about them (a preferred name, a diet, a Venmo handle).</li>
          <li>Counts of how the group talks (common phrases, emoji, busy hours), used to match your group&apos;s style.</li>
        </ul>
        <p>If you open the dashboard, Roomie also keeps your Google name and email, to know which Member you are.</p>
      </Part>

      <Part title="Each group is separate">
        <p>
          Every group has its own memory and its own dashboard. Roomie in one group can&apos;t see another group&apos;s messages, money or notes, even when the same
          person is in both. Only Members of a group can open its dashboard.
        </p>
      </Part>

      <Part title="Making it forget">
        <p>
          Say <strong>&ldquo;roomie forget me&rdquo;</strong> in the group and Roomie deletes your chat messages, what it remembered about you and its memory of you.
          Expenses you were part of stay, so everyone else&apos;s Balances still add up, and you show as &ldquo;Former member&rdquo;.
        </p>
        <p>An Admin can delete the whole group&apos;s data from the dashboard&apos;s Settings, which wipes everything above for that group.</p>
      </Part>

      <Part title="Who else sees it">
        <p>
          Messages Roomie answers and receipt photos are sent to an AI model through Neon&apos;s AI Gateway to write the reply, and voice notes to a speech-to-text
          model. The data lives in a Postgres database on Neon. Splitwise and Instacart only get what you ask Roomie to send them. We don&apos;t sell your data, show you ads or use your group&apos;s messages for anything but your group.
        </p>
      </Part>

      <Part title="The WhatsApp beta form">
        <p>What you send in the form (name, email, group, an optional number and note) is only used to set you up with Roomie, and isn&apos;t added to any list.</p>
      </Part>

      <Part title="Questions">
        <p>
          Ask through the{" "}
          <Link href="/#whatsapp-beta" className={link}>
            form on the home page
          </Link>{" "}
          and say it&apos;s about privacy. We&apos;ll get back to you.
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
