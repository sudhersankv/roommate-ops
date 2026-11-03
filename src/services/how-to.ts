// "How do I split rent?" (#75): one or two lines about a Trick, from its manifest, with a real phrase to try. Pure and
// client-safe (manifests only): the core tool how_to calls it with the Group's Tricks. The abilities say what it does;
// the phrase comes from the Gate's examples (abilities have none). Nothing here names a Trick the Group hasn't got
// unless the question does.
import type { ToolkitManifest } from "@/toolkits/types";

type Manifest = Pick<ToolkitManifest, "id" | "name" | "summary" | "tags" | "spoken" | "abilities" | "gate" | "dashboard">;

/** Question words that say nothing about what they want to do. */
const STOP = new Set(
  "how do does did i we you can could what with the a an to work works working use using roomie is are it my our for of in on about tell me us show stuff things thing help explain anything get set up".split(" "),
);

const stem = (w: string) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 5 && w.endsWith("ing") ? w.slice(0, -3) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const tokens = (s: string) => s.toLowerCase().replace(/['’]s\b/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const words = (s: string) => [...new Set(tokens(s).filter((w) => !STOP.has(w)).map(stem))];
const bag = (s: string) => new Set(tokens(s).map(stem));
const hits = (q: readonly string[], text: string) => {
  const b = bag(text);
  return q.filter((w) => b.has(w)).length;
};

/** The words that name the Trick itself (its name, spoken name, nav label, id): "cart", "chores", "money". */
const identityText = (m: Manifest) => [m.name, m.spoken ?? "", m.dashboard?.nav?.label ?? "", m.id.replace(/-/g, " ")].join(" ");

export type HowTo = { trick: string; id: string; what: string; tryIt: string; say: string };

/**
 * The Trick a how-to question is about, scored by its words against each manifest (its own name and tags count
 * most, then its abilities and examples); null when nothing matches.
 */
export function trickFor<M extends Manifest>(question: string, manifests: readonly M[]): M | null {
  const q = words(question);
  if (!q.length) return null;
  let best: { m: M; score: number } | null = null;
  for (const m of manifests) {
    const score = 3 * hits(q, `${identityText(m)} ${m.tags.join(" ")}`) + hits(q, Object.values(m.abilities ?? {}).join(" ")) + hits(q, m.gate.examples.join(" "));
    if (score > 0 && (!best || score > best.score)) best = { m, score };
  }
  return best?.m ?? null;
}

const sentence = (s: string) => {
  const t = s.trim().replace(/[.\s]+$/, "");
  return `${t[0].toUpperCase()}${t.slice(1)}.`;
};

/**
 * One or two lines for a how-to question about Trick `m`: what it does (the ability the question is about, else the
 * Trick's summary when they only named the Trick) and one of its Gate examples to try, said as
 * `Just say "roomie, <example>".`. Admin-only abilities only when nothing else matches.
 */
export function howToFor(question: string, m: Manifest): HowTo {
  const q = words(question);
  const identity = bag(identityText(m));
  const specific = q.filter((w) => !identity.has(w));
  const abilities = Object.entries(m.abilities ?? {}).map(([tool, text], i) => ({ tool, text, i, admin: /^admins?:/i.test(text) }));
  // A word that's one of the Trick's tags ("split" for Money) is generic there: it counts half next to "rent".
  const tags = bag(m.tags.join(" "));
  const weigh = (text: string) => {
    const b = bag(text);
    return specific.reduce((sum, w) => sum + (b.has(w) ? (tags.has(w) ? 0.5 : 1) : 0), 0);
  };
  const scored = specific.length
    ? abilities
        .map((a) => ({ ...a, score: weigh(`${a.text} ${a.tool.replace(/_/g, " ")}`) - (a.admin ? 0.25 : 0) }))
        .filter((a) => a.score > 0)
        .sort((a, b) => b.score - a.score || a.i - b.i)
    : [];
  const what = scored[0]?.text ?? m.summary;
  const examples = m.gate.examples.filter((e) => !/[()]/.test(e));
  const pool = examples.length ? examples : m.gate.examples;
  const byWords = (ws: readonly string[]) => pool.map((e, i) => ({ e, i, n: hits(ws, e) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.i - b.i)[0]?.e;
  const tryIt = byWords(specific) ?? byWords(words(what)) ?? pool[0] ?? "";
  const say = tryIt ? `${sentence(what)} Just say "roomie, ${tryIt}".` : sentence(what);
  return { trick: m.name, id: m.id, what: sentence(what), tryIt: tryIt ? `roomie, ${tryIt}` : "", say };
}

export type HowToAnswer = { found: false } | ({ found: true; learned: boolean } & HowTo);

/**
 * The how_to tool's answer from the Group's Tricks (toolkits.catalogFor): the Trick the question is about among the
 * built ones (not coming soon), and whether this Group has learned it. One it hasn't gets the plain line instead
 * ("I haven't learned Lease Inbox here yet; an admin can teach me.").
 */
export function howToIn(states: readonly { manifest: Manifest & { status?: string }; enabled: boolean }[], question: string): HowToAnswer {
  const built = states.filter((s) => s.manifest.status !== "coming-soon");
  const m = trickFor(question, built.map((s) => s.manifest));
  if (!m) return { found: false };
  const learned = built.find((s) => s.manifest.id === m.id)?.enabled ?? false;
  const h = howToFor(question, m);
  return learned ? { found: true, learned, ...h } : { found: true, learned, ...h, say: `I haven't learned ${m.name} here yet; an admin can teach me.` };
}
