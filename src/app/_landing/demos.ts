// The landing page's fake chats (docs/landing.md). Roomie's lines follow the persona (docs/personality.md): short, facts
// first, no lists; task replies keep normal capitalization and names, the vibe shows in asides. Vibe lines come from
// ARCHETYPES, the intro and the learned line from onboarding.ts and the chart from chores.ts, so editing those updates
// the page. Every number here adds up; keep it that way. No prices on anything in the Cart.
import { ARCHETYPES, previewOwes, type ArchetypeId } from "@/lib/personality"
import { introMessage, learnedLine } from "@/onboarding"
import { chartLine, rankShame } from "@/services/chores"
import { PRESETS } from "@/toolkits/presets"
import type { ChatLine } from "./chat"
import { LIST_ITEMS } from "./chat"

/** The hero: an argument, settled. Roommates, chill vibe. */
export const HERO = {
  title: "Apt 4B",
  people: "Maya, Dev, Sam, Roomie",
  lines: [
    { who: "Maya", text: "dev you still owe me for the pizza", time: "8:02 PM" },
    { who: "Dev", text: "i paid you back tuesday??", time: "8:03 PM", me: true },
    { who: "Sam", text: "roomie settle this", time: "8:03 PM" },
    { who: "Roomie", text: "Dev paid Maya $18 for the pizza on Tuesday. If anything, Maya owes Dev $4 for the Uber", time: "8:03 PM", button: "Pay Dev $4 on Venmo", win: true },
    { who: "Maya", text: "…ok fine", time: "8:04 PM" },
  ] satisfies ChatLine[],
}

/** The add flow: Roomie's real first two intro lines, one answer, the real learned line (the roommates preset). */
export const ADD_FLOW = {
  title: "Apt 4B",
  people: "Maya, Dev, Sam, Roomie",
  tricks: PRESETS.roommates,
  intro: introMessage("Maya").split("\n").slice(0, 2).join("\n"),
  answer: "roommates! LA, USD, chill vibe pls",
  learned: learnedLine(PRESETS.roommates),
}

export type Demo = {
  id: string
  /** The Trick the chat shows (a toolkit id; its name and accent come from the catalog). */
  trick: string
  title: string
  body: string
  group: { title: string; people: string; vibe: ArchetypeId }
  lines: ChatLine[]
  photo?: "receipt" | "list"
  /** Per-person totals that land under the chat after Roomie's reply. They must add up to the receipt. */
  totals?: { who: string; amount: string }[]
}

const hypeStreak = ARCHETYPES.hype.wins.streak[0].replace("{n}", "7").replace("{who}", "Maya")

// The chart after Maya's 7th dishes this week (7 days in a row = her 7-streak); Sam's last one was 9 days ago, so
// with no Rotation he's up next.
const chart = chartLine(
  rankShame([
    { memberId: "maya", name: "Maya", choresThisWeek: 7, daysSinceLastChore: 0 },
    { memberId: "dev", name: "Dev", choresThisWeek: 2, daysSinceLastChore: 1 },
    { memberId: "sam", name: "Sam", choresThisWeek: 0, daysSinceLastChore: 9 },
  ]),
)

export const DEMOS: Demo[] = [
  {
    // The Cart was empty: the photo's 5 things are the whole Instacart list. No prices anywhere.
    id: "groceries",
    trick: "groceries",
    title: "Snap the list. It's on the Cart.",
    body: "Say it in the chat or send a photo of the list or the recipe. Whoever shops gets the Instacart list.",
    photo: "list",
    group: { title: "The Loft", people: "Nina, Theo, Jas, Roomie", vibe: "gremlin" },
    lines: [
      { who: "Theo", text: "roomie add these, all shared", time: "4:02 PM" },
      { who: "Roomie", text: `Added ${LIST_ITEMS.length} to the Cart, all shared. milk is finally on it 👀`, time: "4:02 PM" },
      { who: "Nina", text: "roomie i'm ordering tonight, send the list", time: "5:48 PM", me: true },
      { who: "Roomie", text: `${LIST_ITEMS.length} things on the list 🛒 go forth 😈`, time: "5:48 PM", button: "Open in Instacart" },
    ],
  },
  {
    // Receipt split: unclaimed items shared, tax proportional. $42.18 = wine 12.99 (Dev) + 27.34 shared + 1.85 tax.
    // Dev 12.99 + 9.11 + 1.01 tax = 23.12; Maya and Sam 9.11 + 0.42 tax = 9.53 each; 23.12 + 9.53 + 9.53 = 42.18.
    id: "receipts",
    trick: "splitting",
    title: "Snap the receipt. It splits who had what.",
    body: "It reads every line, puts the wine on whoever had it, shares the rest, and asks before it logs.",
    photo: "receipt",
    group: { title: "Apt 4B", people: "Maya, Dev, Sam, Roomie", vibe: "chill" },
    lines: [
      { who: "Dev", text: "roomie split this, the wine's mine", time: "8:15 PM", me: true },
      { who: "Roomie", text: "$42.18 at Trader Joe's. Wine's on you, the rest three ways: Dev $23.12, Maya $9.53, Sam $9.53. Log it?", time: "8:15 PM" },
      { who: "Dev", text: "yep", time: "8:16 PM", me: true },
      { who: "Roomie", text: "Logged 🧾", time: "8:16 PM" },
    ],
    totals: [
      { who: "Dev", amount: "$23.12" },
      { who: "Maya", amount: "$9.53" },
      { who: "Sam", amount: "$9.53" },
    ],
  },
  {
    // $920 + $180 = $1,100 over 4 = $275 each. Leo paid 920 (+645), Ana 180 (-95), Kai and Priya -275 each.
    id: "trip",
    trick: "splitting",
    title: "The Airbnb, split before anyone asks.",
    body: "Any split, exact to the cent, with the pay buttons ready.",
    group: { title: "Lisbon trip", people: "Leo, Ana, Kai, Priya, Roomie", vibe: "hype" },
    lines: [
      { who: "Leo", text: "roomie split the airbnb 4 ways, i paid $920", time: "2:14 PM" },
      { who: "Roomie", text: "Logged! $920 Airbnb, $230 each. Lisbon's gonna be good 🌴", time: "2:14 PM" },
      { who: "Ana", text: "roomie the boat tour was $180, i got it", time: "6:40 PM", me: true },
      { who: "Roomie", text: "Logged, $45 each. Kai and Priya owe Leo $275 each, Ana owes Leo $95", time: "6:40 PM", button: "Pay Leo $95 on Venmo" },
    ],
  },
  {
    id: "chores",
    trick: "chores",
    title: "Who's slacking? It has the chart.",
    body: "It knows whose turn it is, cheers the streaks, and nudges once a day at most.",
    group: { title: "Apt 4B", people: "Maya, Dev, Sam, Roomie", vibe: "hype" },
    lines: [
      { who: "Maya", text: "roomie dishes done", time: "9:40 PM" },
      { who: "Roomie", text: `Logged. ${hypeStreak} Sam's up tomorrow`, time: "9:40 PM", win: true },
      { who: "Dev", text: "roomie who's slacking?", time: "9:42 PM", me: true },
      { who: "Roomie", text: chart, time: "9:42 PM" },
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
