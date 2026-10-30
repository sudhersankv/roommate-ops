import type { ReactNode } from "react"
import { LockIcon } from "lucide-react"
import { cn } from "cn"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message"
import { MemberAvatar } from "@/components/app/member-avatar"
import { RoomieAvatar } from "@/components/app/roomie-avatar"

/**
 * One line in a fake group chat. `who: "Roomie"` gets the dino; `me` sits on the right in green. `win` marks the
 * satisfying moment: the bubble gets an ember ring and its ðŸ”¥ a glow, and the stage's dino cheers when it lands.
 * `dm` is a line from the viewer's private chat with Roomie (ADR 0020), shown "to you, privately". A `poll` is one
 * of Roomie's Polls (ADR 0018): the question, its options and their tallies, drawn as bars (CSS only).
 */
export type ChatLine =
  | { who: string; text: ReactNode; time: string; me?: boolean; button?: string; photo?: ReactNode; win?: boolean; dm?: boolean }
  | { day: string }
  | { poll: string; options: PollOption[]; time: string; /** How many could answer (active Members); "3 of 4 answered". */ of?: number }

export type PollOption = { label: string; votes: number; voters?: string }

// Sender names in group chats are colored per person (as on WhatsApp and Telegram).
const NAME_COLOR: Record<string, string> = {
  Roomie: "text-owed",
  Maya: "text-owe",
  Dev: "text-sky-700 dark:text-sky-300",
  Sam: "text-fuchsia-700 dark:text-fuchsia-300",
  Priya: "text-amber-700 dark:text-amber-300",
}

/**
 * A chat window: the group's header, then the lines. `motion` "play" pops the lines in on load (the hero); "stage"
 * leaves it to the surrounding Stage (plays when scrolled into view). Static with reduced motion (landing.css).
 */
export function ChatWindow({
  title = "Apt 4B",
  people = "Maya, Dev, Sam, Roomie",
  lines,
  motion = "none",
  label,
  className,
}: {
  title?: string
  people?: string
  lines: ChatLine[]
  motion?: "play" | "stage" | "none"
  label: string
  className?: string
}) {
  let i = 0
  return (
    <figure aria-label={label} className={cn("m-0 flex flex-col overflow-hidden rounded-3xl border bg-card text-card-foreground", motion === "play" && "lp-play", className)}>
      <figcaption className="flex items-center gap-3 border-b px-4 py-3">
        <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-raised text-[0.8125rem] font-semibold">
          {initials(title)}
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
          ) : "poll" in line ? (
            <Poll key={n} line={line} i={i++} />
          ) : (
            <Said key={n} line={line} i={i++} />
          ),
        )}
      </div>
    </figure>
  )
}

const initials = (title: string) => {
  const t = title.replace(/^Apt\s*/i, "").replace(/^The\s+/i, "")
  const words = t.split(/\s+/).filter(Boolean)
  return words.length > 1 && /^[A-Za-z]/.test(words[1]) ? `${words[0][0]}${words[1][0]}`.toUpperCase() : t.slice(0, 2)
}

/** Wraps each ðŸ”¥ so it can glow. */
function withFire(text: ReactNode): ReactNode {
  if (typeof text !== "string" || !text.includes("ðŸ”¥")) return text
  return text.split("ðŸ”¥").flatMap((part, k) => (k === 0 ? [part] : [<span key={k} className="lp-fire">ðŸ”¥</span>, part]))
}

type SaidLine = Extract<ChatLine, { who: string }>

