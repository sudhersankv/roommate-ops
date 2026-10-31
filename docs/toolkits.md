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
| `requires` | `{ env?, toolkits?, integrations? }`: it can't go on until these are met; the sheet shows each red/green. An integration whose fake should count (MAIL_FAKE=1 for `agentmail`) is an integration, not an env var: `services/toolkits.requirementFacts` asks the integration (`mailAvailability`) |
| `worksWith` | `{ integrations }`: optional extras, shown in the sheet, never blocking |
| `status` | `stable`, `beta` (badge) or `coming-soon` (listed, can't be switched on) |
| `gate` | `{ criterion, examples }`: `criterion` is the Jev `toolkit` choice text (which messages belong here); `examples[0]` is what Roomie suggests when it's taught ("Learned Groceries. Try: ..."), and the first two are its `/help` line |
| `persona` | lines in the TRICKS block of Roomie's composed persona (`mastra/persona.ts`, the `/* TOOLKIT_PERSONA */` slot) while it's on. Put the Toolkit's tool-routing rules here, not in `persona.ts` `CORE_RULES` |
| `abilities` | plain words per tool id for the sheet's "What it can do" (tools without one show their description) |
| `offerLine` | one sentence Onboarding's wrap-up line (`learnedLine`) adds while it's off, for a Trick that's off by default because it needs a connection step (Lease Inbox: "Want me to handle the landlord's emails too? ..."). The first off one with an `offerLine` is offered; it's never the "learn X" tip |
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

A coming-soon Toolkit is just a manifest in `src/toolkits/coming-soon.ts` (today, in this order: Outings, Cooking, Trips, Stickers, Guests, Move-out; the landing page and the Tricks page list them in that order, and its accent is in `src/app/_landing/tricks.ts`). Building it means moving it into its own folder and adding it to the two lists (Lease Inbox was the last one moved, #27).

## Routine actions carry no links

Tools return `links` only for something the person asked to open: the Instacart list (`cart_checkout`, `recipe_link`), a sign-in or connect button, the dashboard (`get_dashboard_link`), or a page they asked for (`cart_view` with `link: true`). Adds, removes, views, chores done and the Tricks list return none: WhatsApp shows a button as a bare URL line under every reply.

## Money: rent, bills and the Settle nudge (#25, ADR 0019)

- **Rent** is the Group's recurring monthly Expense with category `rent` and one Payer (who pays the landlord); no table of its own (`services/rent.ts`: `getRent`, `setRent`). A rent not charged yet is changed in place; once a month of it has been, a change stops the old parent and starts a new one at the next month not charged, so past months keep their amounts. Only the Payer or an Admin changes it (`set_rent` is also `adminOnly`: an Admin's own words say "rent").
- **Money's `bundle()`**: three local days before the due day the line "Rent $2,400 is due Sunday. Maya pays the landlord."; on the due day only while someone still owes the Payer (names, never amounts). It also runs `rentDmJob`: each person with a Share except the Payer gets their own amount in a DM with pay links to the Payer's handles (none saved: no button, and the text says how to add one), claimed as `scheduled_posts` `rent.ahead` per due month and only in the Bundle's hour, because Home's Today calls `bundle()` too.
- **Variable bills** (`set_variable_expense`, `expenses.variable`): the parent is a template with 0 cents (allowed only for a variable parent; Balances, the Settle plan and Splitwise skip it). On its due day `runRecurring` writes `pending_amounts` (one per parent and month) and DMs the Payer "How much was the electric bill?", once more the next day, then waits for next month. `answer_amount` logs that month as its own Expense split like the parent (the Payer or an Admin, once). `prefillAmount(groupId, matchText, cents)` is the Lease Inbox's hook: the ask then reads "Looks like $92 (from the bill). Right?".
- **The Settle nudge** (`services/settle-nudge.ts`): Money's `report()` runs `settleNudgeJob` (claimed as `nudge.settle`, only in the report's day and hour) and its line is a count: "2 open balances; I've DM'd everyone." or "All square.". A pairwise debt over the threshold whose oldest unsettled contribution (or the last Settlement between them, if later) is at least the days old gets one DM per pair; `member_notes.note.nudges = "off"` skips that Member. Settings: `group_toolkits["splitting"].settings.nudge = { thresholdCents, thresholdDays, enabled }` (Admin; Settings' Nudges card).
- **The offer**: `rent_status` returns `offer: true` once per Group (a `pet_moments` `rent-offer` claim), and the weekly report adds one offer line instead when nobody asked first.
- A Toolkit may send its own DMs from `bundle()` / `report()` like this, but each send needs its own `scheduled_posts` claim and its own window check.

## Groceries

The flow is **track -> Instacart list -> receipt -> who had what -> confirm -> split**. Groceries itself has **no prices**: nothing is estimated, `cart_items.est_cents` is no longer written (the column stays for old rows and is ignored), and no tool result, persona line, Cart page or Recipe shows a price or a cart total. Real money arrives later: "I paid 84" (`cart_purchased`, one Expense split by who added what, one share per item, shared items evenly) or a receipt photo through Money (`expense_from_receipt`, item by item at the printed prices). Groceries therefore `requires` Money: it can't be taught with Money off, and Money can't be forgotten while Groceries is on.

- **Quantities** are free text, kept as said ("2 cartons", "12", "1 lb"); `lib/units.parseAmount` fills the structured quantity + unit for Instacart. `cart.addAsSaid` holds back what can't be read one way (`clarifyQuantities`: "eggs, 12, 18" -> `needsClarification: ["eggs: 12 and 18 what? cartons or eggs?"]`) and adds the rest; Roomie asks that one question.
- **Photos**: `cart_from_photo({ photo_url, shared?, for?, confirm?, skip? })` reads a recipe, a shopping list or a shelf with the vision model (only our own uploads, never a typed URL; `services/grocery-photos.ts`, the same `askVision` call as receipts; `setPhotoReader()` in tests, `RECEIPT_FAKE=1` in evals picks a fake by the photo's bytes). Without `confirm` it returns `{ kind, items: [{ name, qty }], summary, needsConfirmation }` and Roomie asks in one line ("5 items: eggs (12), milk, …. Add them as shared?"); with `confirm` it adds them (`addPhotoToCart`: a recipe is saved as a Recipe and goes in like one, minus the Pantry and `skip`). A receipt photo comes back as `{ kind: "receipt", next: "expense_from_receipt" }` and Roomie uses Money's tool (always there, since Groceries requires Money).
- **Restock** (#26, `services/restock.ts`, pure math in `restock-math.ts`): `purchase_events` are derived, never a second ledger: one per item when `markPurchased` flips the Cart (in its transaction; personal = whoever added it, shared = null) and one per receipt line through `recordReceiptPurchases(ctx, expenseId, lines)` (once per Expense). Names go through `lib/items.normalizeItem` ("Milk 2%", "whole milk", "milk, 1 gal" -> "milk"; "oat milk" stays its own thing). An item and scope (shared, or one Member's own) bought on 3+ distinct days is probably low from floor(0.9 x the median gap) days after the last purchase, unless bought in the last two days, open in the Cart, or muted (`group_toolkits.settings.restockMutes`, any active Member: `restock_mute` / `restock_unmute`). Shared items are Groceries' `bundle()` line ("Probably low: milk, dish soap. Add them?", four names then "+N more"); a Member's own come from `personalCandidates` for their DM and are never named in the group (`restock_status` and `cart_checkout`'s `suggested` add them only in a DM). No prices, no amounts.
  - **"Yes, add them"**: the scheduler logs the Bundle as Roomie's chat line, so the follow-up window is open and the agent sees "Probably low: …" in the recent chat; the persona sends yes / add them / "just the milk" to `restock_add_listed({ scope: "shared" | "mine", only? })` (`restockAddListed`), which replies in one line ("Added milk and dish soap as shared."). It recomputes today's candidates, so whatever was bought or added to the Cart since the line is never added again. Anything else is still `cart_add`.
  - **Personal DMs**: Groceries' `bundle()` runs `restockDmJob` first: in the Bundle's hour only, one "Probably low: your oat milk. Add it?" per Member per local day, claimed as `scheduled_posts` kind `restock.dm` with period `<day>:<memberId>`, sent through `sendNudge` (quiet hours, "stop nudging me", paused Groups) with the Start hint when there's no DM path. A yes in the DM is `restock_add_listed` with scope "mine".
  - **Receipts**: `expense_from_receipt` calls `recordReceiptItems` after logging: a line one Member claimed is theirs, the rest shared; only `groceries` and `household` receipts count (a restaurant's steak isn't restocked).
  - **Checkout**: with probably-low items not in the Cart, `cart_checkout` returns `askFirst` + `suggested` + `say` ("Want me to add eggs and coffee? They're probably low.") and makes no list; Roomie asks once, then calls it again with `skip_suggestions` (straight away for "just checkout").
  - **Cart page**: `cartPageView.probablyLow` (`probablyLowView`, shared plus the viewer's own, "last bought N days ago") is a section above Shared with Add (`restockAddListed` with `only`) and Mute (`mute`); hidden when empty.
- **Awareness**: every Cart, Recipe and Pantry change writes an Activity row with its source (chat or dashboard), so Roomie's SINCE YOU LAST SPOKE facts say "Ryan took eggs off the Cart (dashboard, 2 min ago)".

## Lease Inbox (#27, ADR 0016)

One email address per Group (AgentMail; `FakeMail` with `MAIL_FAKE=1`), off by default and offered at setup (`offerLine`). Teaching it (`onEnable` -> `services/lease-inbox-toolkit.startLeaseInbox`) makes the address once and posts it with the three ways to connect. The core is `services/lease-inbox.ts` (trust, `storeInbound`, `classifyInbound`, work orders, `sendToLandlord`, the signature); the pure rules are `send-rule.ts`, `lease-inbox-rules.ts` and `lib/forwarded.ts`.

- **Inbound:** `POST /api/mail` (`app/api/mail/webhook.ts`): Svix on the raw body with `AGENTMAIL_WEBHOOK_SECRET` (401 otherwise), 204 at once, queued per inbox (`KeyedQueue`); `services/lease-inbox-inbound.handleMailEvent` finds the Group by inbox id, does nothing while the Trick is forgotten, fetches a body that came as `body_url`, then `processInbound`: `storeInbound` (deduped on `event_id`), attachments as Documents (`attachmentKind`: lease / notice / bill / email; a lease or notice gets `documents.text` from AgentMail's `textUrl`, else the vision model, `services/lease-text.ts`), `classifyInbound` with its hooks wired, then the class's one line (`postLine`: nothing when paused, held to 08:00 in quiet hours as a `pending_posts` "line").
- **The hooks** (each a thin call; what a class does is decided in the core): notice -> a whole-group Reminder at 18:00 local the evening before (`setReminder` as the forwarder, else the first Admin) and, within 72 hours, `postUrgent` (then the line isn't posted twice); rent-lease -> each Admin privately (`sendNudge`): the landlord's line and the exact words "roomie, update the rent to $2,550", which run `set_rent` through its existing admin ask (the Admin's own words say "rent"); nothing new confirms anything, and the rent Expense doesn't change until then. A utility bill -> `recurring.prefillAmount`. A new sender -> the Admins privately once per domain (`pet_moments` "new-sender"), "yes" -> `trust_sender` with no sender = the one asked about (`askedSender`). A forward that taught the landlord -> the intro offer to the Admins, once per domain ("lease-intro").
- **The classifier** (`services/mail-classifier.ts`): `SMALL_MODEL` on the gateway's chat completions, JSON in the text, zod, one retry with the error, then `other`; amounts as written, cents in code. `setClassifier()` for tests, `MAIL_CLASSIFIER_FAKE=1` (keywords) for evals.
- **Sending:** `report_issue` and `send_to_landlord` (`sendForMember` finds the thread from `about`: a work order's words, else the landlord's email that matches, else their newest). An `ask` comes back with nothing sent and the send held in `sendToLandlord` (10 minutes, that Member, that recipient and draft); the next call releases it only with the same Member's own latest message saying yes (`saysYes`) or the dashboard's token. There is no `confirmed` argument. The dashboard's reply box (`replyToLandlord`) shows the `ask` as a confirm step ("Send anyway" sends the ask's `confirmToken` back). Replies go only to threads whose sender (`reply_to` for a forward) is trusted now.
- **Its own posts:** `bundle()` = a visit tomorrow ("Someone be home?") and a work order the landlord hasn't answered for 5, 10, 15 local days (the follow-up offer); `report()` = "Lease inbox: 1 notice, 2 other emails" for the last 7 days.
- **Dashboard:** `/g/<id>/inbox` (tabs Notices, Rent & lease, Work orders, Everything else, New senders; a thread view; the reply box) and Settings -> Lease Inbox (the address with Copy; Admins remove trusted senders and release the address). `release_inbox` deletes the AgentMail inbox and the `group_inboxes` row; what was filed stays.
- **Forget me** takes a Member's name off work orders, sent mail and forwards (`anonymizeMailMember`); delete group data takes the mail rows, work orders and senders, and releases the address (best-effort, `releaseGroupInbox`).