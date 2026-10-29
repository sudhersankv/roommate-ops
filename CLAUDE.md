# Roomie

Roomie is an AI groupmate that lives in a group chat and on a per-group dashboard. It splits costs, keeps the shared grocery cart, tracks chores and upkeep, and sets reminders. Persona: the group chat's pet. Each Group's Roomie takes its personality from the group (a vibe, a name, quirks, and the slang it slowly picks up); always brief and exact about facts (see "Personality" below).

**Read first:** the rebuild plan is in `docs/plan.md`, the vocabulary in `GLOSSARY.md`, and the decisions in `docs/adr/`. They are the spec; where they conflict with this file, they win. Steps 1 (rename), 2 (WhatsApp, waiting for its live test), 2b (Telegram), 3 (Mastra agent), 4 (identity, Groups, dashboard), 5 (Splitting), 6 (Groceries) and 7 (Chores, Upkeep, reminders, Group time zones) are done, plus the public landing page with the WhatsApp beta form (`docs/landing.md`); the code below is what exists today. Before a real Telegram group: `npm run telegram:check`, then `docs/first-group-test.md`; WhatsApp: `docs/whatsapp.md` (link the number at `/admin/whatsapp`). `npm run dev-chat` simulates a group chat without any app.

Agent skills for this repo live in `.agents/skills/`.

## The one rule

**All business logic lives in `src/services/`.** The agent's tools (`src/toolkits/*/`) and the dashboard (`src/app/`) are thin front doors that call the same service functions. Anything you can do in chat must be doable in the UI, and vice versa. Never put logic in a tool or a page that belongs in a service. Permissions are business logic too: they live in services, never in prompts or pages alone.

**The manifest is the Toolkit contract** ([ADR 0011](docs/adr/0011-manifest-is-the-toolkit-contract.md), [docs/toolkits.md](docs/toolkits.md)). The agent's tools and persona, the Gate's toolkit choices, the bottom nav, Home, Settings and the Toolkits page are built from the Group's enabled manifests. Never name a Toolkit in the shell, the Gate or the persona: put it in its manifest.

## Layout

