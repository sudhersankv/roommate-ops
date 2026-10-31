// The landing page's fake chats (docs/landing.md): one apartment, Apt 4B. Roomie's lines follow the persona
// (docs/personality.md, one voice since ADR 0020): short, facts first, no lists; task replies keep normal capitalization
// and names. Every number here adds up (the arithmetic is in a comment above each chat, and demos.test.ts checks it);
// keep it that way.
import { ARCHETYPES } from "@/lib/personality"
import type { ChatLine } from "./chat"

/** The apartment every chat is set in. */
export const APARTMENT = { title: "Apt 4B", people: "Maya, Dev, Sam, Roomie" }

/**
 * The hero: rent, a split and the landlord in one scroll.
 * Rent $2,400 (each share goes out by DM: 3 x $800). Internet $60 / 3 = $20 each, so Maya and Sam owe Dev $20 each.
 */
export const HERO = {
  ...APARTMENT,
  lines: [
    { who: "Sam", text: "roomie is rent this week?", time: "8:02 PM" },
    { who: "Roomie", text: "Rent $2,400 is due Saturday. Maya pays the landlord; I'll DM everyone their share Wednesday.", time: "8:02 PM" },
    { who: "Dev", text: "roomie i paid $60 for internet", time: "8:05 PM", me: true },
    { who: "Roomie", text: "Logged. $60 internet, $20 each: Maya and Sam owe Dev $20", time: "8:05 PM", win: true },
    { who: "Maya", text: "and the landlord? heat's still weird", time: "8:06 PM" },
    { who: "Roomie", text: "He wrote back this morning: a tech comes Thursday 1-3. I'll remind you Wednesday night.", time: "8:06 PM" },
  ] satisfies ChatLine[],
}

export type Demo = {
  id: string
  /** The Trick the chat shows: a toolkit id (for its accent) and the name people see (ADR 0015's words). */
  trick: { id: string; name: string }
  title: string
  body: string
  group: { title: string; people: string }
  lines: ChatLine[]
}

/** "7 in a row for Dev. quietly impressive", in the one voice. */
const streak = ARCHETYPES.chill.wins.streak[0].replace("{n}", "7").replace("{who}", "Dev")

/** Five chats, one per bucket: Money (rent, the private pay link), Lease Inbox, Groceries, House, Money (a Poll). */
export const DEMOS: Demo[] = [
  {
    // Rent $2,400 / 3 = $800 each. Maya pays the landlord, so Dev (the viewer) and Sam each owe Maya $800; Dev's DM.
    id: "rent",
    trick: { id: "splitting", name: "Money" },
    title: "Nobody has to be that guy anymore.",
    body: "Rent is split before it's due. Who owes what is said in private, with a pay link.",
    group: APARTMENT,
    lines: [
      { who: "Roomie", text: "Rent $2,400 is due Saturday. Maya pays the landlord.", time: "9:00 AM" },
      { who: "Roomie", text: "You owe Maya $800 for rent, due Saturday.", time: "9:00 AM", dm: true, button: "Pay Maya $800 on Venmo" },
      { who: "Dev", text: "paid", time: "9:14 AM", me: true, dm: true },
      { who: "Roomie", text: "Got it. You and Maya are square for rent 👍", time: "9:14 AM", dm: true, win: true },
    ],
  },
  {
    // No money: a work order from "tell them" to the landlord's reply, with the reminder Roomie sets itself.
    id: "lease",
    trick: { id: "lease-inbox", name: "Lease Inbox" },
    title: "The landlord, handled.",
    body: "Your group gets its own email address. Roomie writes, reads what comes back and remembers the follow-up.",
    group: APARTMENT,
    lines: [
      { who: "Sam", text: "roomie the sink's leaking, tell them", time: "7:40 PM" },
      { who: "Roomie", text: "Sent: reported the leaking kitchen sink. I'll say when they answer.", time: "7:41 PM" },
      { day: "Tomorrow" },
      { who: "Roomie", text: "Landlord: plumber Tuesday 10-12. I'll remind you Monday.", time: "10:15 AM", win: true },
    ],
  },
  {
    // The Cart: 2 things open (eggs, bread) + milk + dish soap (shared) = 4, + Sam's oat milk = 5.
    id: "groceries",
    trick: { id: "groceries", name: "Groceries" },
    title: "It notices before you run out.",
    body: "Anyone adds from the chat. Roomie says when something's probably low, from how often you buy it.",
    group: APARTMENT,
    lines: [
      { who: "Roomie", text: "Probably low: milk, dish soap. Add them?", time: "9:00 AM" },
      { who: "Dev", text: "yes", time: "9:02 AM", me: true },
      { who: "Roomie", text: "Added both as shared. Cart's at 4.", time: "9:02 AM" },
      { who: "Sam", text: "roomie add oat milk for me", time: "9:10 AM" },
      { who: "Roomie", text: "Added, yours. Cart's at 5.", time: "9:10 AM", win: true },
    ],
  },
  {
    // The chart: Dev's 7th dish day in a row; dishes are Sam's tomorrow.
    id: "house",
    trick: { id: "house", name: "House" },
    title: "The 7-day dish streak.",
    body: "It knows whose turn it is. One morning line, only when something's due.",
    group: APARTMENT,
    lines: [
      { who: "Dev", text: "roomie dishes done", time: "10:05 PM", me: true },
      { who: "Roomie", text: `Logged. ${streak} 🔥 Dishes are Sam's tomorrow`, time: "10:05 PM", win: true },
      { day: "Tomorrow" },
      { who: "Roomie", text: "Morning. Dishes are on Sam today, trash goes out tonight.", time: "9:00 AM" },
    ],
  },
  {
    // Pizza $36, three of four had some: $36 / 3 = $12 each. Maya paid, so Dev and Sam owe Maya $12; Priya's out.
    id: "pizza",
    trick: { id: "splitting", name: "Money" },
    title: "Who had pizza? Ask the room.",
    body: "When the answer needs more than one person, Roomie asks the chat and logs it once they've answered.",
    group: { title: "Apt 4B", people: "Maya, Dev, Sam, Priya, Roomie" },
    lines: [
      { who: "Maya", text: "roomie i got the pizza, $36. split it with whoever had some", time: "9:52 PM" },
      { poll: "Who had pizza?", of: 4, time: "9:52 PM", options: [{ label: "I did", votes: 3, voters: "Maya, Dev, Sam" }, { label: "Not me", votes: 1, voters: "Priya" }] },
      { who: "Roomie", text: "Logged. $36 pizza, three ways: Dev and Sam owe Maya $12 each. Priya's out of it", time: "10:20 PM", win: true },
    ],
  },
]
