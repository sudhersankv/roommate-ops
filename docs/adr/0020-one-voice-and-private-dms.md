# One Roomie: a fixed voice that quietly settles in, and DMs as the private side of the group

## One voice

ADR 0012 made personality three layers: an archetype, what the Admin sets (name, quirks, sliders), and the Learned style. The picker made Roomie a product you configure; the point is a roommate with a character.

Decisions:

1. **One voice.** The chill archetype, sharpened, is Roomie. The vibe picker, quirks, sliders and the name field leave Settings, the landing page and the onboarding question. Roomie is called "roomie" (and the @mention); it is not renameable.
2. **The archetypes stay in code** as a dev-only switch for evals and a possible later easter egg; nothing user-facing offers them.
3. **The Learned style stays and stays unmarketed.** Roomie picks up the group's slang and nicknames exactly as ADR 0012 bounds it; nothing on the landing page, in `/help` or in the intro says so. "It settles in over time" remains the most either page may say. Settings keeps "Reset what it's learned" for Admins.

## DMs

A lot of the new design goes through DMs: the settle nudge, per-share rent links, personal restock, the utility amount, "is this your landlord?", rent-change heads-ups. Today a DM is already a full private Roomie for a Member of one Group, with two rough edges: DM text lands in the group's memory thread (audit M3), and a Member of several Groups can't DM at all.

Decisions:

4. **A DM is a private Roomie for the group**, with the group's tools. Reads and self-affecting writes are free: "what do I owe", "remind me Friday", "add oat milk for me", "paid Maya". A write that moves **shared money** from a DM is echoed to the group as one line ("Dev logged $40 pizza, split 3 ways"), so no one's Balance changes invisibly. Settlements stay between the two people: the payee gets a one-line DM, the group hears nothing.
5. **Which Group.** A reply to a nudge is about the Group the nudge came from (Roomie knows); otherwise the Group this person last DM'd about; otherwise Roomie asks once ("Apt 4B or Lisbon trip?"). A prefix like "for Lisbon: …" switches explicitly.
6. **Private memory.** DM turns get their own memory thread per (Group, Member); the group's thread is readable from the DM and never written to. DMs stay out of `chat_messages`, as today.
7. **No DM path.** On a Channel where Roomie can't message first (Telegram before Start), a nudge becomes one neutral group line with no amounts, at most weekly, until they open the door.
8. **Lightly advertised.** `/help` and the intro mention DMs in one line; the nudges themselves teach people that Roomie answers privately.

## Consequences

- `lib/personality.ts` keeps `ARCHETYPES`; `normalizePersonality` ignores stored `base`, `name`, `quirks` and sliders outside development. The Personality section, its actions and the vibe copy on the landing page are removed. Existing Groups' stored personalities become inert.
- The pipeline's `isPrivate` path gains the Group-resolution order, the echo rule (a core concern, keyed off `source: "dm"` in Activity) and the per-Member memory thread; audit M3 closes.
- Evals gain DM scenarios: "paid" records and echoes nothing; "I paid 40 for pizza" from a DM logs and echoes one line.

## Considered options

- **Keep the picker, hide it under Advanced:** still a product you configure; the six voices also multiply every copy decision by six. Removed.
- **Nameable but one voice:** a name is the first thing a group would change and the trigger-word logic exists; but a second name is a second brand. Not renameable.
- **DMs as notifications only:** the nudge asks "paid?" and can't hear the answer. Rejected.