```
src/
  db/schema.ts          Drizzle tables: groups, chats, accounts, members, claim_tokens, group_toolkits, chat_messages,
                        member_notes, activity, pet_moments + the Toolkit tables (expenses, expense_payers, expense_splits,
                        settlements, splitwise_links, expense/settlement_external_refs, outbox_jobs, recipes, cart_items,
                        cart_checkouts, chores,
                        chore_logs, reminders, maintenance), all keyed by group_id; wa_sessions (the WhatsApp login,
                        BufferJSON rows "creds" / "<type>-<id>") and wa_contacts (LID -> phone JID + name); beta_requests
                        (the landing page's WhatsApp beta form, not tied to a Group); trick_votes ("I want this" on a
                        coming-soon Trick, migration 0008)
  db/enums.ts           categories, split methods, recurrences, sources, Group purposes, beta sizes / statuses (no drizzle
                        import: client code uses them)
  db/index.ts           db client
  services/             (ctx: Ctx, input) => result. Source of truth. index.ts re-exports as namespaces.
    types.ts            Ctx { groupId, memberId, source }, GroupCtx { groupId }, dollars()
    authz.ts            NotAllowedError, requireActive / requireAdmin (load the Member from the DB), canChangeExpense
    groups.ts           settings (validateSettings, defaultToolkitsFor = the purpose preset), listToolkits (no row =
                        defaultOn), delete group data; Onboarding's preset runs the Toolkits' onEnable hooks
    toolkits.ts         setToolkit (Admins; by id or name; coming soon / unmet requires refused; hooks once per change;
                        a dashboard switch-on posts ONE line in the Chat, 10 min cooldown), catalogFor, checkRequirements
    members.ts          list (active / active+pending), approve, decline, promote, payment handles, forgetMe, Member
                        facts (rememberAboutMe, knownAbout: your own or an Admin, peopleFacts for the instructions),
                        rekeyChannelUser (WhatsApp LID -> phone JID), fillPlaceholderName
    claims.ts           Claim links: issueDashboardLink, createClaimToken, consumeClaim, upsertAccount
    activity.ts         record() + listActivity(): who added, changed or deleted what
    chatlog.ts          chat_messages: log, recent chatter, follow-up window facts, retention delete
    split.ts            pure split math (no DB import, so the drawer previews with it): splitEvenly, splitExact,
                        splitPercent, splitShares, checkPayers, apportion (largest remainder), computeShares
    money.ts            Expenses (logExpense/updateExpense take intent: method + splitAmong|splits|percents|shares,
                        payers, category, note, occurredOn, recurring), delete/restore, Balances (from expense_payers),
                        getSettlePlan (simplified or pairwiseDebts per groups.simplify_debts), settleUp, debtBetween
    categories.ts       guessCategory (fallback when nobody picked one)   recurring.ts  latestOccurrence + runRecurring
    receipts.ts         photo -> parsed receipt (vision on the gateway, sums recomputed), receiptSplits, saveUpload
    splitwise.ts        connect / import / export / live mirror (ADR 0004) + runSplitwiseOutbox
    outbox.ts           outbox_jobs: enqueue, due, done/failed with backoff (ADR 0009)
    cart.ts             Cart items (recipe_id, quantity + unit next to the free-text qty), removal (adder or Admin),
                        checkout (snapshot -> Instacart shopping list -> cart_checkouts), markPurchased (exact Expense)
    cart-split.ts       pure: computeCartSplits, cartTotal, canRemoveItem (the "I paid" drawer previews with it)
    recipes.ts          draftRecipe / writeRecipe (Sonnet, strict JSON, one retry), save/list/get, addRecipeToCart,
                        recipeLink (cached by recipeKey), upcomingRecipes
    recipe-math.ts      pure: Pantry matching (covers, haveNeed), scaleIngredients, recipeKey
    pantry.ts           group_toolkits.settings.pantry for groceries: getPantry, updatePantry (any active Member)
    chores.ts           the chart: Rotation (turnFor), passes (skipChore), local due days (choreSchedule), streaks per
                        Member (streaksFor), add/remove (Admin), hallOfShame + chartLine, addStarterChores (Onboarding)
    upkeep.ts           upkeep items in local days (upkeepSchedule: due soon = 7 days), markDone, remove (Admin),
                        DEFAULT_ITEMS / addDefaults ("the usual five")
    reminders.ts        one-off / daily / weekly / monthly (nextOccurrence keeps the wall-clock across DST), whole Group
                        or one Member (private), reminderLine ("(set by Maya)"), visibleTo / canCancel, claim before send
    report.ts           groupReport + formatGroupReport (one message, sections of enabled Toolkits; casual = sentences),
                        choresNudgeText
    schedule.ts         groupTimezone, the nudge hour and report day/hour (getSchedule / updateSchedule, Admin), the
                        pure windows, claimPost / releasePost on scheduled_posts
    personality.ts      groups.personality: getPersonality, updatePersonality (Admin), saveLearned (style job), resetLearned
                        (Admin), groupMood (worried / sleepy / happy / calm), allSquare
    pet.ts              say-once pet moments on pet_moments (MomentStore): dayGreeting, claimWins
    beta.ts             Beta requests (docs/landing.md): submitBetaRequest (honeypot, zod, 3 per IP-hash per hour, store,
                        then notifyOperator: Telegram DM to the first ROOMIE_OPERATOR_EMAILS Account's Telegram Member, else
                        a "[beta]" log line); list / setBetaStatus / delete take the operator (NotAllowedError otherwise)
    trick-votes.ts      voteForTrick (coming-soon ids only, 1 per Trick per IP-hash a day, 12 an hour) + trickVoteCounts
  onboarding.ts         onGroupJoined (Group + Chat + Members, adder = Admin, intro + setup questions),
                        onParticipantJoined (Pending + "approve X?") and onUnknownSender (Pending, or active inside a
                        Channel's roster grace, ADR 0010). Called by Channel adapters (ADR 0008)
  pipeline.ts           the message flow, channel-agnostic: handleIncoming(msg) resolves Group/Member itself (unknown
                        Chat -> Onboarding, unknown sender -> onUnknownSender), logs the line, runs the Gate, calls the
                        agent, collects links. isPrivate (a Member's DM): addressed, not logged. askRoomie(ctx, text)
                        for the dashboard. One trace per message.
  mastra/
    index.ts            `mastra`: the roomie agent, PostgresStore, Observability, scorers, logger
    context.ts          RequestContext schema { groupId, memberId, memberName, role, status, source, toolkits?,
                        toolkit?, gate?, mayStaySilent?, pet? ("petted" | "greet") } + ctxOf()
    agents/roomie.ts    ONE agent, built once: fetches the facts (personality, mood, people, Roomie's last replies,
                        enabled Toolkits); tools = toolsFor(toolkit, enabled Toolkits)
    agents/instructions.ts  pure: roomieInstructions = composePersona(...) with its Toolkit slot filled from the enabled
                        manifests (what's on/off + each one's persona fragment) + members + time zone + Pending /
                        Onboarding (vibe + presets) / /pet / greeting / Gate blocks
    persona.ts          pure: core rules + house style + archetype voice + sliders as sentences + quirks + learned
                        style (gated by confidence) + /* TOOLKIT_PERSONA */ + mood + people (ADR 0012)
    memory.ts           Memory: thread group-<id>, resource <groupId>; last 30, semantic recall, working memory
    forget.ts           memory cleanup for "forget me" (a Member's lines + note) and "delete group data" (the thread)
    gate/               policy.ts (pure: decideGate, Chattiness thresholds, follow-up window, parseSilent), jev.ts
                        (questionsFor(enabled): the toolkit choices are the enabled manifests' gate criteria + core + none),
                        index.ts
    scorers/            relevancy (built-in) + brevity-tone (custom), Haiku judge, 10% of live replies
    evals/scenarios.ts  the fixed scenario set for `npm run evals`
  toolkits/             docs/toolkits.md: how to add one
    types.ts            the contract: ToolkitManifest (summary, longDescription, icon, category, tags, defaultOn,
                        requires, worksWith, status, gate { criterion, examples }, persona, abilities, dashboard { nav,
                        pages }) and Toolkit (+ tools, dashboard { home, settings, mood } lazy refs, onEnable/onDisable)
    define.ts           defineManifest (keeps the id literal), defineToolkit (manifest + server parts)
    manifests.ts        client-safe: MANIFESTS -> ToolkitId / TOOLKIT_IDS, CATALOG (+ coming-soon), manifestOf, findManifest
    coming-soon.ts      manifest-only stubs: research, pdf, trips, stickers, household-admin
    presets.ts          purpose -> Toolkits (roommates/family: all four; trip/other: splitting+groceries; friends/work: splitting)
    registry.ts         server: TOOLKITS (BY_ID satisfies Record<ToolkitId, Toolkit>) + toolsFor(gateToolkit, enabled),
                        toolkitById. Wraps every tool so a NotAllowedError comes back as { notAllowed, reason, message }
    catalog.ts          server: allToolkits, enabledFor(groupId), isEnabled, toolkitStates (React-cached per request)
    util.ts             ctxOf, toCents, memberIdByName (opts.includePending), dashboardLinks
    core/               manifest.ts + server.ts; members (list, list_pending, approve/decline/promote, set_payment_handle,
                        forget_me), people (remember, what_do_you_know_about_me), settings (set_group_settings incl.
                        personality, toggle_toolkit, list_toolkits), dashboard (get_dashboard_link), reminders, report
    splitting/ groceries/ chores/ upkeep/   manifest.ts + server.ts + the tools (+ dashboard.tsx: Home/Settings sections;
                        groceries: cart.ts + recipes.ts)
  integrations/         composio.ts (client + cached key health), splitwise.ts (SplitwiseClient: ComposioSplitwise and
                        FakeSplitwise, splitwiseClient(), splitwiseAvailability())
  channels/types.ts     IncomingMessage { channel, chatExternalId, userExternalId, userName, text, imageUrl?, isPrivate?,
                        ... }, Outgoing, Channel, CantMessagePrivatelyError, ROSTER_GRACE_MS
  channels/index.ts     registry: registerChannel(); deliver(groupId, out) and deliverPrivate(memberId, out) go through
                        the Chat's adapter (only log when none is registered)
  channels/dev.ts       the dev adapter used by scripts/dev-chat.ts
  channels/telegram.ts  grammY adapter: TelegramChannel (outbound: typing, pause, rate limits, chunks, URL buttons, 403 ->
                        CantMessagePrivatelyError) + createTelegramBot(deps) (inbound: joins, new members, text/photo/
                        voice/DMs -> IncomingMessage, queued per Chat). Never imports the app: deps come in
  channels/telegram-boot.ts  real deps (pipeline, onboarding, services); telegramChannel() for instrumentation,
                        telegramBot() for the polling script and the webhook
  channels/whatsapp.ts  Baileys adapter (docs/whatsapp.md, ADR 0013): WhatsAppChannel (outbound: composing, pause, rate
                        limits, chunks, links as trailing "text — url" lines, LID recipients -> phone JID) +
                        createWhatsApp(opts) (connection: QR / pairing code, status(), reconnect with backoff, loggedOut
                        clears the session, connectionReplaced stops; inbound: notify-only messages deduped, joins with the
                        full roster, later joiners, subject changes, text/photo/voice/DMs -> IncomingMessage, queued per
                        Chat; the canonical id is the phone JID when resolvable, else the LID). Socket, auth and deps come in
  channels/whatsapp-auth.ts  makeAuthState(rows): Baileys' AuthenticationState over wa_sessions rows (BufferJSON, creds
                        written behind creds.update); postgresAuthState() loads the store lazily
  channels/whatsapp-store.ts pgAuthRows (wa_sessions) and pgContacts (wa_contacts); only imported lazily
  channels/whatsapp-boot.ts  real deps; whatsappClient() (built once per process, registers the Channel) and
                        whatsappChannel() for instrumentation (WHATSAPP_ENABLED=1; connects only with a saved login)
  channels/text.ts      shared copy and cutting: chunkText, commandOf, helpText, startReply, OOPS, NO_GROUP, wasAddressed
  channels/queue.ts     KeyedQueue: inbound work per Chat, in order
  channels/rate-limit.ts     token buckets (TokenBucket, SendLimiter) with an injectable clock; envMs
  lib/auth/             server.ts (createNeonAuth), client.ts (createAuthClient), dev.ts (DEV_AUTH_EMAIL bypass)
  lib/session.ts        sessionUser -> currentAccount -> memberSession(groupId) / currentMember(groupId) (redirect/404)
  lib/env.ts            loads .env with override (import first in every entry point)
  lib/llm.ts            model ids for the Neon AI Gateway ("neon/<id>"), the gateway embedder
  lib/urls.ts           APP_URL links (dashboardUrl, linkFor)
  lib/dates.ts          day strings and labels in the Group's time zone (client-safe)
  lib/time.ts           Group time zones, Intl only (client-safe): zonedParts, zonedTimeToUtc (DST gap -> later, overlap ->
                        first), dayInZone, startOfDay, addDaysInZone, nextWeekday, parseInZone (bare wall-clock = Group
                        zone), formatInZone, describeNow, resolveTimeZone ("Chicago", "CST", "India" -> IANA), zonesByRegion
  lib/money.ts          formatMoney / parseMoney (client-safe)
  lib/units.ts          Instacart's units, synonyms (tbsp, lb, pcs), clove/pinch/slice -> buyable, parseAmount, formatAmount
  lib/voice.ts lib/prices.ts lib/style-note.ts
  lib/personality.ts    pure, client-safe: ARCHETYPES, Personality (normalize / validate / apply patch), confidenceFor,
                        slangBudget, usableNicknames, saysName, isPetCommand, moodFrom, greeting / win / preview lines
  lib/style-stats.ts    pure: the Learned style's counts (countPhrase, countNickname, mergeLearned, activeHours)
  lib/pay-links.ts      Venmo / PayPal / Cash App links with the amount (settle_up and the settle drawer)
  jobs/scheduler.ts     60 s tick: due reminders (deliver for the Group, deliverPrivate for a Member), the daily chores
                        nudge and the weekly Group Report (claimed in scheduled_posts, once per period); Group style
                        refresh; recurring Expenses (hourly check); Splitwise outbox; daily retention
  jobs/report-text.ts   groupReportText: the same text for the weekly post and group_report (casual from the style note)
  jobs/retention.ts     deletes chat_messages older than 30 days (ADR 0006)
  jobs/style-note.ts    every 50 chat lines: Haiku proposes style candidates, style-stats counts them into
                        groups.personality.learned (setCandidateReader() for tests)
  proxy.ts              THE middleware (a root proxy.ts is ignored because the app is under src/): Neon Auth guard on
                        /g/* (-> /signin?next=<path>); /, /signin, /claim/* and /admin/* pass (admin pages 404 for
                        non-operators, signed out included); a stray neon_auth_session_verifier on any matched page ->
                        /auth/callback (dev bypass skips it)
  lib/auth/             server.ts (createNeonAuth, sameSite lax), client.ts, oauth-paths.ts (client-safe URL helpers:
                        SIGNIN_PATH, safeNext, afterSignIn, signInPath), oauth-return.ts (the verifier exchange behind
                        /auth/callback), dev.ts (DEV_AUTH_EMAIL bypass)
  lib/window-limit.ts   WindowLimiter: N tries per key per window, in memory (the beta form)
  instrumentation.ts    loads env, registers the Telegram Channel (outbound) when TELEGRAM_BOT_TOKEN is set; unless
                        DISABLE_SCHEDULER=1 (builds, tests), starts the WhatsApp socket (WHATSAPP_ENABLED=1) and the
                        scheduler once
  lib/operator.ts       currentOperator(): the signed-in user if their email is in ROOMIE_OPERATOR_EMAILS (lib/env.ts)
  components/ui/        shadcn components; components/roomie/ the mascot; components/app/ shared app bits
                        (sign-in, doorway, avatars, money-bits, categories, theme) and the self-contained Settings ->
                        Personality: personality-section.tsx (server, <PersonalitySection groupId />), -panel.tsx
                        (client), -actions.ts (its own server actions)
  app/
    layout.tsx globals.css   Figtree, theme script, toasts; the design tokens
    page.tsx            the landing page for everyone (_landing/, docs/landing.md); signed in, the nav says "Open dashboard"
    app/                /app: where a signed-in person lands: last/first Group, or "No groups yet" (+ paste a Claim link);
                        signed out -> /signin. The default `next` after sign-in (APP_PATH)
    _landing/           landing.tsx (sections), demos.ts (the fake chats; Roomie's lines from ARCHETYPES), chat.tsx
                        (ChatWindow), landing.css (CSS-only motion), beta-form.tsx + actions.ts (the WhatsApp beta form)
                        tricks.ts (Tricks + group presets from the manifests/PRESETS, accents), stage.tsx (the dino
                        watching a chat), vote-button.tsx, share-row.tsx, marks.tsx (links, share links, logos)
    help/               /help: how Roomie works + FAQ (public, indexable; reuses _landing/tricks.ts and marks.tsx)
    signin/             the sign-in screen: Google + paste a Claim link + "Sign-in didn't complete"; ?next= afterwards
    privacy/            the short privacy page (what's kept, per Group, forget me)
    claim/[token]/      Claim link: sign in, consume, link the Account, -> /g/<id>
    auth/callback/      Google sign-in return: verifier -> session cookies -> `next` (or `next?auth_error=<reason>`)
    g/[groupId]/        layout (session + GroupProvider + shell; Pending members see a waiting screen; groupView builds the
                        nav, overflow and owned pages from the enabled manifests once), Home (doorway + Toolkits' Home
                        sections + narration), money (+ ?tab=, [expenseId]), cart (+ ?recipe=; Recipes and Pantry in
                        _components/recipes.tsx), chores, members, settings (core + Toolkits' settings sections),
                        toolkits (the Toolkits page: search, category chips, cards, detail sheet; ?open=<id>);
                        actions.ts = every server action; _components/data.ts = services -> screen shapes;
                        _components/sections.tsx = the Toolkits' Home/Settings sections and mood for a request;
                        _components/toolkit-off.tsx = the off state of a page whose Toolkits are all off; _components/screens/*
                        settings/splitwise/callback = Composio's return URL (route handler)
    design/             the design-system page (dev only unless SHOW_DESIGN_PAGE=1)
    api/auth/[...path]  Neon Auth proxy; api/chat = Ask Roomie (session Member, 401/403); api/receipts = Scan receipt;
                        api/telegram = Telegram webhook (401 without TELEGRAM_WEBHOOK_SECRET in the header);
                        api/admin/whatsapp = status JSON + start / request-pairing-code / logout (operators, else 404)
    admin/whatsapp/     the operator page: state, QR (refreshes every 5 s), pairing-code form, the linked number, Log out
    admin/beta/         operators: the beta requests, newest first, status new / contacted / onboarded / declined
drizzle/                generated migrations (0000 baseline drops the pre-step-4 tables)
scripts/migrate.ts      npm run db:migrate
scripts/seed.ts         demo Group "Apt 4B" (dev Chat dev-apt-4b); prints its id, a Claim link for Maya, a Studio requestContext
scripts/dev-chat.ts     the terminal group chat stand-in (docs/dev-chat.md)
scripts/telegram.ts     npm run telegram: long polling (deletes any webhook first); telegram-webhook.ts --set/--delete/--info
scripts/telegram-check.ts  npm run telegram:check: read-only readiness (getMe, privacy mode, webhook, APP_URL, delays,
                        Toolkits, DB + migrations, a 1-token Haiku call, Jev); non-zero with the fix when something's off
scripts/whatsapp.ts     npm run whatsapp: holds the WhatsApp session from a terminal (QR in the terminal, --pair <digits>
                        for a pairing code, --timeout <s>); never while Fly holds it
scripts/og-image.ts     rebuilds public/landing/og.png (the share image) from the brand SVGs with sharp
scripts/evals.ts        runs the scenarios in throwaway Groups; --baseline writes docs/evals-baseline.md
scripts/studio-presets.ts  writes .mastra-presets.json for Studio (run by mastra:dev)
```

