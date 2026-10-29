# Personality = archetype + sliders + learned style; adaptation is gradual and bounded

Roomie is each group's pet, and the promise is that it grows into the group it lives in. A single free-text "persona" prompt can't keep that promise safely: it drifts, it can't be previewed without a model call, and "pick up their slang" turns into a bot that says "no cap" in every message after one day. So a Group's personality is data with three layers, in `groups.personality` (jsonb):

1. **Archetype** (`base`): one of six fixed voices (chill, hype, deadpan, mom, gremlin, butler), each a voice paragraph, three example replies, an emoji policy and a brevity target (`lib/personality.ts`). Default chill. An Admin picks it in Onboarding or Settings.
2. **What the Admin sets**: the pet's `name` (a hard trigger next to "roomie" and the @mention), up to 3 `quirks`, `languages`, and three sliders (emoji none/light/lots, humor 0-3, formality 0-3) that default to the archetype's and are written into the instructions as concrete sentences.
3. **Learned style** (`learned`, read-only): written only by the style job. The small model proposes candidates (languages, code-switching, slang, tone, nicknames, running jokes); code counts them in the actual messages and keeps only what the group really said (slang 2+ times, nicknames used by others, jokes 3+ times). Confidence comes from how many messages were seen (0 at 0, about 0.8 at 300), never from the model.

The instructions are composed in code (`mastra/persona.ts`): core rules, house style, archetype voice, sliders, quirks, languages, learned style, Toolkit persona fragments (`/* TOOLKIT_PERSONA */`, from `manifest.persona`), mood, what Roomie knows about people.

Adaptation is gradual and bounded, by rules in code, not by the model's judgment:

- confidence < 0.3: no borrowed slang (the phrases aren't even shown to the model);
- 0.3 to 0.6: at most one borrowed phrase per 5 replies, enforced by checking Roomie's own last 4 chat lines;
- above 0.6: mirror freely, but never more often than the group itself uses slang (its measured rate), and never more emoji than they use;
- a nickname only after Roomie has seen others use it 3+ times.

## Consequences

- The dashboard can preview a personality exactly, without an LLM call, and greetings and win cheers come from per-archetype lines in code.
- Jokes are a trait (humor slider, archetype), not a Toolkit. Toolkits can add a line of persona, but can't replace the voice.
- An Admin can "Reset what you've learned"; "delete group data" drops the learned style too, and "forget me" drops a Member's note. The archetype, name and quirks are settings, not memory, and stay.
- A new rule about adaptation is a change to `lib/personality.ts` / `mastra/persona.ts` with a unit test, never a prompt tweak alone.
