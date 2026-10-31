// Nothing a person reads says AI, bot, brain, assistant, smart, toolkit, feature, enable or vibe (ADR 0015, ADR 0020,
// the glossary's Avoid lists). Scans the landing page, /help and /privacy sources (comments and imports stripped), the
// Onboarding copy, every manifest's user-facing fields and the Channels' shared lines. Code keeps "toolkit" in
// identifiers and paths; those never reach a person, so they're outside the scan.
// Run: npx tsx --test src/app/_landing/words.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BAD_VOICE, MANY_GROUPS, NO_GROUP, NO_VOICE, OOPS, helpText, startReply } from "@/channels/text";
import { approvalPrompt, introMessage, learnedLine, setupDmText } from "@/onboarding";
import { CATALOG, CORE_MANIFEST, MANIFESTS } from "@/toolkits/manifests";

export const FORBIDDEN = /\b(?:AI|bots?|brains?|assistants?|smart|toolkits?|features?|enabled?|enabling|vibes?|marketplace)\b/i;

/**
 * Phrases a file may contain anyway, each with why. /privacy has to say what the code does (audit B4): the models and
 * the gateway are named as they are.
 */
const ALLOWED: Record<string, { phrases: string[]; why: string }> = {
  "src/app/privacy/page.tsx": { phrases: ["AI model", "AI models", "AI Gateway"], why: "the privacy page names the models and Neon's AI Gateway as they're called" },
};

const root = join(import.meta.dirname, "../../..");

/** The source without comments (line and block ones, JSX ones included) and import lines: what's left is what could render. */
function renderable(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\x22\x27\x60])\/\/[^\n]*/g, "$1")
    .replace(/^\s*import\b[^\n]*$/gm, "")
    .replace(/^\s*export \{[^\n]*\} from[^\n]*$/gm, "");
}

const hits = (text: string): string[] => {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) if (FORBIDDEN.test(line)) out.push(line.trim());
  return out;
};

const files = (dir: string) =>
  readdirSync(join(root, dir))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => `${dir}/${f}`);

test("the landing page, /help and /privacy sources (comments and imports aside)", () => {
  const sources = [...files("src/app/_landing"), ...files("src/app/help"), "src/app/privacy/page.tsx", "src/app/page.tsx"];
  for (const file of sources) {
    let text = renderable(readFileSync(join(root, file), "utf8"));
    for (const phrase of ALLOWED[file]?.phrases ?? []) text = text.split(phrase).join(" ");
    assert.deepEqual(hits(text), [], file);
  }
});

/** Every .ts/.tsx under a folder (tests aside), recursively. */
const tree = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tree(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []
  );

/**
 * What a dashboard file could show a person: its string literals and JSX text (comments and imports stripped first).
 * Identifiers, props and paths ("toolkits", `t.toolkit`) are code and stay out of the scan.
 */
function shownStrings(source: string): string {
  const text = renderable(source);
  const out: string[] = [];
  for (const m of text.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)) {
    // A path or an id ("/toolkits", `${base}/toolkits`, "browse-toolkits") has a slash or a dash and no spaces: code.
    if (/[/-]/.test(m[0]) && !/\s/.test(m[0].replace(/\$\{[^}]*\}/g, ""))) continue;
    // So is one lowercase identifier ("enabled" as a key or a type's field name); a label starts with a capital.
    if (/^["'`][a-z][A-Za-z0-9]*["'`]$/.test(m[0])) continue;
    out.push(m[0].replace(/\$\{[^}]*\}/g, " "));
  }
  // JSX text: between a tag's ">" and the next "<", with no code characters in it (so `a > b && <X />` isn't text).
  for (const m of text.matchAll(/>([^<>{}=;()&|]*[A-Za-z][^<>{}=;()&|]*)</g)) out.push(m[1]);
  return out.join("\n");
}

/**
 * Strings in the dashboard that may contain a word anyway, each with why. Keys and route segments are code, not copy.
 */
const DASHBOARD_ALLOWED: Record<string, { phrases: string[]; why: string }> = {};

test("the dashboard's strings (src/app/g, src/components/app)", () => {
  const found: Record<string, string[]> = {};
  for (const file of [...tree("src/app/g"), ...tree("src/components/app")]) {
    let text = shownStrings(readFileSync(join(root, file), "utf8"));
    for (const phrase of DASHBOARD_ALLOWED[file]?.phrases ?? []) text = text.split(phrase).join(" ");
    const h = hits(text);
    if (h.length) found[file] = h;
  }
  assert.deepEqual(found, {});
});

test("the dashboard allowlist only names files that exist and phrases they still use", () => {
  for (const [file, { phrases }] of Object.entries(DASHBOARD_ALLOWED)) {
    const source = readFileSync(join(root, file), "utf8");
    for (const p of phrases) assert.ok(source.includes(p), `${file} no longer says "${p}": drop it from the allowlist`);
  }
});

test("the Onboarding copy", () => {
  const lines = [
    introMessage("Maya"),
    introMessage("Maya", { dmHandle: "imroomiebot" }),
    introMessage("+15551234567"),
    setupDmText("Maya Lee", "Apt 4B"),
    learnedLine(MANIFESTS.map((m) => m.id)),
    learnedLine(["splitting"], { defaulted: true }),
    learnedLine([]),
    // With Lease Inbox off, the wrap-up offers it in one sentence.
    learnedLine(["splitting", "groceries", "house"]),
    approvalPrompt("Priya", ["Maya"]),
  ];
  for (const line of lines) assert.deepEqual(hits(line), [], line);
  assert.match(learnedLine(["splitting", "groceries", "house"]), /Want me to handle the landlord's emails too\? Say "roomie, learn lease inbox"\.$/);
});

test("every manifest's name, summary, long description, persona and offer", () => {
  for (const m of [CORE_MANIFEST, ...CATALOG]) {
    for (const [field, value] of Object.entries({ name: m.name, summary: m.summary, longDescription: m.longDescription, persona: m.persona ?? "", offerLine: m.offerLine ?? "" })) {
      assert.deepEqual(hits(value), [], `${m.id}.${field}`);
    }
  }
});

test("the Channels' shared lines (/help, /start, the failure line)", () => {
  const lines = [
    helpText(),
    helpText(["splitting", "chores"]),
    helpText([], { dashboard: "https://tryroomie.me/j/abc" }),
    startReply("Maya", 1, "telegram"),
    startReply("Maya", 1, "whatsapp"),
    startReply("Maya", 0),
    OOPS,
    NO_GROUP,
    MANY_GROUPS,
    NO_VOICE,
    BAD_VOICE,
  ];
  for (const line of lines) assert.deepEqual(hits(line), [], line);
});

test("the allowlist only names files that exist and phrases they still use", () => {
  for (const [file, { phrases }] of Object.entries(ALLOWED)) {
    const source = readFileSync(join(root, file), "utf8");
    for (const p of phrases) assert.ok(source.includes(p), `${file} no longer says "${p}": drop it from the allowlist`);
  }
});