## Identity and permissions

- **Accounts and Claim links** (ADR 0003): a Member gets a single-use, 24-hour Claim link only when they ask for the dashboard (`get_dashboard_link`, which sends it privately and reuses a live one) or from `dev-chat link`. Never in bulk (ADR 0001). `/claim/<token>` signs them in with Google, upserts `accounts` from the session user (mirrored by `auth_user_id`, ADR 0008) and links `members.account_id`. One Account can be a Member of many Groups.
- **Who is what** (ADR 0008): whoever adds Roomie is Admin; people already in the Chat are active; later joiners and unknown senders are Pending until an Admin approves (chat or Members page).
- **Telegram can't list members** (ADR 0010): at join time Roomie knows the adder (Admin) and the group's Telegram admins (active). Anyone else becomes a Member on their first message: active if it's within 24 h of Roomie joining (`ROSTER_GRACE_MS`, from `chats.created_at`), Pending after. `new_chat_members` are Pending at once (with the approval ask), even inside the 24 h; people added together with Roomie count as already there.
- **WhatsApp can list members** (ADR 0013): when Roomie is added, the whole group (from `groupMetadata`) becomes active Members, the adder the Admin; there is no roster window and no "press Start": Roomie can DM any Member. Later joiners are Pending, as everywhere. A Member's `channel_user_id` is the phone JID (`<number>@s.whatsapp.net`) when resolvable, else the LID (`…@lid`); learned pairs go to `wa_contacts` and LID Members move to the phone JID (`rekeyChannelUser`). Members named by their number (`+1555…`, or "Someone" for a hidden one) take the profile name from their first message.
- **Private messages on Telegram:** a bot can't DM anyone first, so the intro asks people to tap @bot and press Start once. A refused DM is a `CantMessagePrivatelyError`; `get_dashboard_link` relays its "tap @bot and press Start" message and never posts the Claim link in the group. A DM from a Member of exactly one Group goes through the pipeline as that Group with `isPrivate`.
- **Rules** (`services/authz.ts`): Pending members can chat and read, but every write service calls `requireActive` and refuses with "Hang on, an admin needs to approve you first. <Admin> can approve you." Members, roles, settings, Toolkits and delete-group-data call `requireAdmin`. Expenses can be changed by whoever added or paid them, anyone with a Share, or an Admin.
- **Dashboard:** every page and action goes through `lib/session.ts`; nothing trusts a member id from the client. Non-Admins don't see admin controls, and the actions return 403 anyway.
- **Dev sign-in bypass:** with `NODE_ENV !== "production"` and `DEV_AUTH_EMAIL` set, that email is the signed-in Account (loud warning in the log). For automated browser checks only.
- **Privacy** (ADR 0006): chat_messages live 30 days; `forget_me` deletes a Member's chat lines, note and memory lines (ledger stays; a removed Member becomes "Former member"); "delete group data" wipes the Group's data and Roomie's memory but keeps the Group, Chat and Members.
## Splitting (step 5)

