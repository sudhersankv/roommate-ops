// The landing page's fake chats (docs/landing.md). Roomie's lines follow the persona (docs/personality.md): short, facts
// first, no lists; task replies keep normal capitalization and names, the vibe shows in asides. The vibe demo uses the archetypes' own example replies.
import { ARCHETYPES } from "@/lib/personality"
import type { ChatLine } from "./chat"

export const HERO: ChatLine[] = [
  { who: "Maya", text: "roomie i paid the internet, $60", time: "7:02 PM" },
  { who: "Roomie", text: ARCHETYPES.chill.examples[0], time: "7:02 PM" },
  { who: "Dev", text: "roomie do i owe anyone", time: "9:14 PM", me: true },
  { who: "Roomie", text: "Just Maya, $20 for internet", time: "9:14 PM", button: "Pay Maya $20 on Venmo" },
  { who: "Sam", text: "roomie add oat milk to the cart", time: "9:31 PM" },
  { who: "Roomie", text: "Added. Cart's at 7 things", time: "9:31 PM" },
]

export type Demo = { id: string; title: string; body: string; lines: ChatLine[]; photo?: "receipt" }

const streak = ARCHETYPES.chill.wins.streak[0].replace("{n}", "3").replace("{who}", "Dev")

export const DEMOS: Demo[] = [
  {
    id: "splitting",
    title: "Split anything, any way",
    body: "Equal, exact amounts, percents or shares. Roomie does the math to the cent, keeps the running tab and can mirror it to Splitwise.",
    lines: [
      { who: "Maya", text: "roomie internet was $60 this month, split it", time: "7:02 PM" },
      { who: "Roomie", text: ARCHETYPES.chill.examples[0], time: "7:02 PM" },
      { day: "Friday" },
      { who: "Sam", text: "roomie who owes what", time: "6:40 PM", me: true },
      { who: "Roomie", text: "Dev and Sam owe Maya $20 each. That's everything", time: "6:40 PM", button: "Pay Maya $20 on Venmo" },
    ],
  },
  {
    id: "receipts",
    title: "Snap the receipt",
    body: "Send a photo. Roomie reads every line, splits it by who had what, and checks with you before it logs anything.",
    photo: "receipt",
    lines: [
      { who: "Dev", text: "roomie split this, the wine's mine", time: "8:15 PM", me: true },
      { who: "Roomie", text: "$42.18 at Trader Joe's. Wine's on you, the rest three ways: Dev $23.12, Maya $9.53, Sam $9.53. Log it?", time: "8:15 PM" },
      { who: "Dev", text: "yep", time: "8:16 PM", me: true },
      { who: "Roomie", text: "Logged", time: "8:16 PM" },
    ],
  },
  {
    id: "groceries",
    title: "One Cart for everyone",
    body: "Anyone adds to it from the chat. When someone does the shop, Roomie turns the Cart into an Instacart list, then splits what they paid.",
    lines: [
      { who: "Sam", text: "roomie add milk and eggs", time: "11:20 AM" },
      { who: "Roomie", text: "Added. Cart's at 7 things", time: "11:20 AM" },
      { who: "Maya", text: "roomie i'm ordering tonight, send the list", time: "5:48 PM", me: true },
      { who: "Roomie", text: "7 things, about $50", time: "5:48 PM", button: "Open in Instacart" },
    ],
  },
  {
    id: "chores",
    title: "Chores that take turns",
    body: "Roomie knows whose turn it is, cheers the streaks, and nudges once in the morning when something's due. Never more than once a day.",
    lines: [
      { who: "Dev", text: "roomie dishes done", time: "10:05 PM", me: true },
      { who: "Roomie", text: `Logged. ${streak}. Sam's up tomorrow`, time: "10:05 PM" },
      { day: "Tomorrow" },
      { who: "Roomie", text: "Morning. Dishes are on Sam today, and the trash is a day late", time: "9:00 AM" },
    ],
  },
]

const ask = "roomie internet was $60, split it"
const dishes = "roomie dev did the dishes"

/** The same two messages, answered in two vibes. */
export const VIBE_DEMO = (["chill", "hype"] as const).map((id) => ({
  id,
  archetype: ARCHETYPES[id],
  lines: [
    { who: "Maya", text: ask, time: "7:02 PM" },
    { who: "Roomie", text: ARCHETYPES[id].examples[0], time: "7:02 PM" },
    { who: "Sam", text: dishes, time: "10:12 PM" },
    { who: "Roomie", text: ARCHETYPES[id].examples[1], time: "10:12 PM" },
  ] satisfies ChatLine[],
}))