function Said({ line, i }: { line: SaidLine; i: number }) {
  const roomie = line.who === "Roomie"
  const align = line.me ? "end" : "start"
  return (
    <Message align={align} className={cn("lp-msg", line.dm && "lp-dm")} style={{ ["--i" as string]: i }} data-who={roomie ? "roomie" : undefined} data-win={line.win || undefined}>
      {!line.me && <MessageAvatar className="bg-transparent">{roomie ? <RoomieAvatar size={32} /> : <MemberAvatar name={line.who} size="sm" className="size-8" />}</MessageAvatar>}
      <MessageContent className="gap-1.5">
        {line.dm && (
          <span className={cn("inline-flex items-center gap-1 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase", line.me && "self-end")}>
            <LockIcon aria-hidden className="size-3" />
            {line.me ? "you, privately" : "to you, privately"}
          </span>
        )}
        <Bubble variant={line.me ? "default" : "secondary"} align={align} className={cn("max-w-[85%]", line.win && "lp-win", line.dm && "lp-dm-bubble")}>
          {line.photo}
          <BubbleContent className="rounded-2xl px-3 py-1.5 text-[0.9375rem] leading-snug">
            {!line.me && <span className={cn("block text-[0.8125rem] font-semibold", NAME_COLOR[line.who] ?? "text-muted-foreground")}>{line.who}</span>}
            {line.win ? withFire(line.text) : line.text}
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

/** One of Roomie's Polls: the question, then a bar per option with its tally. Static markup; the bars grow in CSS. */
function Poll({ line, i }: { line: Extract<ChatLine, { poll: string }>; i: number }) {
  const total = line.options.reduce((n, o) => n + o.votes, 0)
  return (
    <Message align="start" className="lp-msg lp-poll" style={{ ["--i" as string]: i }} data-who="roomie">
      <MessageAvatar className="bg-transparent">
        <RoomieAvatar size={32} />
      </MessageAvatar>
      <MessageContent className="gap-1.5">
        <Bubble variant="secondary" align="start" className="max-w-[85%]">
          <BubbleContent className="rounded-2xl px-3 py-1.5 text-[0.9375rem] leading-snug">
            <span className={cn("block text-[0.8125rem] font-semibold", NAME_COLOR.Roomie)}>Roomie</span>
            <span className="block font-semibold">{line.poll}</span>
            <ul aria-label={`Poll: ${line.poll}`} className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
              {line.options.map((o) => (
                <li key={o.label} className="flex flex-col gap-0.5" style={{ ["--w" as string]: total ? o.votes / total : 0 }}>
                  <span className="flex items-baseline justify-between gap-3 text-[0.875rem]">
                    <span>
                      {o.label}
                      {o.voters && <span className="text-muted-foreground"> Â· {o.voters}</span>}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{o.votes}</span>
                  </span>
                  <span aria-hidden className="lp-poll-track block h-1.5 overflow-hidden rounded-full bg-foreground/10">
                    <span className="lp-poll-bar block h-full rounded-full bg-owed" />
                  </span>
                </li>
              ))}
            </ul>
            <span className="mt-1.5 block text-[0.75rem] text-muted-foreground">
              {line.of ? `${total} of ${line.of} answered` : `${total} answered`}
              <span className="float-right ml-3 text-[0.6875rem] leading-none opacity-60">{line.time}</span>
            </span>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

/** When each line pops in (seconds after the chat starts playing); landing.css uses the same numbers. */
export const lineDelay = (i: number) => 0.35 + i * 0.85

/** The stage's cues from the lines: when "roomie" is first said, when Roomie first replies, when the win lands. */
export function cuesFor(lines: ChatLine[]) {
  let call: number | null = null
  let reply: number | null = null
  let win: number | null = null
  for (const [i, l] of lines.entries()) {
    if ("day" in l) continue
    if ("poll" in l) {
      if (reply === null) reply = i
      continue
    }
    if (call === null && l.who !== "Roomie" && typeof l.text === "string" && /\broomie\b/i.test(l.text)) call = i
    if (reply === null && l.who === "Roomie") reply = i
    if (win === null && l.win) win = i
  }
  const at = (i: number | null) => (i === null ? null : Math.round((lineDelay(i) + 0.3) * 1000))
  return { callMs: at(call), replyMs: at(reply), winMs: at(win) }
}