- **The model passes intent, never computed cents** (ADR 0007). "50/25/25" is `percents`, "2:2:1" is `shares`, "Dev 30, Sam 15" is `exact` (as said), "Alex paid 60 and I paid 40" is `payers`. The service computes every Share; a split that doesn't add up throws a `SplitError` whose message says what's left or over, and Roomie asks.
- **Rounding:** equal splits give leftover cents to the (primary) Payer first, then list order; percent and shares use largest remainder, ties by Payer first, then name. Percents must sum to 100 ± 0.01. Everything sums to exactly the total.
- **Payers:** `expense_payers` is the truth (Balances = Σ paid − Σ owed ± Settlements). `expenses.payer_id` is the primary Payer (paid the most), kept in sync for display. `expense_splits.weight` keeps the typed percent/shares so an edit re-renders the method, and `updateExpense` with only a new total re-splits equal/percent/shares the same way (exact or multi-payer need new amounts).
- **Categories** are always set: Roomie picks one (`log_expense.category` is required), the dashboard guesses from the description until you choose, `guessCategory` covers old rows and imports. `occurred_on` is the day it happened in the Group's time zone; lists sort by it.
- **Recurring** (`monthly` on the start's day of month clamped to 28, `weekly` on its weekday): the scheduler copies the parent with `recurring_parent_id`; (parent, day) is unique, so a copy is made once per period, deleted copies included.
- **Settle plan** follows `groups.simplify_debts`: on = fewest payments (`computeSettlePlan`), off = pairwise (`pairwiseDebts`). `settle_up` with `paid: false` records nothing and returns pay buttons (`lib/pay-links.ts`) for the payee's handles; `paid: true` records a Settlement. Handles live in `member_notes.note.handles` and are merged in SQL so two saved at once both stick.
- **Receipts:** `services/receipts.ts` sends the photo (always as a data URL; our own `/uploads/...` files are read from disk) to `RECEIPT_MODEL ?? LLM_MODEL` on the gateway's `/v1/chat/completions` with an `image_url` part (no `temperature`: claude-sonnet-5-5 rejects it). The model only transcribes; zod validates, prices are parsed as strings, the total is recomputed (items + tax + tip) and a mismatch is flagged so Roomie asks. `expense_from_receipt` builds exact Shares per item (unclaimed items shared, tax and tip proportional), shows the breakdown first unless they explicitly asked to log it. Photos go to `public/uploads/<folder>/` (gitignored). `RECEIPT_FAKE=1` (evals) or `setReceiptReader()` (tests) skip the model.
- **Splitwise** (ADR 0004, 0009): `SplitwiseClient` with a Composio implementation (`composio.tools.execute(slug, { userId: accounts.id, arguments })`, `connectedAccounts.link(userId, authConfigId, { callbackUrl })` for OAuth) and `FakeSplitwise`. `splitwiseClient()` returns the fake when `SPLITWISE_FAKE=1` (tests inject one with `setSplitwiseClient`); dev-chat switches to the fake by itself when `COMPOSIO_API_KEY` is missing or rejected and says so once. A 401 / missing key / no connection is `SplitwiseNotConnectedError` ("Splitwise isn't connected yet"), relayed as text, never a crash; Settings shows the card disabled with the reason. Import maps people by email, then name, else adds them as Pending; owed_share -> exact Shares, paid_share -> Payers, payments -> Settlements, refs dedupe per Group. Export is a one-time copy of what has no ref; the live mirror queues `outbox_jobs` that the scheduler pushes (create/update/delete by ref, retried with backoff).

## Groceries (step 6)

- **A Recipe never touches the Cart by itself** (plan Q7). `recipe_draft` writes and saves one (servings default to the active Members), returns ready-to-post text (need / have, step count) and an `askToAdd` question; only `recipe_add_to_cart` (someone asked, or clearly meant it) puts ingredients in, minus the Pantry and `skip` ("we have onions"), minus what's already open from that Recipe or shared, as shared items with `recipe_id`.
- **Recipe JSON** comes from `RECIPE_MODEL ?? LLM_MODEL` on `/v1/chat/completions` (no `temperature`). zod validates it; units must map to Instacart's list (`lib/units.ts`), else one retry with the error as feedback, then unknown units become `each`. A recipe written for the wrong number of people is scaled in code (countable units round up). `RECIPE_FAKE=1` / `setRecipeWriter()` skip the model.
- **Pantry** lives in `group_toolkits.settings.pantry` (groceries), names normalized. Matching is word-based with the last word as the thing itself: "oil" covers "olive oil", "rice" doesn't cover "rice vinegar".
- **Estimates** stay in `lib/prices.ts` (catalog, $4.99 default); Recipe ingredients use `estimateMeasured` (countable units count up to 6 store items, weights and volumes are one). The model never prices anything.
- **Checkout** (`cart_checkout`, "Get Instacart link"): snapshots the open Cart into `cart_checkouts`, builds an Instacart shopping list (structured `quantity`/`unit`, else parsed from `qty`), returns an "Open in Instacart" button. The same open items reuse the last unpaid Checkout. If Instacart can't be reached the Checkout is still saved with a null url and Roomie says the link isn't available yet.
- **"I paid $84"** is `cart_purchased` (persona: not `log_expense`). `markPurchased` flips the open items (or a Checkout's) to purchased in a transaction, then `logExpense` with `method: "exact"`, `category: "groceries"` and `computeCartSplits` rows (personal to the adder, shared evenly, weighted by estimates, payer-first remainder); the newest unpaid Checkout it covers gets `expense_id` + `paid_at`. The drawer previews with the same function and the active Members in `listMembers` order, so it matches to the cent.
- **Instacart** (ADR 0004): `InstacartClient` with `ComposioInstacart` (`tools.execute("INSTACART_CREATE_SHOPPING_LIST_PAGE" | "INSTACART_CREATE_RECIPE_PAGE", { userId: "roomie-app", arguments })`, Instacart IDP body shapes, `products_link_url` found at any depth) and `FakeInstacart` (deterministic `https://instacart.example/...`). Instacart is a "no auth" Composio toolkit: no auth config, no connection, only `COMPOSIO_API_KEY`. `INSTACART_FAKE=1` / `setInstacartClient()` pick the fake; dev-chat switches by itself when the key is missing or rejected; failures are `InstacartUnavailableError`, relayed as text. The dashboard button is enabled only for the real client with a healthy key. Recipe links are cached on the Recipe by `recipeKey` (title, servings, ingredients).

## Chores, upkeep and reminders (step 7)

- **Time zones:** every "today", "tonight", "Tuesday 8pm", "this week", due day, nudge hour and report window is computed in `groups.timezone` with `lib/time.ts`. Never `new Date().getDay()`/`toISOString().slice(0,10)` for a Group's day. The agent's instructions carry the local now (`describeNow`); tools take local wall-clock without an offset (`parseInZone`: an offset is honoured, a bare `2026-11-03T20:00` is the Group's zone, a bare date is 9:00). `validateSettings` maps what people say ("Chicago", "CST", "India", any IANA city) with `resolveTimeZone`; unknown -> "Which city are you in?". Test DST with America/Chicago Nov 1 2026, Europe/Berlin Oct 25 2026 and Asia/Kolkata.
- **Rotation:** `chores.rotation` (member ids in order, null = everyone). With one, the turn is the Member after whoever last did or passed it (inactive ids drop out; an empty result falls back to everyone); without one, whoever did or passed it least recently (never first, ties by name). A pass is a `chore_logs` row with `skipped`: it moves the turn, isn't a done (no streak, the chore stays due). Only whoever's turn it is can pass (`not-yours`). Logging for another active Member is fine; the Activity row says "for Dev".
- **Due and streaks:** a chore is due on (last done's local day + everyDays), never done = due today; `state` is overdue / due / ok. A Streak counts a Member's own consecutive on-time dones on that chore (on time = no later than the previous done's day + everyDays); a pass or a late done ends it. Upkeep: never done = due today (due soon, not overdue), due soon = within 7 days.
- **Reminders:** `memberId` null = the whole Group (posted with `deliver`), set = that Member privately (`deliverPrivate`), never both; if Roomie can't DM them yet it goes to the Chat once, addressed to them, with the Start hint. `created_by` gives "(set by Maya)" when set for someone else. Repeats (daily / weekly / monthly, monthly clamped to day 28) keep the local wall-clock and skip missed occurrences. The scheduler claims a reminder (sets `sent_at`) before sending and releases it on failure. Lists show only what the viewer may see (`visibleTo`); cancel = the target, the setter, anyone for a whole-group one, or an Admin.
- **Posts Roomie makes on its own (ADR 0001):** the chores nudge at `group_toolkits["chores"].settings.nudgeHour` (default 9, null = off), only when something is due or late; the weekly Group Report at `group_toolkits["core"].settings.report = { weekday, hour }` (default Sunday 18). Both are claimed in `scheduled_posts (group, kind, local period)` before sending, so at most one per day / week across restarts and processes; a failed send gives the claim back. Upkeep has no post of its own: it's a line in the report. The window is the whole hour; a scheduler that was off for it skips that day rather than posting late.
- **The Group Report** is one message of at most ~12 lines (`reportParts`): Settle plan, chores this week (counts, the best streak, what's up now, the chart), upkeep due soon, the Cart's size, the next week's whole-group reminders. Sections of switched-off Toolkits are left out. Emoji-led lines by default; when the Group style note's tone is casual (`isCasualStyle`) the same sentences run together without the list look. `group_report` returns the same text (`groupReportText`) and Roomie posts it verbatim.
- **Onboarding** for roommates and families adds the three starter chores (no Rotation, so new people join in) and the usual five upkeep items, once, and only for Toolkits that are on. Family now also gets Upkeep.
- **First contact** (`channels/text.ts`, shared by both adapters): `/help` (group or DM) is five lines (`helpText`), `/start` in a DM is one line and never a link (on WhatsApp nobody needs either; they work when typed, and other text starting with "/" goes through as text there), on Telegram other slash commands are ignored, a failure while Roomie was addressed gets one friendly line (`OOPS`) and the stack goes to the log. `npm run telegram` prints a `[roomie]` line per message (gate, tools, time, trace id) and per reply.

## Personality (the group pet)

[docs/personality.md](docs/personality.md), [ADR 0012](docs/adr/0012-personality-archetype-sliders-learned-style.md). Personality = archetype (chill default, hype, deadpan, mom, gremlin, butler) + what an Admin sets (name, up to 3 quirks, languages, emoji / humor / formality sliders) + the Learned style, all in `groups.personality` (read it through `normalizePersonality`; `{}` is chill "Roomie").

- **Instructions are composed in code** (`mastra/persona.ts`), never one free-text prompt: core rules (facts from tools, no math, brevity) first, then the voice, sliders as sentences, quirks, learned style, `/* TOOLKIT_PERSONA */` (enabled manifests' optional `persona: string`), mood, what Roomie knows about people. Jokes are a trait, not a Toolkit.
- **Adaptation is bounded by code:** confidence comes from messages seen (`confidenceFor`); below 0.3 no slang, 0.3-0.6 one phrase per 5 replies (checked against Roomie's last 4 chat lines), above 0.6 free but never more than the group; nicknames only after 3 sightings by others. Counts come from the messages (`lib/style-stats.ts`); the model only proposes candidates. Change the rules there, with a test.
- **Say-once behaviours** claim a `pet_moments` row (group, kind, key): the day's greeting (not when quiet, not after Roomie already posted that day, one line, no link) and win cheers (square after a Settlement, chore streak 3/7/30, a Checkout), appended as one short line in the archetype's voice. `/pet` (and "pet roomie") is a hard trigger with a 1-2 line in-character reply.
- **Mood** (`groupMood`): worried if anyone owes > $100, sleepy after 5 quiet days, happy when everyone's square, calm otherwise; the Home dino and one line of the instructions.
- **Member facts** (`remember`, `what_do_you_know_about_me`) live in `member_notes.note` next to the handles; only your own, or an Admin for anyone; "forget me" wipes them.
- Evals: the runner claims the day's greeting for every scenario except `greet: true` ones, so a hello doesn't change other replies.

## The Gate (when Roomie speaks)

`mastra/gate/policy.ts`, ADR 0002. In order: hard trigger (voice note, reply to Roomie, @mention, the word "roomie", the dashboard) always speaks; Jev error or > 2.5 s means hard triggers only; p(act) over the Group's threshold acts; in the follow-up window (3 min / 3 messages after Roomie spoke) the agent decides with permission to answer `[silent]`, unless Jev is sure it's chatter; p(clarify) over its threshold asks. Thresholds (act / clarify): quiet .9/.8, **normal .75/.6** (default), chatty .6/.45. If nobody addressed Roomie and it's not a follow-up, the agent is told to ask before logging anything. Jev's toolkit narrows the agent's tools only at p ≥ 0.6, and Jev is only offered the Group's enabled Toolkits (plus `core`: reminders, members, settings, what Roomie can do; and `none`). While Onboarding is open (`groups.onboarded_at` null), an active Member's message in the follow-up window counts as a hard trigger, so "roommates, USD, Chicago" reaches `set_group_settings`.

## Conventions

- Money is **integer cents** everywhere in services and the DB. Tools accept dollars from the model and convert with `toCents()`. The LLM never does math: balances, splits and totals come from services ([ADR 0007](docs/adr/0007-money-is-integer-cents-computed-in-code.md)).
- Every service takes `ctx: Ctx` first. `ctx.memberId` is the sender in chat or the signed-in Member on the dashboard; use it as the default payer/doer/adder. Group-level reads take `GroupCtx`.
- Tools resolve names to ids with `memberIdByName()` and throw a helpful error on unknown names (the model then asks). Money tools return amounts as ready-to-say strings ("$22.50", `expenseSummary`), so the model never formats cents.
- Tools get the Group and sender from `ctxOf(context)` (the RequestContext), never from closures.
- Tools attach buttons by returning `links: [{ text, url }]` (see `cart_add` / `dashboardLinks()`); the pipeline collects them from every tool result into `Outgoing.buttons`. Never paste URLs. Buttons need an absolute `APP_URL`.
- A new Toolkit = a folder with `manifest.ts` + `server.ts` + tools, one line in `toolkits/manifests.ts` and one in `toolkits/registry.ts` (docs/toolkits.md has the checklist). Its Gate criterion, persona lines, nav tab, Home and Settings sections come from the manifest; never add them to the shell, `gate/jev.ts` or the persona.
- The Toolkits page (`/g/<id>/toolkits`) is the one place Toolkits are switched in the UI; Settings only summarizes and links there. In UI text it's "Toolkits", not a store or marketplace (Roomie is a groupmate).
- Dashboard pattern: a page (server) calls `currentMember(groupId)`, reads services through `_components/data.ts` and renders a client screen; writes are server actions in `g/[groupId]/actions.ts` that call a service with the session's Ctx and `revalidatePath`. They return `{ ok, error, status }`, so screens toast errors. Coming-soon Toolkits (Research, PDFs, Trips, Stickers, Household admin) are manifest-only stubs: listed on the Toolkits page and refused kindly.
- Schema changes: edit `src/db/schema.ts`, `npm run db:generate`, commit the SQL in `drizzle/`, `npm run db:migrate`. Never `drizzle-kit push`.
- Roomie's replies are 1 to 3 short lines unless someone asks for more (the archetype can make that 1). The trigger words are "roomie" and the Group's name for its pet (`callsPet`); the @mention always works.
- Use the glossary's words in code and UI text (Member, Group, Expense, Cart...), and avoid the words it lists under _Avoid_.
## Library notes (versions in package-lock)

- **Mastra v1** (docs in `node_modules/@mastra/core/dist/docs/`, and https://mastra.ai/llms.txt): `createTool({ id, description, inputSchema, execute: async (input, context) => ... })`; `context.requestContext` carries the Group and Member. Agent options (`instructions`, `tools`, ...) can be functions of `{ requestContext }`. Call it as `mastra.getAgentById("roomie").generate(text, { requestContext, memory: { thread, resource } })`. Results use chunk format: `step.toolCalls[i].payload.toolName`.
- **LLM:** Neon AI Gateway through Mastra's model router: `model = "neon/<id>"` in `lib/llm.ts`, which reads `NEON_AI_GATEWAY_BASE_URL` + `NEON_AI_GATEWAY_TOKEN`. Use ids from the branch's `/v1/models`. Embeddings go to `{base}/v1/embeddings` through `ModelRouterEmbeddingModel` with an explicit url (`gatewayEmbedder()`).
- **Jev** is not a chat model: `POST {base}/typesafe/v1/systemone` with typed questions (`gate/jev.ts`). The gateway rate limit (input tokens per minute, account-wide) also covers Jev; on a 429 the Gate falls back to hard triggers.
- **Env:** `.env` must win over the process environment, but Node's `--env-file` and Next never override. `lib/env.ts` loads it with `dotenv({ override: true })`; import it first in every entry point. `mastra dev` tree-shakes side-effect-only imports, so bundled code must call `loadEnv()` (`lib/llm.ts` and `mastra/index.ts` do). **If you see 401 from the gateway, a system env var (e.g. a stale `NEON_AI_GATEWAY_BASE_URL`) is shadowing `.env`.**
- **Observability:** traces go to Postgres (`mastra_ai_spans`, visible in Studio) and to the Mastra platform when `MASTRA_PLATFORM_ACCESS_TOKEN` + `MASTRA_PROJECT_ID` are set. API routes call `mastra.observability.flush()` at the end.
- **Voice:** no Whisper on the gateway. `lib/voice.ts` sends the audio to OpenRouter (`OPENROUTER_API_KEY`, `STT_MODEL`, an audio-capable chat model) as an `input_audio` chat part and uses the text reply as the transcript. Optional; the Telegram adapter uses it for voice notes when `OPENROUTER_API_KEY` is set (otherwise Roomie says once per Chat that it can't hear them yet).
- **grammY** (Telegram, `grammy` in `serverExternalPackages`): `new Bot(token, { botInfo })` skips getMe (the webhook builds botInfo from the token's id + `TELEGRAM_BOT_USERNAME`; tests do the same with a fake token). Polling: `bot.start({ allowed_updates, onStart })`; webhook: `webhookCallback(bot, "std/http", { secretToken })`. Outbound calls are captured in tests with `bot.api.config.use(transformer)`; `handleUpdate` + the adapter's `idle()` runs an update to the end. `my_chat_member` (Roomie added/removed) arrives without admin rights; `chat_member` doesn't, so we don't use it. Privacy mode must be off (BotFather `/setprivacy`) to see every group message. Groups upgraded to supergroups change id (`migrate_to_chat_id` -> `groups.moveChat`). Telegram refuses `localhost` URL buttons: the adapter sends those links as text.
- **Baileys** (WhatsApp, `baileys` pinned at `7.0.0-rc14`, in `serverExternalPackages`; docs/whatsapp.md, ADR 0013): `makeWASocket({ version: fetchLatestBaileysVersion(), auth: { creds, keys: makeCacheableSignalKeyStore(keys) }, markOnlineOnConnect: false, syncFullHistory: false, getMessage, cachedGroupMetadata })`. Don't set `shouldSyncHistoryMessage: () => false`: Baileys warns it loses its initial LID mappings. Only `messages.upsert` type `notify` is live; joins arrive as `group-participants.update` (`add` with us in `participants`, `author`/`authorPn` = the adder) or `groups.upsert` (added at creation); participants are `{ id, phoneNumber?, lid? }`; messages carry `key.participantAlt` / `key.remoteJidAlt` (the other form of the sender's id); `sock.signalRepository.lidMapping.getPNForLID(lid)`. Close codes: 401 `loggedOut` (clear, wait for login), 440 `connectionReplaced` (another process: stop), 515 `restartRequired` (right after pairing: reconnect at once), 408 while showing a QR (nobody scanned: stop). `requestPairingCode(digits)` only after the first `qr` event. Tests drive `createWhatsApp` with a fake socket and an in-memory `AuthRows`. One process per session.
- **Env (pacing):** `JOIN_DELAY_MS` (intro after joining, default 60000) and `REPLY_DELAY_MS` (pause after "typing", default 600-1800 ms random on Telegram, 1200-3200 ms on WhatsApp); tests pass 0.
- **Env (WhatsApp, operators):** `WHATSAPP_ENABLED=1` (this process holds the socket), `WA_LOG` (Baileys' log level, default warn), `ROOMIE_OPERATOR_EMAILS` (comma-separated; `/admin/*` is a 404 for anyone else, signed out included: operators sign in at `/signin?next=/admin/beta`; the first address also gets the beta-request DMs on Telegram).
- **Neon Auth** (Managed Better Auth, `@neondatabase/auth`): `lib/auth/server.ts` = `createNeonAuth({ baseUrl, cookies: { secret, sameSite: "lax" } })` (the default `strict` drops the challenge cookie on the cross-site return from Google, so sign-in silently loops); `app/api/auth/[...path]` = `auth.handler()`; browser `createAuthClient()` (no args). The sign-in flow: `GoogleButton` calls `signIn.social({ provider: "google", callbackURL: <origin>/auth/callback?next=<path> })`; `/api/auth/sign-in/social` sets the `session_challenge` cookie; after Google, Neon Auth redirects to the callbackURL with `neon_auth_session_verifier=…` (or `error=…`); `app/auth/callback` (`lib/auth/oauth-return.ts`) exchanges verifier + challenge for the session cookies via `get-session` and 303s to `next`, or to `next?auth_error=<reason>`, which `/signin` and `/claim` show as "Sign-in didn't complete" (`authErrorFrom`; `/` forwards a stray `auth_error` to `/signin`). A missing or off-site `next` is `/signin`. Logs `[auth] oauth return ok|failed: <reason>`; the response carries `x-roomie-auth`. `src/proxy.ts` is the only middleware file (Next loads it from `src/`; a root `proxy.ts` is silently ignored): `auth.middleware({ loginUrl: "/signin" })` guards `/g/*` (its redirect is rewritten to `/signin?next=<path>`; `/signin`'s Google button returns to `/signin?next=…`, which continues to `next` once signed in), and a verifier landing on `/`, `/signin`, `/claim/*` or `/admin/*` is bounced to `/auth/callback` (the SDK middleware never exchanges on its own loginUrl, and must not run on the pages signed-out visitors see). Header `x-roomie-proxy: guard|pass|oauth-return`. Behind Fly, `request.url` is `https://localhost:3000`: never build redirects from it (use relative Locations). Tests: `app/auth/callback/route.test.ts` (fake Neon Auth server). Email+password sign-up is also enabled on the dev Auth branch (Neon's default; the app has no UI for it). `auth.getSession()` returns `{ data }`, user is `data.user`. Users live in `neon_auth` (Neon owns it; never write there). Dev Google uses Neon's shared OAuth keys.
- **Composio** (`@composio/core`, TS SDK v3): `new Composio({ apiKey })`; direct execution (`tools.execute`) needs a toolkit version, so we pass `COMPOSIO_SPLITWISE_VERSION` or `dangerouslySkipVersionCheck`. `connectedAccounts.initiate` is retired for Composio-managed OAuth; use `connectedAccounts.link`. The Splitwise auth config comes from `COMPOSIO_SPLITWISE_AUTH_CONFIG_ID`, else the first Composio-managed one, else one is created (`authConfigs.create("splitwise", { type: "use_composio_managed_auth" })`) and its id logged for `.env`.
- **Next 16:** Mastra, pg, Composio, grammY and Baileys are in `serverExternalPackages`. Read `node_modules/next/dist/docs/` before using Next APIs.

## Commands

```
npm ci
cp .env.example .env          # DATABASE_URL, NEON_AI_GATEWAY_BASE_URL/TOKEN, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET
npm run db:migrate            # apply drizzle/ (the 0000 baseline wipes pre-step-4 dev data)
npm run seed                  # demo Group Apt 4B; prints its id, a Claim link for Maya and a Studio requestContext
npm run seed:demo             # delete and rebuild Apt 4B
npm run dev                   # dashboard at localhost:3000 (scheduler runs here too; DISABLE_SCHEDULER=1 to skip)
npm run dev-chat              # terminal group chat through the real pipeline (docs/dev-chat.md)
npm run telegram              # Roomie on Telegram, long polling (TELEGRAM_BOT_TOKEN/_USERNAME; docs/telegram.md)
npm run telegram:webhook -- --set|--delete|--info   # webhook at <APP_URL>/api/telegram (public https only)
npm run telegram:check        # read-only readiness check before a real group (docs/first-group-test.md)
npm run whatsapp              # Roomie on WhatsApp from this terminal (QR here; -- --pair <digits> for a code; docs/whatsapp.md)
                              # one process per session: WHATSAPP_ENABLED=0 on Fly first. On PowerShell: npx tsx scripts/whatsapp.ts --pair ...
npm run mastra:dev            # Mastra Studio at localhost:4111, with request-context presets for Apt 4B's Members
npm run db:generate           # after a schema change: write the next migration
npm run typecheck && npm test # tsc + unit tests (no .env); CI runs both
npm run test:tools            # every tool against the dev DB in throwaway Groups (Splitwise, Instacart, recipes on fakes), no LLM
npm run evals                 # ~65 chat scenarios through the real Gate + Sonnet; prints a table and the pass rate
                              # (npx tsx scripts/evals.ts --only id,id   or   --baseline to rewrite docs/evals-baseline.md)
```

Adding deps: `npx -y npm@11 install <pkg>` (npm 10 trips on this lockfile; `npm ci` is fine).

## Before you commit

`npm run typecheck` and `npm test` must pass. Test a service with a `*.test.ts` before wiring its tool or page. Each plan step gets its own branch and PR.
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
