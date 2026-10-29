import type { ReactNode } from "react"
import { cn } from "cn"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message"
import { MemberAvatar } from "@/components/app/member-avatar"
import { RoomieAvatar } from "@/components/app/roomie-avatar"

/** One line in a fake group chat. `who: "Roomie"` gets the dino; `me` sits on the right in green. */
export type ChatLine =
  | { who: string; text: ReactNode; time: string; me?: boolean; button?: string; photo?: ReactNode }
  | { day: string }

// Sender names in group chats are colored per person (as on WhatsApp and Telegram).
const NAME_COLOR: Record<string, string> = {
  Roomie: "text-owed",
  Maya: "text-owe",
  Dev: "text-sky-700 dark:text-sky-300",
  Sam: "text-fuchsia-700 dark:text-fuchsia-300",
}

/**
 * A chat window: the group's header, then the lines. `motion` "play" pops the lines in on load (the hero), "reveal"
 * as they scroll into view (landing.css; static where the browser can't, and always with reduced motion).
 */
export function ChatWindow({
  title = "Apt 4B",
  people = "Maya, Dev, Sam, Roomie",
  lines,
  motion = "reveal",
  label,
  className,
}: {
  title?: string
  people?: string
  lines: ChatLine[]
  motion?: "play" | "reveal" | "none"
  label: string
  className?: string
}) {
  let i = 0
  return (
    <figure
      aria-label={label}
      className={cn("m-0 flex flex-col overflow-hidden rounded-3xl border bg-card text-card-foreground", motion === "play" && "lp-play", motion === "reveal" && "lp-reveal", className)}
    >
      <figcaption className="flex items-center gap-3 border-b px-4 py-3">
        <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-raised text-[0.8125rem] font-semibold">
          {title.replace(/^Apt\s*/i, "").slice(0, 2)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="type-heading truncate">{title}</span>
          <span className="type-caption truncate text-muted-foreground">{people}</span>
        </span>
      </figcaption>
      <div className="flex flex-col gap-2.5 bg-background/60 px-3 py-4 sm:px-4">
        {lines.map((line, n) =>
          "day" in line ? (
            <p key={n} className="lp-msg type-caption m-0 self-center rounded-full bg-raised px-3 py-0.5 text-muted-foreground" style={{ ["--i" as string]: i++ }}>
              {line.day}
            </p>
          ) : (
            <Said key={n} line={line} i={i++} />
          ),
        )}
      </div>
    </figure>
  )
}

function Said({ line, i }: { line: Exclude<ChatLine, { day: string }>; i: number }) {
  const roomie = line.who === "Roomie"
  const align = line.me ? "end" : "start"
  return (
    <Message align={align} className="lp-msg" style={{ ["--i" as string]: i }}>
      {!line.me && <MessageAvatar className="bg-transparent">{roomie ? <RoomieAvatar size={32} /> : <MemberAvatar name={line.who} size="sm" className="size-8" />}</MessageAvatar>}
      <MessageContent className="gap-1.5">
        <Bubble variant={line.me ? "default" : "secondary"} align={align} className="max-w-[85%]">
          {line.photo}
          <BubbleContent className="rounded-2xl px-3 py-1.5 text-[0.9375rem] leading-snug">
            {!line.me && <span className={cn("block text-[0.8125rem] font-semibold", NAME_COLOR[line.who] ?? "text-muted-foreground")}>{line.who}</span>}
            {line.text}
            <span className="float-right mt-1.5 ml-3 text-[0.6875rem] leading-none opacity-60">{line.time}</span>
          </BubbleContent>
        </Bubble>
        {line.button && (
          // A chat button as Telegram shows it under Roomie's message. Demo only, so not focusable.
          <span aria-hidden className="max-w-[85%] rounded-2xl bg-raised px-4 py-2 text-center text-[0.875rem] font-semibold text-owed">
            {line.button}
          </span>
        )}
      </MessageContent>
    </Message>
  )
}

/** A receipt as a photo in the chat: paper, a store, a few lines and the total. */
export function ReceiptPhoto() {
  const rows: [string, string][] = [
    ["Pinot noir", "12.99"],
    ["Mandarin chicken", "5.49"],
    ["Everything bagels", "3.99"],
    ["Greek yogurt", "6.49"],
    ["Bananas", "1.38"],
    ["Coffee beans", "9.99"],
  ]
  return (
    <div className="mb-1 overflow-hidden rounded-2xl bg-raised p-3" role="img" aria-label="A photo of a Trader Joe's receipt, $42.18">
      <div aria-hidden className="mx-auto w-44 -rotate-2 rounded-sm bg-[#fbfaf5] px-3 py-3 font-mono text-[0.625rem] leading-relaxed text-[#2a2a2a] shadow-md">
        <p className="m-0 text-center text-[0.6875rem] font-bold">TRADER JOE&apos;S</p>
        <p className="m-0 mb-1 text-center opacity-60">#552 Chicago IL</p>
        {rows.map(([item, price]) => (
          <p key={item} className="m-0 flex justify-between gap-2">
            <span className="truncate">{item}</span>
            <span>{price}</span>
          </p>
        ))}
        <p className="m-0 flex justify-between gap-2 opacity-70">
          <span>Tax</span>
          <span>1.85</span>
        </p>
        <p className="m-0 mt-1 flex justify-between border-t border-dashed border-[#2a2a2a]/40 pt-1 font-bold">
          <span>TOTAL</span>
          <span>$42.18</span>
        </p>
      </div>
    </div>
  )
}
