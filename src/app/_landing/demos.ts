// The landing page's fake chats (docs/landing.md). Roomie's lines follow the persona (docs/personality.md): short, facts
// first, no lists; task replies keep normal capitalization and names, the vibe shows in asides. Vibe lines come from
// ARCHETYPES, so editing an archetype updates the page. Every number here adds up; keep it that way.
import { ARCHETYPES, previewOwes, type ArchetypeId } from "@/lib/personality"
import type { ChatLine } from "./chat"

/** The hero: an argument, settled. A friends group, chill vibe. */
export const HERO = {
  title: "Friday dinner",
  people: "Maya, Dev, Sam, Roomie",
  lines: [
    { who: "Maya", text: "dev you still owe me for the pizza", time: "8:02 PM" },
    { who: "Dev", text: "i paid you back tuesday??", time: "8:03 PM", me: true },
    { who: "Sam", text: "roomie settle this", time: "8:03 PM" },
    { who: "Roomie", text: "Dev paid Maya $18 for the pizza on Tuesday. If anything, Maya owes Dev $4 for the Uber", time: "8:03 PM", button: "Pay Dev $4 on Venmo", win: true },
    { who: "Maya", text: "…ok fine", time: "8:04 PM" },
  ] satisfies ChatLine[],
}

export type Demo = {
  id: string
  /** The Trick the chat shows (a toolkit id; its name and accent come from the catalog). */
  trick: string
  title: string
  body: string
  group: { title: string; people: string; vibe: ArchetypeId }
  lines: ChatLine[]
  photo?: "receipt"
}

const hypeStreak = ARCHETYPES.hype.wins.streak[0].replace("{n}", "7").replace("{who}", "Dev")

export const DEMOS: Demo[] = [
  {
    // $920 + $180 = $1,100 over 4 = $275 each. Leo paid 920 (+645), Ana 180 (-95), Kai and Priya -275 each.
    id: "trip",
    trick: "splitting",
    title: "Split the Airbnb.",
    body: "Any split, any group, exact to the cent. Pay links included.",
    group: { title: "Lisbon trip", people: "Leo, Ana, Kai, Priya, Roomie", vibe: "hype" },
    lines: [
      { who: "Leo", text: "roomie split the airbnb 4 ways, i paid $920", time: "2:14 PM" },
      { who: "Roomie", text: "Logged! $920 Airbnb, $230 each. Lisbon's gonna be good 🌴", time: "2:14 PM" },
      { who: "Ana", text: "roomie the boat tour was $180, i got it", time: "6:40 PM", me: true },
      { who: "Roomie", text: "Logged, $45 each. Kai and Priya owe Leo $275 each, Ana owes Leo $95", time: "6:40 PM", button: "Pay Leo $95 on Venmo" },
    ],
  },
  {
    // Receipt split: unclaimed items shared, tax proportional. $42.18 = wine 12.99 (Dev) + 27.34 shared + 1.85 tax.
    id: "receipts",
    trick: "splitting",
    title: "Snap the receipt.",
    body: "It reads every line, splits by who had what, and asks first.",
    photo: "receipt",
    group: { title: "Apt 4B", people: "Maya, Dev, Sam, Roomie", vibe: "chill" },
    lines: [
      { who: "Dev", text: "roomie split this, the wine's mine", time: "8:15 PM", me: true },
      { who: "Roomie", text: "$42.18 at Trader Joe's. Wine's on you, the rest three ways: Dev $23.12, Maya $9.53, Sam $9.53. Log it?", time: "8:15 PM" },
      { who: "Dev", text: "yep", time: "8:16 PM", me: true },
      { who: "Roomie", text: "Logged 🧾", time: "8:16 PM" },
    ],
  },
  {
    id: "groceries",
    trick: "groceries",
    title: "One Cart. Then Instacart.",
    body: "Anyone adds from the chat. Whoever shops gets the list.",
    group: { title: "The Parkers", people: "Nina, Theo, Mom, Roomie", vibe: "gremlin" },
    lines: [
      { who: "Theo", text: "roomie add hot cheetos", time: "4:02 PM" },
      { who: "Roomie", text: "Added. Cart's at 7 things, 3 of them hot cheetos 👀", time: "4:02 PM" },
      { who: "Nina", text: "roomie i'm ordering tonight, send the list", time: "5:48 PM", me: true },
      { who: "Roomie", text: "7 things, about $50 🛒 I left the cheetos in. you're welcome 😈", time: "5:48 PM", button: "Open in Instacart" },
    ],
  },
  {
    id: "chores",
    trick: "chores",
    title: "The 7-day dish streak.",
    body: "It knows whose turn it is, and nudges once a day at most.",
    group: { title: "Apt 4B", people: "Maya, Dev, Sam, Roomie", vibe: "hype" },
    lines: [
      { who: "Dev", text: "roomie dishes done", time: "10:05 PM", me: true },
      { who: "Roomie", text: `Logged. ${hypeStreak} Sam's up tomorrow`, time: "10:05 PM", win: true },
      { day: "Tomorrow" },
      { who: "Roomie", text: "Morning, team! Dishes are on Sam today 🧹", time: "9:00 AM" },
    ],
  },
]

/** One line per vibe for the strip: gremlin and deadpan lead. From ARCHETYPES, so the page follows the voice. */
export const VIBE_LINES: { id: ArchetypeId; line: string }[] = [
  { id: "gremlin", line: ARCHETYPES.gremlin.examples[1] },
  { id: "deadpan", line: previewOwes({ base: "deadpan" }) },
  { id: "hype", line: ARCHETYPES.hype.wins.square[0] },
  { id: "mom", line: previewOwes({ base: "mom" }) },
  { id: "butler", line: previewOwes({ base: "butler" }) },
  { id: "chill", line: previewOwes({ base: "chill" }) },
]
