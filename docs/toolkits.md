# Adding a Toolkit

## Vocabulary: Trick = Toolkit

People never see the word Toolkit. In everything a person reads (chat replies, the intro, `/help`, the dashboard, tool results Roomie relays) a Toolkit is a **Trick**, switching one on is **teaching** Roomie (people say "roomie, learn trips"), and switching it off is making Roomie **forget** it. Never "toolkit", "capability", "module", "plugin", "feature" or "enable" in user-facing strings. Code keeps "toolkit" (folders, ids, `toggle_toolkit`, `group_toolkits`); the dashboard page lives at `/g/<id>/toolkits` and, under its own name, `/g/<id>/tricks` (the links use `/tricks`). A manifest's `name` is the Trick's name.

## The folder

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
| `gate` | `{ criterion, examples }`: `criterion` is the Jev `toolkit` choice text (which messages belong here); `examples[0]` is what Roomie suggests when it's taught ("Learned Groceries. Try: ..."), and the first two are its `/help` line |
| `persona` | lines in the TRICKS block of Roomie's composed persona (`mastra/persona.ts`, the `/* TOOLKIT_PERSONA */` slot) while it's on. Put the Toolkit's tool-routing rules here, not in `persona.ts` `CORE_RULES` |
| `abilities` | plain words per tool id for the sheet's "What it can do" (tools without one show their description) |
| `postOrder` | where its lines sit in Roomie's own posts, the morning Bundle and the weekly report (ADR 0017: money 10, the landlord 20, the house 30, groceries 40). Default: nav order, then last |
| `dashboard.nav` | `{ label, href: (groupId) => path, icon, order }`: a dock tab. The dock is Home + the first 3 learned by `order` + More (Ask Roomie in the middle); two Toolkits pointing at the same path share one dock tab. The More drawer lists every learned one (each its own tile), a greyed slot for each one not learned yet (Teach / Ask an admin) and each coming-soon one (inert, "Soon") |
| `dashboard.pages` | route prefixes under `/g/<id>/` it owns (`["cart"]`). While every owner is off, the page shows "Roomie hasn't learned X here yet." with Teach Roomie X / Ask an admin |

## Server entry (`server.ts`)

```ts
export const groceries = defineToolkit(manifest, {
  tools: { ...cartTools, ...recipeTools },
  dashboard: {
    home: () => import("./dashboard").then((m) => m.GroceriesHome),        // Home section
    settings: () => import("./dashboard").then((m) => m.GroceriesSettings), // Settings section
    mood: () => import("./dashboard").then((m) => m.someMood),              // optional: doorway mood if the Group's mood can't be read
    homeOrder: 15,                                                          // optional: Home position (default: nav order)
  },
  onEnable: (ctx) => seedPantry(ctx), // off -> on, and for the Onboarding preset. Must be idempotent
  onDisable: async (ctx) => {},
  bundle: (ctx, now) => restockLine(ctx, now),                                // optional: its line in the morning Bundle, or null
  report: async (ctx) => cartReportParts((await listOpenItems(ctx)).length), // optional: its sections of the weekly report
});
```

- Dashboard sections are lazy imports so the agent runtime (tsx, evals, Mastra) never loads React. They are async server components taking `{ ctx: { session, isAdmin, base } }`; read through `app/g/[groupId]/_components/data.ts` and render a client piece. Settings sections decide for themselves what non-Admins see (return `null` for nothing).
- Home and Settings render sections in nav `order` (Home: `homeOrder` first, so it reads standing, today, then the rest), only for enabled Toolkits. Home's doorway mood is the Group's (`services/personality.groupMood`); a Toolkit's `mood` is the fallback.
- Hooks get `{ groupId, memberId | null }`. They run once per real change (`services/toolkits.setToolkit`) and for every Toolkit in the Onboarding preset (`groups.updateGroupSettings`). Whatever a Group should start with (House's starter chores, the Pantry) is the hook's job: Onboarding names no Toolkit.
- **Bundle and report** (ADR 0017): `bundle(ctx, now)` returns one line for Roomie's morning post or `null` when there's nothing to say; `report(ctx, now)` returns `{ icon, text }` parts for the weekly Group Report. Both are thin calls into the Toolkit's own service (`services/house.ts`, `services/money.settleReportParts`, `services/cart.cartReportParts`). `services/bundle.ts` and `services/report.ts` compose the enabled Toolkits' contributions in `postOrder` (`services/toolkits.enabledToolkitEntries`), add core's own line last (whole-group Reminders due today in the Bundle, next week's in the report) and never name a Toolkit; the scheduler posts the Bundle at the Group's nudge hour (`group_toolkits["house"].settings.nudgeHour` today; an hour inside quiet hours, 22:00-08:00, goes out at 08:00) and the report on its day, each claimed once per period in `scheduled_posts` (kinds `bundle`, `report.weekly`). No lines, no post.
- **Saying something urgent or private on its own** (ADR 0017): `services/urgent.postUrgent(groupId, text, now)` is the one urgent slot a day (claimed as `urgent` for the local day; inside quiet hours held in `pending_posts` until 08:00; `{ posted } | { posted: false, reason: "claimed" | "quiet" | "paused" }`); `services/nudges.sendNudge(memberId, out, now)` is a private nudge (skipped when `member_notes.note.nudges === "off"`, held to 08:00 at night). Never call `deliver` / `deliverPrivate` directly for an unprompted post.
- **Filing a Document** (ADR 0018): `services/documents.fileDocument(ctx, { kind, title, bytes, contentType, source?, uploadedBy? })` stores the file (Neon Object Storage, `integrations/blob-store.ts`) and its row; people open it at `/api/docs/<id>`. Forgetting a Trick never deletes what it filed.
- **Stay in your folder.** `src/toolkits/coupling.test.ts` fails when a Toolkit id appears as a literal outside its own folder, `manifests.ts`, `presets.ts`, `registry.ts`, `coming-soon.ts`, the landing's `demos.ts` / `tricks.ts`, `db/enums.ts`, the two services that keep a Trick's settings on its `group_toolkits` row (`pantry.ts`, `schedule.ts`), docs and tests. A manifest's `requires` is the one sanctioned way to name another Toolkit. Add to that allowlist only on purpose.

