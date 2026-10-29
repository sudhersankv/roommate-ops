# Roomie's personality: a pet for your group chat

Each Group's Roomie is that group's pet. It has a vibe the group picks, a name the group gives it, a few quirks, and it slowly picks up how the group talks. The decision is [ADR 0012](./adr/0012-personality-archetype-sliders-learned-style.md); the code is `src/lib/personality.ts` (model, rules, lines), `src/mastra/persona.ts` (instructions), `src/services/personality.ts` (reads, writes, mood), `src/services/pet.ts` (say-once moments) and `src/jobs/style-note.ts` (learning).

## Archetypes

| Vibe | Voice | Emoji | Humor | Formality | Brevity | Example |
|---|---|---|---|---|---|---|
| **chill** (default) | Laid-back, dry, low-key | light | 1 | 1 | 1-2 lines | "Logged. $60 internet, $20 each" |
| **hype** | Enthusiastic, celebrates every win | lots | 2 | 1 | 1-3 lines | "Logged! $60 internet, $20 each 🎉" |
| **deadpan** | Bone-dry, minimal | none | 2 | 1 | 1 line | "Logged. $60 internet. $20 each." |
| **mom** | Warm, gently nagging, "did you eat?" | light | 1 | 1 | 1-3 lines | "Got it, hon: $60 internet, $20 each 💛" |
| **gremlin** | Chaotic-playful, mischievous, never mean | lots | 3 | 0 | 1-2 lines | "$60 internet logged 👀 $20 each, no escaping" |
| **butler** | Polished, discreet, understated wit | none | 1 | 3 | 1-2 sentences | "Noted: $60 for internet, $20 each." |

Each has a voice paragraph, three example replies, greetings (morning / day / evening), win lines, and a "Dev owes you $30" line for the dashboard preview. Emoji, humor and formality are the archetype's defaults until an Admin moves a slider; picking another vibe puts them back to its defaults.

**Two registers.** Whatever the vibe, a reply that does a job (setup, money, the Cart, chores, reminders, approvals, answering a question) is purposeful: normal capitalization, names written properly, exact numbers, the ask stated plainly. The vibe shows in banter, asides, greetings and pet moments. Formality 0 ("lowercase is fine") only ever applies to banter. This came out of the first WhatsApp group: "hey sudhersan. still need a bit of setup from you" read as sloppy, not friendly.

## What a Group sets

`groups.personality` (jsonb; `{}` means chill "Roomie"):

- `base`: the vibe. Onboarding asks for it in the same message as purpose, currency and time zone; `set_group_settings` takes `personality.base`, `personality.name`, `personality.quirks`.
- `name`: what the group calls it, 3-24 characters, not a common word ("the", "you", "bot"...). "roomie", the custom name and the @mention all wake it up (`callsPet` in `mastra/gate/policy.ts`).
- `quirks`: up to 3 short traits ("obsessed with the plant", "always blames the cat"), shown "now and then, not every message".
- `languages`, `emoji` (none / light / lots), `humor` (0-3), `formality` (0-3).
- `learned`: read-only (below).

Admins change all of it in chat or in Settings -> Personality; everyone else sees it read-only.

## How it learns (the Learned style)

Every 50 chat lines (`STYLE_EVERY`) the scheduler runs `refreshStyleNote` over the human lines since the last run:

1. Haiku proposes candidates with structured output: languages with shares, the code-switching ratio, slang words/phrases, tone words, nicknames (nickname -> member) and running jokes.
2. Code counts them in the messages (`lib/style-stats.ts`): slang stays with 2+ uses (top 10 by count, cumulative), a nickname counts only when someone other than that member uses it, running jokes are shown to Roomie at 3+ uses. Average message length, emoji per message, the share of messages with slang and messages per local hour are computed in code.
3. `confidence = 0.9 * (1 - e^(-messages / 140))`: 0 at 0, 0.27 at 50, 0.46 at 100, 0.68 at 200, 0.8 at 300, never above 0.9.

How Roomie uses it (sentences in its instructions, from `learnedBlock`):

| Confidence | Slang |
|---|---|
| < 0.3 | None. The phrases aren't listed; "Don't borrow any of the group's slang yet." |
| 0.3 - 0.6 | At most one phrase per 5 replies: if any of Roomie's last 4 chat lines used one, "Don't use any of the group's slang in this reply"; otherwise "at most ONE of their phrases". |
| > 0.6 | "Mirror their slang freely, but never more often than they do: about N% of their messages use any." |

Always: never more emoji than the group uses; call members by name or by a nickname seen used by others 3+ times, never an invented one; reply in the language of the message (and mix only when they mix).

**The adaptation stays implicit.** Nothing a person reads says Roomie adapts to how the group talks or learns its slang: not the intro, `/help`, the landing copy in the app, Settings or Roomie's own replies (`CORE_RULES`: "Never explain that you pick up how the group talks"). It's a discovery. The one place it shows is Settings -> Personality's low-key "What Roomie has picked up" card (no explainer line; "Start fresh" clears it). Likewise "pet" appears in at most two places in the app: `/pet` and the Personality subtitle. What Roomie *learns* in user-facing words is Tricks (GLOSSARY).

## Pet behaviours

All of them go through the pipeline and the Channel adapter, so ADR 0001's rate limits apply.

- **Greeting**: the first message of the Group's local day gets one line in the pet's voice, once (`pet_moments` greeting/day), only when Chattiness isn't quiet and Roomie hasn't posted yet that day, never with a link. If the Gate speaks anyway, the agent is told to open with a short hello instead.
- **Wins**: everyone square after a Settlement (once a day), a chore streak of 3, 7 or 30, a Checkout: one short line in the pet's voice after the reply, once per win (`pet_moments` win/key).
- **Mood** (`groupMood`): worried when anyone owes more than $100, sleepy after 5 days without a message, happy when everyone's square, calm otherwise. The Home dino shows it, and the agent reads "Right now you feel: sleepy (the chat's been quiet)".
- **/pet**: `/pet`, `/pet@bot`, "pet roomie", "*pets dino*" -> 1-2 lines about its day, no tools.

## Knows you (Member notes)

`remember` saves lasting facts about the sender into their Member note: preferred name, diet, allergies, time zone, up to 3 things they care about, birthday, other. They show up in Roomie's instructions as "what you know about people" (recipes respect diets without being told again). `what_do_you_know_about_me` shows your own note; an Admin can ask about anyone; nobody else's note is ever told to another Member.

## Privacy

- The Learned style holds counts and short phrases, not messages; the style prompt forbids private facts, amounts and addresses.
- "roomie forget me" deletes the Member's note (facts and handles), their chat lines and their memory lines.
- "Reset what you've learned" (Admin) empties the Learned style. "Delete group data" drops it too, plus the pet moments. The vibe, name and quirks are settings and stay.

## For Toolkits

A Toolkit manifest may carry `persona: string`, one line about how Roomie behaves with that Toolkit on. Enabled Toolkits' lines are added under the TRICKS header at the `/* TOOLKIT_PERSONA */` insertion point in `composePersona` (`toolkitPersona()` in `mastra/agents/roomie.ts` reads the optional field).
