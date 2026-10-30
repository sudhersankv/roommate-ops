// Pure: may Roomie send this email to the landlord at once, or ask first? (ADR 0016 decision 6.) The model drafts;
// this rule decides, and the model never skips it. Simple = a reply in the landlord's thread or a new repair request,
// to a known landlord address, with no amount, no date the Member didn't say and no lease term, and no other Member
// asking for something else within the hour. Each refusal is the question Roomie asks, in one message.
import { addressOf, domainOf } from "@/lib/forwarded";

/** reply = in a thread the landlord started; maintenance = a new repair request; other = anything else new. */
export type SendIntent = "reply" | "maintenance" | "other";

export type SendDraft = { to: string; body: string };

/** Another Member's instruction to the landlord (from sent_mail), with when they gave it. */
export type OtherInstruction = { memberId: string; name: string; text: string; at: Date };

export type SendContext = {
  intent: SendIntent;
  /** Trusted landlord senders: addresses or whole domains (landlord_senders). */
  knownSenders: string[];
  /** What the Member said, word for word: dates and terms they said themselves are theirs. */
  memberText: string;
  memberId: string;
  /** Other Members' instructions about the same thread or work order; only the last 60 minutes count. */
  others: OtherInstruction[];
  now: Date;
};

export type SendVerdict = { ok: true } | { ok: false; ask: string[] };

export const CONFLICT_WINDOW_MS = 60 * 60_000;

/* ---------- what's in the text ---------- */

const AMOUNT =
  /[$€£]\s?\d[\d,]*(?:\.\d{1,2})?|\b(?:USD|EUR|GBP)\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:dollars|bucks|usd|euros?)\b/i;

const LEASE_TERM = /\b(terminat\w*|renew\w*|notice|vacat\w*|deposits?|late fees?|sublet\w*|sublease\w*)\b/i;

const WEEKDAYS: Record<string, string> = {
  monday: "monday", mon: "monday",
  tuesday: "tuesday", tues: "tuesday", tue: "tuesday",
  wednesday: "wednesday", wed: "wednesday",
  thursday: "thursday", thurs: "thursday", thur: "thursday", thu: "thursday",
  friday: "friday", fri: "friday",
  // "sat" and "sun" are ordinary words: only the full names count.
  saturday: "saturday",
  sunday: "sunday",
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";
const monthNo = (m: string) => MONTHS.indexOf(m.slice(0, 3).toLowerCase()) + 1;

type Found = { text: string; key: string; at: number; end: number };

const PATTERNS: [RegExp, (m: RegExpExecArray) => string | null][] = [
  [new RegExp(`\\b(${Object.keys(WEEKDAYS).join("|")})\\b\\.?`, "gi"), (m) => `wd:${WEEKDAYS[m[1].toLowerCase()]}`],
  [new RegExp(`\\b${MONTH}\\s+${DAY}\\b`, "gi"), (m) => `md:${monthNo(m[1])}-${Number(m[2])}`],
  [new RegExp(`\\b${DAY}\\s+(?:of\\s+)?${MONTH}\\b`, "gi"), (m) => `md:${monthNo(m[2])}-${Number(m[1])}`],
  [/\b\d{4}-(\d{2})-(\d{2})\b/g, (m) => `md:${Number(m[1])}-${Number(m[2])}`],
  [/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g, (m) => (Number(m[1]) <= 12 && Number(m[2]) <= 31 ? `md:${Number(m[1])}-${Number(m[2])}` : null)],
  [/\b(today|tonight|tomorrow|this weekend|next week|next month)\b/gi, (m) => `rel:${m[1].toLowerCase()}`],
];

/** Every date-like phrase in the text, in order, as written and normalized ("Thurs" and "Thursday" are one key). */
export function datesIn(text: string): { text: string; key: string }[] {
  const found: Found[] = [];
  for (const [re, keyOf] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const key = keyOf(m as RegExpExecArray);
      if (key) found.push({ text: m[0].replace(/\.$/, ""), key, at: m.index!, end: m.index! + m[0].length });
    }
  }
  found.sort((a, b) => a.at - b.at || b.end - a.end);
  const kept: Found[] = [];
  for (const f of found) if (!kept.some((k) => f.at < k.end && k.at < f.end)) kept.push(f);
  return kept.map(({ text, key }) => ({ text, key }));
}

const isKnown = (to: string, known: string[]) => {
  const address = addressOf(to);
  const domain = domainOf(to);
  return !!address && known.some((k) => k.toLowerCase() === address || k.toLowerCase() === domain);
};

const normalized = (s: string) =>
  s
    .toLowerCase()
    .replace(/^\s*roomie[,:]?\s*/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/* ---------- the rule ---------- */

export function sendRule(draft: SendDraft, ctx: SendContext): SendVerdict {
  const ask: string[] = [];
  const to = addressOf(draft.to) ?? draft.to;

  if (!isKnown(draft.to, ctx.knownSenders)) ask.push(`${to} hasn't emailed us before. Send it there anyway?`);
  else if (ctx.intent === "other") ask.push(`This isn't a reply or a repair request. Send it to ${to} as it is?`);

  const amount = AMOUNT.exec(draft.body)?.[0];
  if (amount) ask.push(`It mentions ${amount.trim()}. OK to put that amount in writing?`);

  const said = new Set(datesIn(ctx.memberText).map((d) => d.key));
  const unsaid = [...new Map(datesIn(draft.body).filter((d) => !said.has(d.key)).map((d) => [d.key, d.text])).values()];
  if (unsaid.length) ask.push(`It says ${unsaid.map((t) => `"${t}"`).join(", ")}, which you didn't say. Is that right?`);

  const term = (LEASE_TERM.exec(draft.body) ?? LEASE_TERM.exec(ctx.memberText))?.[0].toLowerCase();
  if (term) ask.push(`This touches the lease ("${term}"). Send it as written?`);

  const mine = normalized(ctx.memberText);
  const other = ctx.others
    .filter((o) => o.memberId !== ctx.memberId && ctx.now.getTime() - o.at.getTime() <= CONFLICT_WINDOW_MS && normalized(o.text) !== mine)
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (other) {
    const mins = Math.max(1, Math.round((ctx.now.getTime() - other.at.getTime()) / 60_000));
    ask.push(`${other.name} asked for something else ${mins} min ago ("${other.text}"). Which one should I send?`);
  }

  return ask.length ? { ok: false, ask } : { ok: true };
}

/** The two lines under every email (ADR 0016 decision 7): the Group and the Member who asked. */
export function signature(groupName: string, memberName: string): string {
  return `Sent by Roomie, the shared inbox for the residents of ${groupName}, at ${memberName}'s request.\nReplies reach all residents.`;
}
