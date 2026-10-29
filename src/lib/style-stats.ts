// The Learned style's numbers, computed in code from chat lines (jobs/style-note.ts). The small model only proposes
// candidates (languages, slang, nicknames, running jokes, tone); every count here comes from the messages themselves,
// so nothing is "learned" that the group didn't actually say. Pure: style-stats.test.ts.
import { confidenceFor, countEmoji, escapeRegex, type LearnedStyle } from "./personality";

export type StyleLine = { name: string; text: string; at: Date };

/** What the small model proposes for one batch. Shares are 0..1 of the batch. */
export type StyleCandidates = {
  languages: { name: string; share: number }[];
  codeSwitching: number;
  slang: string[];
  tone: string[];
  nicknames: { nickname: string; member: string }[];
  insideJokes: string[];
};

export const MAX_SLANG = 10;
const MIN_SLANG_COUNT = 2;
const MAX_JOKES = 10;

const phraseRe = (phrase: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(phrase.toLowerCase())}(?![\\p{L}\\p{N}])`, "u");

/** Messages in `lines` that contain `phrase` (whole words, any case). */
export function countPhrase(lines: Pick<StyleLine, "text">[], phrase: string): number {
  const re = phraseRe(phrase.trim());
  return lines.filter((l) => re.test(l.text.toLowerCase())).length;
}

/** Messages where someone other than `member` uses `nickname` (calling yourself a nickname doesn't count). */
export function countNickname(lines: StyleLine[], nickname: string, member: string): number {
  const re = phraseRe(nickname.trim());
  const who = member.trim().toLowerCase();
  return lines.filter((l) => l.name.trim().toLowerCase() !== who && re.test(l.text.toLowerCase())).length;
}

export function localHour(d: Date, tz: string): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(d);
  return Number(h) % 24;
}

/** The busiest hours, as "7-9pm"-style ranges for the agent and the dashboard. */
export function activeHours(hours: number[], top = 3): number[] {
  const total = hours.reduce((s, n) => s + n, 0);
  if (!total) return [];
  return hours
    .map((n, h) => ({ n, h }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.h - b.h)
    .slice(0, top)
    .map((x) => x.h)
    .sort((a, b) => a - b);
}

export const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

const weighted = (oldV: number, oldN: number, newV: number, newN: number) => (oldN + newN ? (oldV * oldN + newV * newN) / (oldN + newN) : 0);
const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

/**
 * Fold one batch of human chat lines into the Learned style. Counts are cumulative: a phrase's count is its old count
 * plus the messages in this batch that contain it. Slang needs 2+ uses to stay, top 10 by count. Confidence comes
 * from messagesSeen only (confidenceFor), never from the model.
 */
export function mergeLearned(prev: LearnedStyle, lines: StyleLine[], cand: StyleCandidates, tz: string, now = new Date()): LearnedStyle {
  const n = lines.length;
  if (!n) return prev;
  const oldN = prev.messagesSeen;
  const seen = oldN + n;

  const hours = [...prev.hours];
  for (const l of lines) hours[localHour(l.at, tz)] += 1;
  const avgLength = weighted(prev.avgLength, oldN, lines.reduce((s, l) => s + l.text.length, 0) / n, n);
  const emojiPerMessage = weighted(prev.emojiPerMessage, oldN, lines.reduce((s, l) => s + countEmoji(l.text), 0) / n, n);

  const counted = (oldList: { phrase: string; count: number }[], fresh: string[]) => {
    const byKey = new Map<string, { phrase: string; count: number }>();
    for (const o of oldList) byKey.set(o.phrase.toLowerCase(), { ...o });
    for (const f of fresh) {
      const p = f.trim();
      if (p && !byKey.has(p.toLowerCase())) byKey.set(p.toLowerCase(), { phrase: p, count: 0 });
    }
    return [...byKey.values()].map((x) => ({ phrase: x.phrase, count: x.count + countPhrase(lines, x.phrase) }));
  };
  const slang = counted(prev.slang, cand.slang)
    .filter((s) => s.count >= MIN_SLANG_COUNT)
    .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase))
    .slice(0, MAX_SLANG);
  const insideJokes = counted(prev.insideJokes, cand.insideJokes)
    .filter((j) => j.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_JOKES);

  const nicks = new Map<string, { nickname: string; member: string; count: number }>();
  for (const o of prev.nicknames) nicks.set(`${o.nickname.toLowerCase()}|${o.member.toLowerCase()}`, { ...o });
  for (const c of cand.nicknames) {
    const k = `${c.nickname.trim().toLowerCase()}|${c.member.trim().toLowerCase()}`;
    if (c.nickname.trim() && c.member.trim() && c.nickname.trim().toLowerCase() !== c.member.trim().toLowerCase() && !nicks.has(k))
      nicks.set(k, { nickname: c.nickname.trim(), member: c.member.trim(), count: 0 });
  }
  const nicknames = [...nicks.values()].map((x) => ({ ...x, count: x.count + countNickname(lines, x.nickname, x.member) })).filter((x) => x.count > 0);

  const langs = new Map<string, number>();
  for (const l of prev.languages) langs.set(l.name, weighted(l.share, oldN, 0, n));
  for (const l of cand.languages) langs.set(l.name, (langs.get(l.name) ?? 0) + (l.share * n) / seen);
  const languages = [...langs.entries()]
    .map(([name, share]) => ({ name, share: round(share) }))
    .filter((l) => l.share >= 0.05)
    .sort((a, b) => b.share - a.share);

  const slangRe = slang.map((s) => phraseRe(s.phrase));
  const withSlang = lines.filter((l) => slangRe.some((re) => re.test(l.text.toLowerCase()))).length;

  return {
    languages,
    codeSwitching: round(weighted(prev.codeSwitching, oldN, Math.min(1, Math.max(0, cand.codeSwitching)), n)),
    slang,
    tone: cand.tone.length ? cand.tone.slice(0, 5) : prev.tone,
    nicknames,
    insideJokes,
    avgLength: Math.round(avgLength),
    emojiPerMessage: round(emojiPerMessage),
    slangRate: round(weighted(prev.slangRate, oldN, withSlang / n, n)),
    hours,
    messagesSeen: seen,
    confidence: confidenceFor(seen),
    updatedAt: now.toISOString(),
  };
}

/** The Learned style as the few Markdown lines kept in working memory's "## Group style" (for Studio and old readers). */
export function learnedNote(l: LearnedStyle): string {
  return [
    `- Languages: ${l.languages.map((x) => `${x.name} ${Math.round(x.share * 100)}%`).join(", ") || "not sure yet"}${l.codeSwitching ? ` (mixing in ${Math.round(l.codeSwitching * 100)}% of messages)` : ""}`,
    `- Tone: ${l.tone.join(", ") || "not sure yet"}`,
    `- Confidence (0-1): ${l.confidence}`,
    `- Slang, nicknames and the rest: in your instructions (LEARNED STYLE), with the rules for using them.`,
  ].join("\n");
}