## What you get for free

- **Agent:** its tools are in `toolsFor()` when it's on; its `persona` is in the instructions; "Off here: X" when it's off.
- **Gate:** its `gate.criterion` is offered to Jev only while it's on (`gate/jev.ts questionsFor`).
- **Chat:** `toggle_toolkit` finds it by id or name and checks `requires`; `list_toolkits` describes it.
- **Chat copy:** its line in `/help` (`channels/text.ts`) and in the setup's "Learned ..." line (`onboarding.ts learnedLine`).
- **Dashboard:** the card and sheet on the Tricks page, the dock tab and More drawer tile, Home and Settings sections, the off state of its pages, and one line from Roomie in the Chat when an Admin teaches it from the dashboard (10 minute cooldown). The Group's own pages (Reminders, Members, Settings) are the dock's, not a manifest's.
- **Roomie's own posts:** its `bundle()` line in the morning Bundle and its `report()` sections in the weekly report, in `postOrder`.
- **Presets:** add it to `src/toolkits/presets.ts` if a Group purpose should get it at Onboarding.

## Checklist

- [ ] `src/toolkits/<id>/manifest.ts` with every field above that applies; `status` and `defaultOn` deliberate; `requires` for any Toolkit it leans on (Groceries needs Money)
- [ ] tools in the folder, each calling a service; tool keys equal tool ids
- [ ] `server.ts` with tools, any dashboard sections, idempotent hooks, and `bundle` / `report` if it has something to say on its own (with a `postOrder`)
- [ ] a line in `manifests.ts` (`MANIFESTS`) and `registry.ts` (`BY_ID`)
- [ ] presets updated if a purpose should include it
- [ ] `npm run typecheck`, `npm test` (`registry.test.ts` checks the manifest is complete, abilities name real tools, nav hrefs and pages are well formed; `coupling.test.ts` that its id stayed in its folder)
- [ ] `npm run test:tools`: every new tool exercised (the coverage test fails otherwise)
- [ ] record a few Jev answers with the new criterion and add them to `gate.test.ts`; add eval scenarios in `src/mastra/evals/scenarios.ts`
- [ ] read-only tools added to `READ_ONLY_TOOLS` in the scenarios
- [ ] glossary words for anything new (GLOSSARY.md)

A coming-soon Toolkit is just a manifest in `src/toolkits/coming-soon.ts` (today, in this order: Lease stuff `household-admin`, Outings, Cooking, Research, Trips, PDFs, Stickers; the landing page and the Tricks page list them in that order, and its accent is in `src/app/_landing/tricks.ts`). Building it means moving it into its own folder and adding it to the two lists.

## Routine actions carry no links

Tools return `links` only for something the person asked to open: the Instacart list (`cart_checkout`, `recipe_link`), a sign-in or connect button, the dashboard (`get_dashboard_link`), or a page they asked for (`cart_view` with `link: true`). Adds, removes, views, chores done and the Tricks list return none: WhatsApp shows a button as a bare URL line under every reply.

## Groceries

The flow is **track -> Instacart list -> receipt -> who had what -> confirm -> split**. Groceries itself has **no prices**: nothing is estimated, `cart_items.est_cents` is no longer written (the column stays for old rows and is ignored), and no tool result, persona line, Cart page or Recipe shows a price or a cart total. Real money arrives later: "I paid 84" (`cart_purchased`, one Expense split by who added what, one share per item, shared items evenly) or a receipt photo through Money (`expense_from_receipt`, item by item at the printed prices). Groceries therefore `requires` Money: it can't be taught with Money off, and Money can't be forgotten while Groceries is on.

- **Quantities** are free text, kept as said ("2 cartons", "12", "1 lb"); `lib/units.parseAmount` fills the structured quantity + unit for Instacart. `cart.addAsSaid` holds back what can't be read one way (`clarifyQuantities`: "eggs, 12, 18" -> `needsClarification: ["eggs: 12 and 18 what? cartons or eggs?"]`) and adds the rest; Roomie asks that one question.
- **Photos**: `cart_from_photo({ photo_url, shared?, for?, confirm?, skip? })` reads a recipe, a shopping list or a shelf with the vision model (only our own uploads, never a typed URL; `services/grocery-photos.ts`, the same `askVision` call as receipts; `setPhotoReader()` in tests, `RECEIPT_FAKE=1` in evals picks a fake by the photo's bytes). Without `confirm` it returns `{ kind, items: [{ name, qty }], summary, needsConfirmation }` and Roomie asks in one line ("5 items: eggs (12), milk, …. Add them as shared?"); with `confirm` it adds them (`addPhotoToCart`: a recipe is saved as a Recipe and goes in like one, minus the Pantry and `skip`). A receipt photo comes back as `{ kind: "receipt", next: "expense_from_receipt" }` and Roomie uses Money's tool (always there, since Groceries requires Money).
- **Awareness**: every Cart, Recipe and Pantry change writes an Activity row with its source (chat or dashboard), so Roomie's SINCE YOU LAST SPOKE facts say "Ryan took eggs off the Cart (dashboard, 2 min ago)".
