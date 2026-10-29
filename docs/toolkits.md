# Adding a Toolkit

A Toolkit is one folder in `src/toolkits/<id>/`. Its manifest is the contract ([ADR 0011](./adr/0011-manifest-is-the-toolkit-contract.md)): the agent's tools and instructions, the Gate, the bottom nav, Home, Settings and the Toolkits page are all built from the Group's enabled manifests. You never edit the shell.

```
src/toolkits/<id>/
  manifest.ts     what it is (plain data, safe anywhere)            defineManifest({...})
  server.ts       tools, dashboard sections, hooks (server only)    defineToolkit(manifest, {...})
  dashboard.tsx   optional: React server components for Home / Settings / Roomie's mood
  <area>.ts       the tools (thin: they call src/services/)
```

Then one line in each list:

- `src/toolkits/manifests.ts`: add the manifest to `MANIFESTS` (this defines `ToolkitId`).
- `src/toolkits/registry.ts`: add the server entry to `BY_ID` (`satisfies Record<ToolkitId, Toolkit>`, so forgetting it is a type error).

Business logic still goes in `src/services/` (CLAUDE.md, "The one rule"). Tables go in `src/db/schema.ts` with a migration.

## Manifest fields (`src/toolkits/types.ts`)

| field | what it's for |
|---|---|
| `id`, `name` | `id` is the `group_toolkits.toolkit` value and the Gate choice; `name` is what people see ("Groceries") |
| `description` | one line for the agent and logs |
| `summary` | one line for the Toolkits card (80 chars max) |
| `longDescription` | 2-4 sentences for the detail sheet |
| `icon` | a lucide-react export name (`"ShoppingCart"`), rendered on the server |
| `category` | `money`, `home`, `food`, `planning`, `fun` or `integrations` (the filter chips) |
| `tags` | extra search words |
| `defaultOn` | on for a Group that never chose (no row yet) and in the "no answer" preset. New Toolkits should usually be `false` |
| `requires` | `{ env?, toolkits?, integrations? }`: it can't go on until these are met; the sheet shows each red/green |
| `worksWith` | `{ integrations }`: optional extras, shown in the sheet, never blocking |
| `status` | `stable`, `beta` (badge) or `coming-soon` (listed, can't be switched on) |
| `gate` | `{ criterion, examples }`: `criterion` is the Jev `toolkit` choice text (which messages belong here); `examples[0]` is what Roomie suggests when it's switched on ("Groceries is on. Try: ...") |
| `persona` | lines appended to Roomie's RULES while it's on. Put the Toolkit's tool-routing rules here, not in `agents/roomie.ts` |
| `abilities` | plain words per tool id for the sheet's "What it can do" (tools without one show their description) |
| `dashboard.nav` | `{ label, href: (groupId) => path, icon, order }`: a bottom-nav tab. Home + the first 3 by `order` are tabs; the rest go under More in the avatar menu. Two Toolkits pointing at the same path share one tab |
| `dashboard.pages` | route prefixes under `/g/<id>/` it owns (`["cart"]`). While every owner is off, the page shows "X is off for this group" with Turn on / Ask an admin |

## Server entry (`server.ts`)

```ts
export const groceries = defineToolkit(manifest, {
  tools: { ...cartTools, ...recipeTools },
  dashboard: {
    home: () => import("./dashboard").then((m) => m.GroceriesHome),        // Home section
    settings: () => import("./dashboard").then((m) => m.GroceriesSettings), // Settings section
    mood: () => import("./dashboard").then((m) => m.someMood),              // optional: Roomie's mood in the doorway
  },
  onEnable: (ctx) => seedPantry(ctx), // off -> on, and for the Onboarding preset. Must be idempotent
  onDisable: async (ctx) => {},
});
```

- Dashboard sections are lazy imports so the agent runtime (tsx, evals, Mastra) never loads React. They are async server components taking `{ ctx: { session, isAdmin, base } }`; read through `app/g/[groupId]/_components/data.ts` and render a client piece. Settings sections decide for themselves what non-Admins see (return `null` for nothing).
- Home and Settings render sections in nav `order`, only for enabled Toolkits.
- Hooks get `{ groupId, memberId | null }`. They run once per real change (`services/toolkits.setToolkit`) and for every Toolkit in the Onboarding preset (`groups.updateGroupSettings`).

## What you get for free

- **Agent:** its tools are in `toolsFor()` when it's on; its `persona` is in the instructions; "Off here: X" when it's off.
- **Gate:** its `gate.criterion` is offered to Jev only while it's on (`gate/jev.ts questionsFor`).
- **Chat:** `toggle_toolkit` finds it by id or name and checks `requires`; `list_toolkits` describes it.
- **Dashboard:** the card and sheet on `/g/<id>/toolkits`, the nav tab, Home and Settings sections, the off state of its pages, and one line from Roomie in the Chat when an Admin switches it on (10 minute cooldown).
- **Presets:** add it to `src/toolkits/presets.ts` if a Group purpose should get it at Onboarding.

## Checklist

- [ ] `src/toolkits/<id>/manifest.ts` with every field above that applies; `status` and `defaultOn` deliberate
- [ ] tools in the folder, each calling a service; tool keys equal tool ids
- [ ] `server.ts` with tools, any dashboard sections, idempotent hooks
- [ ] a line in `manifests.ts` (`MANIFESTS`) and `registry.ts` (`BY_ID`)
- [ ] presets updated if a purpose should include it
- [ ] `npm run typecheck`, `npm test` (`registry.test.ts` checks the manifest is complete, abilities name real tools, nav hrefs and pages are well formed)
- [ ] `npm run test:tools`: every new tool exercised (the coverage test fails otherwise)
- [ ] record a few Jev answers with the new criterion and add them to `gate.test.ts`; add eval scenarios in `src/mastra/evals/scenarios.ts`
- [ ] read-only tools added to `READ_ONLY_TOOLS` in the scenarios
- [ ] glossary words for anything new (GLOSSARY.md)

A coming-soon Toolkit is just a manifest in `src/toolkits/coming-soon.ts`. Building it means moving it into its own folder and adding it to the two lists.
