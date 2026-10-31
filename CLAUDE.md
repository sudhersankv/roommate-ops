# Roomie

Roomie is the roommate who actually keeps track: it lives in an apartment's group chat (and on a per-group dashboard) and handles rent, splits, groceries, chores and the landlord's emails. One Roomie, one voice, not renameable; it quietly picks up how the group talks (ADR 0020). Always brief and exact about facts. Roommates are who it's built for (ADR 0015); other groups work as a footnote. Nothing a person reads says AI, bot, brain, assistant or smart.

**Direction in progress (ADRs 0015-0020, GitHub issues labelled `ready-for-agent`):** five buckets — core (Gate, memory, Reminders, the morning Bundle, polls, DMs, Documents) and the Tricks Money, Groceries, House (Chores + Upkeep) and Lease Inbox. The "Personality" section and the vibe picker described below are being removed; read the ADRs before touching them.

**Read first:** the rebuild plan is in `docs/plan.md`, the vocabulary in `GLOSSARY.md`, and the decisions in `docs/adr/`. They are the spec; where they conflict with this file, they win. Steps 1 (rename), 2 (WhatsApp, waiting for its live test), 2b (Telegram), 3 (Mastra agent), 4 (identity, Groups, dashboard), 5 (Splitting), 6 (Groceries) and 7 (Chores, Upkeep, reminders, Group time zones) are done, plus the public landing page with the WhatsApp beta form (`docs/landing.md`); the code below is what exists today. Before a real Telegram group: `npm run telegram:check`, then `docs/first-group-test.md`; WhatsApp: `docs/whatsapp.md` (link the number at `/admin/whatsapp`). `npm run dev-chat` simulates a group chat without any app.

Agent skills for this repo live in `.agents/skills/`.

## The one rule

**All business logic lives in `src/services/`.** The agent's tools (`src/toolkits/*/`) and the dashboard (`src/app/`) are thin front doors that call the same service functions. Anything you can do in chat must be doable in the UI, and vice versa. Never put logic in a tool or a page that belongs in a service. Permissions are business logic too: they live in services, never in prompts or pages alone.

**The manifest is the Toolkit contract** ([ADR 0011](docs/adr/0011-manifest-is-the-toolkit-contract.md), [docs/toolkits.md](docs/toolkits.md)). The agent's tools and persona, the Gate's toolkit choices, the dock and its More drawer, Home, Settings and the Tricks page are built from the Group's enabled manifests. Never name a Toolkit in the shell, the Gate or the persona: put it in its manifest.

**People see Tricks, never Toolkits.** In every string a person reads (chat replies and tool results Roomie relays, the intro, `/help`, `/start`, the dashboard, Settings) a Toolkit is a **Trick**; switching one on is **teaching** Roomie ("roomie, learn trips"), off is **forgetting** it. Never "toolkit / capability / module / plugin / feature / enable" there. Code keeps "toolkit" (ids, folders, `toggle_toolkit`, the `/toolkits` route, which also answers at `/tricks`). "Pet" appears in at most two places in the app (`/pet`, the Personality subtitle), and nothing user-facing says Roomie adapts to how the group talks.

## Layout

```
src/
  db/schema.ts          Drizzle tables: groups, chats, accounts, members, claim_tokens, group_toolkits, chat_messages,
                        member_notes, activity, pet_moments + the Toolkit tables (expenses, expense_payers, expense_splits,
                        settlements, splitwise_links, expense/settlement_external_refs, outbox_jobs, pending_amounts (a
                        variable bill's month, migration 0018), recipes, cart_items,
                        cart_checkouts, chores,
                        chore_logs, reminders, maintenance), all keyed by group_id; wa_sessions (the WhatsApp login,
                        BufferJSON rows "creds" / "<type>-<id>") and wa_contacts (LID -> phone JID + name); beta_requests
                        (the landing page's WhatsApp beta form, not tied to a Group); trick_votes ("I want this" on a
                        coming-soon Trick, migration 0008); rate_counters (fixed-window cap counts) and groups.paused_at
                        (migration 0009); groups.join_code / join_code_rotated_at / join_policy, chats.participant_count
                        (+ _at) and members.wants_seat_id (Join links, migration 0011); documents (a Group's files: kind,
                        title, storage_key in the BlobStore, source, uploaded_by, filed_at null = an unkept chat photo),
                        expenses.receipt_document_id and pending_posts (urgent posts / DMs held through quiet hours) and
                        scheduled_posts kind "bundle" (was "chores.nudge"), migration 0015; polls (secret = WhatsApp's
                        messageSecret), poll_votes and dm_context (#24B, migration 0016); 0019 nulls pre-Documents
                        /uploads receipt_url values (hand-written, idempotent); the Lease Inbox's group_inboxes,
                        mail_events, mail_messages, landlord_senders, work_orders, sent_mail (migration 0022) and
                        documents.text (a lease or notice's text, migration 0023); mail_events.processed_at,
                        mail_messages.reply_to and the purchase_events_once unique index (migration 0024)
  db/enums.ts           categories, split methods, recurrences, sources, Group purposes, beta sizes / statuses (no drizzle
                        import: client code uses them)
  db/index.ts           db client
  services/             (ctx: Ctx, input) => result. Source of truth. index.ts re-exports as namespaces.
    types.ts            Ctx { groupId, memberId, source }, GroupCtx { groupId }, dollars()
    authz.ts            NotAllowedError, requireActive / requireAdmin (load the Member from the DB), canChangeExpense
    groups.ts           settings (validateSettings, defaultToolkitsFor = the purpose preset), listToolkits (no row =
                        defaultOn), delete group data; Onboarding's preset runs the Toolkits' onEnable hooks (the
                        starter chores and Pantry are theirs, Onboarding names no Toolkit)
    toolkits.ts         setToolkit (Admins; by id or name; coming soon / unmet requires refused, and a Toolkit another
                        enabled one requires can't go off; hooks once per change; a dashboard switch-on posts ONE line
                        in the Chat, 10 min cooldown), catalogFor, checkRequirements, enabledToolkitEntries (the
                        enabled server entries in post order, lazy), byPostOrder
    members.ts          list (active / active+pending), approve, decline, promote, payment handles, forgetMe, Member
                        facts (rememberAboutMe, knownAbout: your own or an Admin, peopleFacts for the instructions),
                        rekeyChannelUser (WhatsApp LID -> phone JID), fillPlaceholderName
    claims.ts           Claim links: issueDashboardLink, createClaimToken, consumeClaim, upsertAccount
    joins.ts            Join links (ADR 0014, docs/joining.md): ensureJoinCode / joinLink / joinLine, rotateJoinCode,
                        setJoinPolicy (Admins), rosterSize (chats.participant_count, dev = active Members, refreshed from
                        Channel.participantCount), pickerFor, claimSeat (free seat -> connected, else Pending wanting the
                        seat + one chat ask; 10/h per IP and Account), seatStates, revokeSeat, reassignSeat, groupsListFor
    activity.ts         record(..., source) + listActivity(): who added, changed or deleted what, and where (chat |
                        dashboard: sourceOf(ctx), migration 0010); recentChanges / changesSinceRoomieSpoke (<= 8 lines)
    chatlog.ts          chat_messages: log, recent chatter, follow-up window facts, retention delete
    split.ts            pure split math (no DB import, so the drawer previews with it): splitEvenly, splitExact,
                        splitPercent, splitShares, checkPayers, apportion (largest remainder), computeShares
    money.ts            Expenses (logExpense/updateExpense take intent: method + splitAmong|splits|percents|shares,
                        payers, category, note, occurredOn, recurring), delete/restore, Balances (from expense_payers),
                        getSettlePlan (simplified or pairwiseDebts per groups.simplify_debts), settleUp, debtBetween,
                        expenseSummary (ready-to-say), settleReportParts (Money's report section)
    categories.ts       guessCategory (fallback when nobody picked one)
    recurring.ts        latestOccurrence + runRecurring; variable bills: variableAsk, setVariableExpense, answerAmount,
                        prefillAmount (#25)
    rent.ts             the rent (#25): getRent / setRent, rentWindows, rentBundleLine, rentDms / rentDmJob, the offer
    settle-nudge.ts     the weekly private Settle nudge: nudgeCandidates (pure), settleNudgeJob, get/updateNudgeSettings
    receipts.ts         photo -> parsed receipt (vision on the gateway, sums recomputed), receiptSplits, saveUpload (an
                        unfiled photo Document; folder "tg/<chat>" / "wa/<user>" / "g-<id>" or { groupId } -> /api/docs/<id>),
                        askVision (the one vision call), imageDataUrl (our Documents from the blob store)
    documents.ts        Documents (ADR 0018): fileDocument (row + blob "g/<groupId>/<id>"), list / findDocuments (title or
                        kind, newest first), readDocument (active Members), keepDocument ("roomie keep this"), attachReceipt
                        (one Expense per receipt: attaching it elsewhere moves it; a re-sent deleted photo comes back),
                        deleteDocument (uploader or Admin), documentsView (the Docs tab's data), forget me (deleteMemberPhotos,
                        anonymizeUploader, deleteUnfiledByUrl), deleteGroupDocuments, purgeOldDocuments (unkept, 30 days)
    urgent.ts           the urgent slot: postUrgent (one a day, "urgent" claim, held to 08:00 in quiet hours, nothing when
                        paused; a failed queue write gives the claim back), flushPendingPosts (scheduler: claim-by-delete,
                        put back on failure until a day old, a refused DM becomes postStartHint), nudgesOff
    nudges.ts           sendNudge(memberId, out, now): a private nudge; skipped when member_notes.note.nudges = "off",
                        held to 08:00 in quiet hours
    grocery-photos.ts   a recipe / list / shelf photo -> items as written (readGroceryPhoto, cached per url;
                        setPhotoReader for tests), addPhotoToCart (a recipe is saved first), photoSummary
    splitwise.ts        connect / import / export / live mirror (ADR 0004) + runSplitwiseOutbox
    outbox.ts           outbox_jobs: enqueue, due, done/failed with backoff (ADR 0009)
    cart.ts             Cart items (recipe_id, quantity + unit next to the free-text qty, no prices), addAsSaid (ambiguous
                        quantities -> needsClarification), removal (adder or Admin), checkout (snapshot -> Instacart
                        shopping list -> cart_checkouts), markPurchased (exact Expense), cartReportParts; every change
                        is an Activity row
    cart-split.ts       pure: computeCartSplits (one share per item), canRemoveItem (the "I paid" drawer previews with it)
    recipes.ts          draftRecipe / writeRecipe (Sonnet, strict JSON, one retry), save/list/get, addRecipeToCart,
                        recipeLink (cached by recipeKey), upcomingRecipes
    recipe-math.ts      pure: Pantry matching (covers, haveNeed), scaleIngredients, recipeKey
    pantry.ts           group_toolkits.settings.pantry for groceries: getPantry, updatePantry (any active Member)
    chores.ts           the chart: Rotation (turnFor), passes (skipChore), local due days (choreSchedule), streaks per
                        Member (streaksFor), add (any active Member) / remove (Admin), hallOfShame + chartLine, addStarterChores
    upkeep.ts           upkeep items in local days (upkeepSchedule: due soon = 7 days), markDone, remove (Admin),
                        DEFAULT_ITEMS / addDefaults ("the usual five")
    house.ts            the House Trick as one thing: houseBundleLine (the chores nudge, choresNudgeText), houseReportParts
                        (choresReportParts + upkeepReportParts), startHouse (its onEnable: starter chores + the usual five, once)
    reminders.ts        one-off / daily / weekly / monthly (nextOccurrence keeps the wall-clock across DST), whole Group
                        or one Member (private), reminderLine ("(set by Maya)"), visibleTo / canCancel, claim before send
    polls.ts            Polls (ADR 0018): askPoll (sends through the Group's Channel, stores the row with the sent id +
                        secret), recordVote / voteOnPoll (upsert, empty = retracted), resolvePoll once (majority |
                        expired | closed; "who-in" -> logExpense among those in, one line), closePollsFor (the asker's
                        text wins), expirePolls (scheduler), openTextPoll, pollSecret; poll-rules.ts = the pure rules
                        (pollMajority = floor(n/2)+1, pollOutcome, whoIn, numberVote)
    dm.ts               DMs (ADR 0020): noteDmContext, resolveDmGroup (prefix -> nudge 24 h -> last DM'd -> only Group ->
                        ask once, the held message runs on the answer), echoAfterPrivateRun (the Echo rule from the
                        run's Activity rows), nudgeOrHint (no DM path: one neutral line per Member per 7 days,
                        postStartHint alone for a held DM);
                        dm-rules.ts = the pure rules (pickDmGroup, groupPrefix, afterPrivateRun, startHint)
    lease-inbox.ts      the Lease Inbox core (ADR 0016, #27): ensureInbox, releaseGroupInbox (best-effort, for deletions),
                        landlord trust (addresses / domains; askedSender), claimMailEvent / finishMailEvent (received ->
                        processed; unprocessed for 10 min = taken again), storeInbound (once per message id; reply_to),
                        classifyInbound + InboundHooks, work orders (advanceWorkOrder, workOrderStatus: pickWorkOrder or
                        { choices }), sendToLandlord (trusted threads only, the send rule, held sends + SendApproval, the
                        signature, sent_mail), reportIssue, sendIntro;
                        pure: send-rule.ts (sendRule, signature), lease-inbox-rules.ts (nextStatus, isUrgent, the Bundle /
                        report lines, saysYes, topicWords / pickWorkOrder, attachmentKind), lib/forwarded.ts (parseForwarded)
    lease-inbox-inbound.ts  the webhook's event (parseMailEvent, pure) -> handleMailEvent -> processInbound: store, file the
                        attachments as Documents, classify with every hook wired (Reminder, urgent, Admin DMs, rent proposal,
                        utility prefill, intro offer), the one line (postLine: paused nothing, quiet hours held as "line")
    lease-inbox-toolkit.ts  the Trick around the core: startLeaseInbox (onEnable), connectLine, inboxStatus, releaseInbox,
                        trustAsked / removeSender (Admin), sendForMember (the thread from `about`), workOrderLine, the
                        Bundle / report lines, inboxData (the Inbox page), anonymizeMailMember (forget me)
    mail-classifier.ts  SMALL_MODEL on the gateway, JSON in text, zod, one retry, then `other` (keywordClassifier with
                        MAIL_CLASSIFIER_FAKE=1); lease-text.ts: a Document's text (textUrl / vision) and askLease (cites the clause)
    report.ts           groupReport (the enabled Toolkits' report() parts in post order + core's Reminders line, naming no
                        Toolkit) + composeReport / formatGroupReport (one message; casual = sentences), dueWord, joinNames
    bundle.ts           the morning Bundle (ADR 0017): groupBundle = the enabled Toolkits' bundle() lines in post order,
                        then core's coreBundleLine (whole-group Reminders due today); composeBundle (pure; no lines = no post)
    schedule.ts         groupTimezone, the nudge hour (on House's group_toolkits row) and report day/hour (getSchedule /
                        updateSchedule, Admin), the pure windows (bundleWindow, weeklyReportWindow), claimPost /
                        releasePost on scheduled_posts
    personality.ts      groups.personality: getPersonality, updatePersonality (Admin), saveLearned (style job), resetLearned
                        (Admin), groupMood (worried / sleepy / happy / calm), allSquare
    pet.ts              say-once pet moments on pet_moments (MomentStore): dayGreeting, claimWins
    beta.ts             Beta requests (docs/landing.md): submitBetaRequest (honeypot, zod, 3 per IP-hash per hour, store,
                        then notifyOperator: Telegram DM to the first ROOMIE_OPERATOR_EMAILS Account's Telegram Member, else
                        a "[beta]" log line); list / setBetaStatus / delete take the operator (NotAllowedError otherwise)
    trick-votes.ts      voteForTrick (coming-soon ids only, 1 per Trick per IP-hash a day, 12 an hour) + trickVoteCounts
    operator-groups.ts  /admin/groups (operators only): listGroupsForOperator (members, last message, runs today),
                        setGroupPaused, leaveGroupChat (Channel.leaveChat + pause), pausedGroupIds (the scheduler skips them)
    whatsapp-access.ts  the WhatsApp beta allowlist: WHATSAPP_ALLOWED_ADDERS + onboarded beta_requests.phone; whatsappAdmission
                        (empty list = anyone, as before)
  onboarding.ts         onGroupJoined (Group + Chat + Members + Join code, adder = Admin, intro + setup questions, and the
                        Admin's setupDm: their Claim link + "Answer the setup here or in the group"; setupDmFor for /start),
                        onParticipantJoined (Pending + "approve X?") and onUnknownSender (Pending, or active inside a
                        Channel's roster grace, ADR 0010). Called by Channel adapters (ADR 0008)
  pipeline.ts           the message flow, channel-agnostic: handleIncoming(msg) resolves Group/Member itself (unknown
                        Chat -> Onboarding, unknown sender -> onUnknownSender), logs the line, runs the Gate, calls the
                        agent, collects links. isPrivate (a Member's DM): addressed, not logged. askRoomie(ctx, text)
                        for the dashboard (CappedError -> 429). One trace per message. Stops early for ROOMIE_PAUSED,
                        a paused Group, unaddressed media and the caps (see "Abuse limits" below); mediaWantedFor is the
                        adapters' "fetch this photo / voice note?" question
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
    memory.ts           Memory: thread group-<id>, resource <groupId>; a DM: thread group-<id>-dm-<member>, resource
                        <groupId>:dm:<member> (the group's recall never finds it); last 30, semantic recall, working memory
    forget.ts           memory + trace cleanup: "forget me" (a Member's lines under every name they had, matched by text too,
                        Roomie's replies naming them, their note; traces their messages started), "delete group data"
                        (the thread, the Group's traces and scores), retention (deleteOldTraces, deleteOldMemory)
    observability.ts    UnaddressedTextFilter (a span output processor): a message the Gate stayed quiet on keeps no text
                        in its "roomie message" / "gate" spans (the ended span's input replaces the stored one)
    gate/               policy.ts (pure: decideGate, Chattiness thresholds, follow-up window, parseSilent), jev.ts
                        (questionsFor(enabled): the toolkit choices are the enabled manifests' gate criteria + core + none),
                        index.ts
    scorers/            relevancy (built-in) + brevity-tone (custom), Haiku judge, 10% of live replies
    evals/scenarios.ts  the fixed scenario set for `npm run evals`
  toolkits/             docs/toolkits.md: how to add one. coupling.test.ts: no Toolkit id literal outside its folder, the
                        lists below, the landing's Trick files and tests
    types.ts            the contract: ToolkitManifest (summary, longDescription, icon, category, tags, defaultOn,
                        requires, worksWith, status, gate { criterion, examples }, persona, abilities, adminOnly, postOrder,
                        dashboard { nav, pages }) and Toolkit (+ tools, dashboard { home, settings, mood } lazy refs,
                        onEnable/onDisable, bundle(ctx, now) = its line in the morning Bundle, report(ctx, now) = its
                        sections of the weekly report)
    define.ts           defineManifest (keeps the id literal), defineToolkit (manifest + server parts)
    manifests.ts        client-safe: MANIFESTS -> ToolkitId / TOOLKIT_IDS, CATALOG (+ coming-soon), manifestOf, findManifest
                        (id, name, nav label, stems, then tags: "chores" and "upkeep" find House, "split" / "expenses" Money)
    coming-soon.ts      manifest-only stubs: outings, cooking, trips, stickers, guests, move-out
    presets.ts          purpose -> Toolkits (roommates/family: splitting, groceries, house; trip/other: splitting+groceries;
                        friends/work: splitting)
    registry.ts         server: TOOLKITS (BY_ID satisfies Record<ToolkitId, Toolkit>) + toolsFor(gateToolkit, enabled),
                        toolkitById. Wraps every tool so a NotAllowedError comes back as { notAllowed, reason, message },
                        and a manifest's adminOnly tools only run when the Admin's own message asks (adminAskGate)
    admin-ask.ts        pure: checkAdminAsk (action words + target in `latest`, or yes + one of them after Roomie asked)
    catalog.ts          server: allToolkits, enabledFor(groupId), isEnabled, toolkitStates (React-cached per request)
    util.ts             ctxOf, toCents, memberIdByName (opts.includePending), dashboardLinks
    core/               manifest.ts + server.ts; members (list, list_pending, approve/decline/promote, set_payment_handle,
                        forget_me), people (remember, what_do_you_know_about_me), settings (set_group_settings incl.
                        personality, toggle_toolkit, list_toolkits), dashboard (get_dashboard_link: forEveryone = the Join
                        link line; rotate_join_link, set_join_policy, revoke_seat: adminOnly), reminders, report,
                        documents (keep_document, find_documents: links only with open=true); core's persona lines
    splitting/ groceries/ house/   manifest.ts + server.ts + the tools (+ dashboard.tsx: Home/Settings sections;
                        groceries: cart.ts + recipes.ts, requires splitting; house: chores.ts + upkeep.ts, the chores and
                        upkeep Tricks as one, nav "House" at /house). splitting's manifest name is "Money" (id unchanged)
    lease-inbox/        manifest.ts (off by default, requires integrations agentmail, offerLine, nav "Inbox" at /inbox 35,
                        postOrder 20, adminOnly trust_sender / release_inbox / send_intro), tools.ts (report_issue,
                        send_to_landlord, work_order_status, trust_sender, send_intro, ask_lease, inbox_status,
                        release_inbox), server.ts (onEnable = the address in the Chat, bundle, report), dashboard.tsx (Settings)
  integrations/         composio.ts (client + cached key health), splitwise.ts (SplitwiseClient: ComposioSplitwise and
                        FakeSplitwise, splitwiseClient(), splitwiseAvailability()), blob-store.ts (BlobStore: NeonObjectStorage
                        = the S3 API with fetch + SigV4, path-style, NEON_STORAGE_* or Neon's AWS_* env; MemoryBlobStore with
                        BLOB_FAKE=1 or no storage env, which in production is an error unless BLOB_FAKE=1 (storeKindFor);
                        blobStore(), setBlobStore() for tests), mail.ts (MailClient: AgentMailClient over the `agentmail`
                        SDK and FakeMail; mailClient(), setMailClient(), mailAvailability(): a key, or MAIL_FAKE=1)
  channels/types.ts     IncomingMessage { channel, chatExternalId, userExternalId, userName, text, imageUrl?, isPrivate?,
                        ... }, Outgoing (+ poll { question, options, multi }), Sent { externalId?, secret? }, PollVote,
                        Channel (sends return Sent; nativePolls), CantMessagePrivatelyError, ROSTER_GRACE_MS
  channels/index.ts     registry: registerChannel(); deliver(groupId, out) and deliverPrivate(memberId, out, { groupId?,
                        kind? }) go through the Chat's adapter (only log when none is registered) and return Sent;
                        deliverPrivate notes dm_context ("nudge") so the reply lands in that Group
  channels/dev.ts       the dev adapter used by scripts/dev-chat.ts (a Poll prints as numbered text, "(poll n)")
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
  channels/text.ts      shared copy and cutting: chunkText, commandOf, helpText(learned?) (the Group's Tricks, <= 8 lines; the
                        adapters pass them through the optional `tricksIn` dep), startReply, OOPS, NO_GROUP, wasAddressed
  channels/queue.ts     KeyedQueue: inbound work per Chat, in order
  channels/rate-limit.ts     token buckets (TokenBucket, SendLimiter) with an injectable clock; envMs
  channels/humanize.ts  replies typed like a person: planDelivery(text) -> bubbles with typing delays (first ~1.2-4 s, between
                        0.8-1.8 s, max 3 bubbles, sentences packed to ~160 chars, lists whole, a link alone, 10 s cap). Both
                        adapters send every bubble after "typing…"; REPLY_DELAY_MS pins the delay (tests)
  lib/auth/             server.ts (createNeonAuth), client.ts (createAuthClient), dev.ts (DEV_AUTH_EMAIL bypass)
  lib/session.ts        sessionUser -> currentAccount -> memberSession(groupId) / currentMember(groupId) (redirect/404)
  lib/env.ts            loads .env with override (import first in every entry point)
  lib/llm.ts            model ids for the Neon AI Gateway ("neon/<id>"), the gateway embedder
  lib/urls.ts           APP_URL links (dashboardUrl, linkFor)
  lib/dates.ts          day strings and labels in the Group's time zone (client-safe)
  lib/quiet-hours.ts    pure: inQuietHours / nextAllowed (22:00-08:00 local -> the next 08:00), daytimeHour
  lib/time.ts           Group time zones, Intl only (client-safe): zonedParts, zonedTimeToUtc (DST gap -> later, overlap ->
                        first), dayInZone, startOfDay, addDaysInZone, nextWeekday, parseInZone (bare wall-clock = Group
                        zone), formatInZone, describeNow, resolveTimeZone ("Chicago", "CST", "India" -> IANA), zonesByRegion
  lib/money.ts          formatMoney / parseMoney (client-safe)
  lib/units.ts          Instacart's units, synonyms (tbsp, lb, pcs), clove/pinch/slice -> buyable, parseAmount, formatAmount
                        clarifyQuantities ("eggs, 12, 18" -> one question)
  lib/voice.ts lib/style-note.ts
  lib/forget-text.ts    pure: sender tags, line bodies, photo URLs, whole-word mentions, anonymize (for forget me)
  lib/personality.ts    pure, client-safe: ARCHETYPES, Personality (normalize / validate / apply patch), confidenceFor,
                        slangBudget, usableNicknames, saysName, isPetCommand, moodFrom, greeting / win / preview lines
  lib/style-stats.ts    pure: the Learned style's counts (countPhrase, countNickname, mergeLearned, activeHours)
  lib/pay-links.ts      Venmo / PayPal / Cash App links with the amount (settle_up and the settle drawer)
  jobs/scheduler.ts     60 s tick: due reminders (deliver for the Group, deliverPrivate for a Member), held posts and DMs
                        (flushPendingPosts), the morning Bundle (bundleJob: the enabled Toolkits' bundle() lines + core's
                        Reminders line at the nudge hour, clamped to 08:00 out of quiet hours, claimed as "bundle", then logged as
                        Roomie's chat line so it opens the follow-up window) and
                        the weekly Group Report (once per period); Group style refresh; recurring Expenses (hourly
                        check); Splitwise outbox; daily retention (also unkept chat photos)
  jobs/report-text.ts   groupReportText: the same text for the weekly post and group_report (casual from the style note)
  jobs/retention.ts     daily: chat_messages, trace spans + live scores (mastra_ai_spans, mastra_scorers) and memory-thread
                        messages older than 30 days (ADR 0006, audit B4); logs the counts
  jobs/style-note.ts    every 50 chat lines: Haiku proposes style candidates, style-stats counts them into
                        groups.personality.learned (setCandidateReader() for tests); jobs/style-candidates.ts = the
                        JSON-only prompt + zod parse (no structured output: the gateway rejects it), bad answers skip
  proxy.ts              THE middleware (a root proxy.ts is ignored because the app is under src/): Neon Auth guard on
                        /g/* (-> /signin?next=<path>); /, /signin, /claim/*, /j/* and /admin/* pass (admin pages 404 for
                        non-operators, signed out included); a stray neon_auth_session_verifier on any matched page ->
                        /auth/callback (dev bypass skips it)
  lib/auth/             server.ts (createNeonAuth, sameSite lax), client.ts, oauth-paths.ts (client-safe URL helpers:
                        SIGNIN_PATH, safeNext, afterSignIn, signInPath), oauth-return.ts (the verifier exchange behind
                        /auth/callback), dev.ts (DEV_AUTH_EMAIL bypass)
  lib/window-limit.ts   WindowLimiter: take() = sliding window in memory (the beta form, votes); hit()/used() = fixed
                        windows on a CounterStore (MemoryCounters in tests)
  lib/rate-counters.ts  pgCounters (rate_counters; the DB is imported lazily, errors let the try through), prune, countsFor
  lib/caps.ts           CAPS (agent runs: 60/day per Member, 30 per 10 min and 200/day per Group; Jev 2,000/day per Group;
                        3 new Groups/day per adder), MAX_INPUT_CHARS 2,000, clipInput, caps() (Postgres) / setCaps (tests)
  lib/kill-switch.ts    roomiePaused() (ROOMIE_PAUSED=1), logPaused (one line a minute)
  instrumentation.ts    loads env, registers the Telegram Channel (outbound) when TELEGRAM_BOT_TOKEN is set; unless
                        DISABLE_SCHEDULER=1 (builds, tests), starts the WhatsApp socket (WHATSAPP_ENABLED=1) and the
                        scheduler once
  lib/operator.ts       currentOperator(): the signed-in user if their email is in ROOMIE_OPERATOR_EMAILS (lib/env.ts)
  components/ui/        shadcn components; components/roomie/ the mascot; components/app/ shared app bits
                        (sign-in, doorway, avatars, money-bits, categories, theme) and the self-contained Settings ->
                        "Reset what it's learned" (ADR 0020, Admins): learned-reset.tsx (server, <LearnedReset groupId />),
                        -button.tsx (client), -actions.ts (its own server action)
  app/
    layout.tsx globals.css   Figtree, theme script, toasts; the design tokens
    page.tsx            the landing page for everyone (_landing/, docs/landing.md); signed in, the nav says "Open dashboard"
    app/                /app: where a signed-in person lands: their one Group, a list of 2+ (name, chat app, your seat), or
                        "No groups yet" (+ paste a Claim link);
                        signed out -> /signin. The default `next` after sign-in (APP_PATH)
    _landing/           landing.tsx (sections, HEADLINE/SUBLINE), demos.ts (the Apt 4B chats; arithmetic checked by
                        demos.test.ts), chat.tsx (ChatWindow: lines, DMs, Polls), landing.css (CSS-only motion),
                        beta-form.tsx + actions.ts (the WhatsApp beta form), tricks.ts (Tricks from the manifests, accents),
                        stage.tsx (the dino watching a chat), vote-button.tsx (Tricks and Soon channels), share-row.tsx,
                        marks.tsx (links, share links, logos); words.test.ts = no AI/bot/brain/assistant/smart/toolkit/
                        feature/enable/vibe in anything a person reads
    help/               /help: how Roomie works + FAQ (faq.tsx; faq.test.ts keeps the JSON-LD text equal to the page)
    signin/             the sign-in screen: Google + paste a Claim link + "Sign-in didn't complete"; ?next= afterwards
    privacy/            the short privacy page (what's kept, per Group, forget me)
    claim/[token]/      Claim link: sign in, consume, link the Account, -> /g/<id>
    j/[code]/           the Join link (noindex, no-referrer): signed out -> /signin?next=/j/<code>; already in the Group ->
                        /g/<id>; else the seat picker ("Which one are you?", open seats, "I'm not on this list") ->
                        pickSeat (actions.ts) -> joins.claimSeat; unknown or rotated code = 404
    auth/callback/      Google sign-in return: verifier -> session cookies -> `next` (or `next?auth_error=<reason>`)
    g/[groupId]/        layout (session + GroupProvider + shell; Pending members see a waiting screen; groupView builds the
                        nav, overflow and owned pages from the enabled manifests once), Home (doorway + Today = the Bundle
                        on a page: todayView = each enabled Toolkit's bundle() line in post order with its accent dot +
                        your Reminders due today, "Nothing due today." otherwise; RecentDocuments (empty until core's
                        Documents: recentDocumentsView) + Toolkits' Home sections + Reminders coming up + narration), money
                        (+ ?tab=, [expenseId]), cart (+ ?recipe=; Recipes and Pantry in _components/recipes.tsx), house
                        (Chores and Upkeep tabs; /chores redirects there, ?tab=reminders to /reminders), inbox (Lease
                        Inbox: tabs by class, a thread view, the reply box; screens/inbox.tsx), reminders (core:
                        Today / Coming up + Add reminder, also a tile in the More drawer), members, settings (core +
                        Toolkits' settings sections; the Tricks list is one link row; NudgesCard in _components/nudges-card.tsx
                        is a null slot until #25), toolkits (the Tricks page: a plain list, Learned / Not yet / Soon (#soon),
                        detail sheet with Teach Roomie X / Forget X; ?open=<id>; also served at tricks/);
                        actions.ts = every server action; _components/data.ts = services -> screen shapes;
                        _components/sections.tsx = the Toolkits' Home/Settings sections and mood for a request;
                        _components/toolkit-off.tsx = the off state of a page whose Toolkits are all off ("Roomie hasn't learned X
                        here yet."); _components/dock.tsx = the dock (Home, the first 2 learned Tricks by nav order, Ask
                        Roomie centred, More: Home · Money · Ask · House · More for roommates; a Trick that's off leaves its
                        slot to the next by order) and the More drawer (the learned Tricks not in the dock, greyed Teach /
                        Ask an admin slots, one "What's coming" tile to the Tricks page's Soon list, Reminders, Members,
                        Settings; aria-current in both); _components/screens/*
                        settings/splitwise/callback = Composio's return URL (route handler)
    design/             the design-system page (dev only unless SHOW_DESIGN_PAGE=1)
    api/auth/[...path]  Neon Auth proxy; api/chat = Ask Roomie (session Member, 401/403); api/receipts = Scan receipt;
                        api/docs/[id] = a Document's file (active Member of its Group, else 403; unknown 404; private cache);
                        api/telegram = Telegram webhook (401 without TELEGRAM_WEBHOOK_SECRET in the header);
                        api/mail = AgentMail's webhook (webhook.ts: Svix on the raw body with AGENTMAIL_WEBHOOK_SECRET; inboxes are made on AGENTMAIL_DOMAIN, else agentmail.to,
                        else 401; 204 at once; queued per inbox; MAIL_FAKE=1 + `x-roomie-fake-mail: 1` outside production);
                        api/admin/whatsapp = status JSON + start / request-pairing-code / logout (operators, else 404)
    admin/whatsapp/     the operator page: state, QR (refreshes every 5 s), pairing-code form, the linked number, Log out
    admin/beta/         operators: the beta requests, newest first, status new / contacted / onboarded / declined
    admin/groups/       operators: every Group (channel, members, created, last message, runs today), Pause / Resume /
                        Leave chat, a banner while ROOMIE_PAUSED=1; actions log "[admin] <email>: <action> <groupId>"
drizzle/                generated migrations (0000 baseline drops the pre-step-4 tables; 0012 is hand-written SQL: the
                        chores + upkeep group_toolkits rows become one house row, idempotent)
scripts/migrate.ts      npm run db:migrate
scripts/lib/prod-guard.ts  seed, dev-chat, evals and test:tools refuse the production Neon branch; telegram (polling) and
                        telegram:webhook --delete refuse when getMe says the token is @imroomiebot (prod), --set refuses
                        to point it anywhere but https://tryroomie.me (ALLOW_PROD_BOT=1 overrides)
scripts/scrub-dev.ts    npx tsx scripts/scrub-dev.ts: makes a fresh copy of prod safe (keeps only `dev` Channel Groups; drops
                        the WhatsApp login, wa_contacts, beta requests, votes, traces, unused Accounts); refuses on prod
scripts/seed.ts         demo Group "Apt 4B" (dev Chat dev-apt-4b); prints its id, a Claim link for Maya, a Studio requestContext
scripts/dev-chat.ts     the terminal group chat stand-in (docs/dev-chat.md)
scripts/telegram.ts     npm run telegram: long polling (deletes any webhook first); telegram-webhook.ts --set/--delete/--info
scripts/telegram-check.ts  npm run telegram:check: read-only readiness (getMe, privacy mode, webhook, APP_URL, delays,
                        Toolkits, DB + migrations, a 1-token Haiku call, Jev); non-zero with the fix when something's off
scripts/whatsapp.ts     npm run whatsapp: holds the WhatsApp session from a terminal (QR in the terminal, --pair <digits>
                        for a pairing code, --timeout <s>); never while Fly holds it
scripts/wa-contacts-prune.ts  one-off: wa_contacts rows for nobody who's a Member (counts; --yes deletes)
scripts/og-image.ts     rebuilds public/landing/og.png (the share image) from the brand SVGs with sharp
scripts/evals.ts        runs the scenarios in throwaway Groups; --baseline writes docs/evals-baseline.md
scripts/studio-presets.ts  writes .mastra-presets.json for Studio (run by mastra:dev)
```

## Identity and permissions

- **Join links** (ADR 0014, `docs/joining.md`): one per Group, `APP_URL/j/<code>`, posted in the Chat when setup finishes (`set_group_settings` returns `say` = the learned line + "Everyone: your dashboard is at <link>. Sign in with Google and pick your name."; answered in a DM it's posted in the group too) and for "send us the dashboard". It binds nobody: signing in and picking an open seat connects only when the policy is "free" and claimed Accounts < `rosterSize`; everything else is a Pending Member (with `wants_seat_id`) an Admin approves (approval moves the Account onto that seat). Admins revoke / reassign seats and rotate the code (old = 404). All in `services/joins.ts`.
- **Accounts and Claim links** (ADR 0003): a Member gets a single-use, 24-hour Claim link in the Admin's setup DM, when they ask for the dashboard for themselves (`get_dashboard_link`, which sends it privately and reuses a live one) or from `dev-chat link`. Never in bulk (ADR 0001). `/claim/<token>` signs them in with Google, upserts `accounts` from the session user (mirrored by `auth_user_id`, ADR 0008) and links `members.account_id`. One Account can be a Member of many Groups.
- **Who is what** (ADR 0008): whoever adds Roomie is Admin; people already in the Chat are active; later joiners and unknown senders are Pending until an Admin approves (chat or Members page).
- **Telegram can't list members** (ADR 0010): at join time Roomie knows the adder (Admin) and the group's Telegram admins (active). Anyone else becomes a Member on their first message: active if it's within 24 h of Roomie joining (`ROSTER_GRACE_MS`, from `chats.created_at`), Pending after. `new_chat_members` are Pending at once (with the approval ask), even inside the 24 h; people added together with Roomie count as already there.
- **WhatsApp can list members** (ADR 0013): when Roomie is added, the whole group (from `groupMetadata`) becomes active Members, the adder the Admin; there is no roster window and no "press Start": Roomie can DM any Member. Later joiners are Pending, as everywhere. A Member's `channel_user_id` is the phone JID (`<number>@s.whatsapp.net`) when resolvable, else the LID (`…@lid`); every learned pair is kept in memory, but only Members' pairs go to `wa_contacts` (`deleteContactFor(jid)` in `whatsapp-store.ts` drops one) and LID Members move to the phone JID (`rekeyChannelUser`). Members named by their number (`+1555…`, or "Someone" for a hidden one) take the profile name from their first message.
- **Private messages on Telegram:** a bot can't DM anyone first, so the intro asks people to tap @bot and press Start once; the Admin's setup DM is tried at join and otherwise sent on their `/start` (`setupDmFor`). On WhatsApp it goes out at once. A refused DM is a `CantMessagePrivatelyError`; `get_dashboard_link` relays its "tap @bot and press Start" message and never posts the Claim link in the group.
- **DMs** (ADR 0020, `services/dm.ts`): a DM from any Member goes through the pipeline with `isPrivate`; `resolveIncoming` picks the Group: a `for <group name>:` prefix, else the Group Roomie last DM'd them about within 24 h (`dm_context` "nudge", written by every `deliverPrivate`), else the Group they last DM'd about ("dm"), else their only Group, else one question ("Which group is this about: Apt 4B or Lisbon trip?") and the held message runs when a reply names one. The run writes only the Member's DM thread (`threadFor(groupId, memberId)`); the group's recent chat is read-only context; DMs stay out of `chat_messages`. Tools see `source: "dm"` (`ctxOf`), so Activity says `dm`. **Echo rule:** after a DM or dashboard Ask, `echoAfterPrivateRun` reads that run's own Activity rows: an Expense with more than one Member in its Shares logged / changed / deleted posts ONE group line ("Dev logged $40.00 pizza, split 3 ways."); a Settlement never echoes (the other person gets "Dev paid you $20.00." privately) and DM Settlements are left out of the group's SINCE YOU LAST SPOKE. No DM path: `nudgeOrHint` posts "Dev, I've got something for you; tap @bot and press Start." at most once per Member per 7 days (`member_notes.note.lastStartHintAt`), never the content (private reminders use it too). `set_nudges` sets `member_notes.note.nudges` ("off" | "on"; `nudgesOff(memberId)` for the nudge selectors; Reminders ignore it). In dev-chat a DM stays in its attached Chat.
- **Polls** (ADR 0018, `services/polls.ts`): `ask_poll` (core tool, who-questions only, ≤ 4 options) sends `Outgoing.poll`: Telegram `sendPoll` non-anonymous (`poll_answer` in `TELEGRAM_UPDATES`, empty `option_ids` = retracted), WhatsApp a native poll whose `messageSecret` is stored in `polls.secret` (Baileys rc14 doesn't decrypt votes: the adapter takes `pollUpdateMessage` from `messages.upsert`, loads the secret through `deps.pollSecret`, `decryptWaVote` tries the phone / LID jid pairs, `optionIdsFromHashes` matches SHA-256 option hashes), dev-chat numbered text (`nativePolls` false: a bare number from an active Member is the vote, before the Gate). Votes reach `handlePollVote`. Resolution once: majority (`floor(n/2)+1` active Members), 2 hours (`expirePolls` in the scheduler tick) or the asker's `log_expense` in a later run (`closePollsFor`, logs nothing); "who-in" logs one even Expense among those in (payer first), then one line.
- **Rules** (`services/authz.ts`): Pending members can chat and read, but every write service calls `requireActive` and refuses with "Hang on, an admin needs to approve you first. <Admin> can approve you." Members, roles, settings, Toolkits and delete-group-data call `requireAdmin`. Expenses can be changed by whoever added or paid them, anyone with a Share, or an Admin. Any active Member can add a chore and record a Settlement between two other Members (intended).
- **Lease Inbox** (ADR 0016, #27, docs/toolkits.md#lease-inbox): any active Member may have Roomie email the landlord (the signature names them); simple mail goes at once. Anything the send rule calls complex is **held** by `sendToLandlord` (in this process's memory, like the admin ask's confirmations: group + Member, the recipient, a hash of the exact draft, the questions, a token, 10 minutes) and comes back as the questions; a later call sends only with a `SendApproval` for that held send: the same Member's own `latest` message saying yes (`saysYes`), or the dashboard's "Send anyway" returning the token. No held send (a first message that says "ok"), another Member, a changed recipient or draft, or an expired one gets the questions again; one yes releases one email; the tools have no `confirmed` argument and `replyToLandlord` takes no flag from the client. A reply goes only to a thread whose sender (a forward's original sender, `mail_messages.reply_to`) is a trusted landlord sender right now, whatever the caller says; anyone else is `trust_sender` first. Only trusted landlord senders reach the chat, Reminders or work orders: a forward teaches the landlord only from a Member whose Account email sent it, and never when AgentMail labels it `unauthenticated`; anyone else is a new sender, filed, and the Admins are asked privately once per domain ("yes" = `trust_sender`, Admins). A rent change only ever reaches the Admins privately with the words that run `set_rent` (its own admin ask); nothing changes by itself. Releasing the address and trusting or removing senders are Admin-only.
- **Dashboard:** every page and action goes through `lib/session.ts`; nothing trusts a member id from the client. Non-Admins don't see admin controls, and the actions return 403 anyway.
- **Dev sign-in bypass:** with `NODE_ENV !== "production"` and `DEV_AUTH_EMAIL` set, that email is the signed-in Account (loud warning in the log). For automated browser checks only.
- **Privacy** (ADR 0006, `/privacy` must say what the code does): chat_messages, memory-thread messages, traces and live scores live 30 days; a message the Gate stayed quiet on keeps no text in traces. `forget_me` deletes a Member's chat lines, note, Claim links, reminders set for them, memory lines under every name they had (and Roomie's replies naming them; other Members' names, longer or the same, are left alone), the unkept photos in those lines and every `photo` Document they uploaded (their name comes off the rest), the traces their messages started or that carry their "[Name]" lines (with whole scorer runs) and their `wa_contacts` row, sweeps again 90 s later (the agent's turn saves "[Name] roomie forget me" after the tool runs; retention also clears forgotten Members' traces), anonymizes their names in Activity, then makes them removed: "Former member", no `channel_user_id`, no Account (a later message makes them a new Pending Member); the last Admin leaving promotes the longest-standing active Member; ledger rows stay. "Delete group data" wipes the Group's data (purchase events included), memory, traces, scores and Documents (rows and files), and the Lease Inbox's mail, work orders and landlord senders, and releases its email address (`releaseGroupInbox`: AgentMail, then the row; a failure is logged and never stops the deletion; deleting a Group does the same), but keeps the Group, Chat and Members. Forget me also takes their name off work orders, sent-mail records and forwards (`anonymizeMailMember`); the emails were sent and stay.
## Splitting (step 5)

- **The model passes intent, never computed cents** (ADR 0007). "50/25/25" is `percents`, "2:2:1" is `shares`, "Dev 30, Sam 15" is `exact` (as said), "Alex paid 60 and I paid 40" is `payers`. The service computes every Share; a split that doesn't add up throws a `SplitError` whose message says what's left or over, and Roomie asks.
- **Rounding:** equal splits give leftover cents to the (primary) Payer first, then list order; percent and shares use largest remainder, ties by Payer first, then name. Percents must sum to 100 ± 0.01. Everything sums to exactly the total.
- **Payers:** `expense_payers` is the truth (Balances = Σ paid − Σ owed ± Settlements). `expenses.payer_id` is the primary Payer (paid the most), kept in sync for display. `expense_splits.weight` keeps the typed percent/shares so an edit re-renders the method, and `updateExpense` with only a new total re-splits equal/percent/shares the same way (exact or multi-payer need new amounts).
- **Categories** are always set: Roomie picks one (`log_expense.category` is required), the dashboard guesses from the description until you choose, `guessCategory` covers old rows and imports. `occurred_on` is the day it happened in the Group's time zone; lists sort by it.
- **Recurring** (`monthly` on the start's day of month clamped to 28, `weekly` on its weekday): the scheduler copies the parent with `recurring_parent_id`; (parent, day) is unique, so a copy is made once per period, deleted copies included.
- **Settle plan** follows `groups.simplify_debts`: on = fewest payments (`computeSettlePlan`), off = pairwise (`pairwiseDebts`). `settle_up` with `paid: false` records nothing and returns pay buttons (`lib/pay-links.ts`) for the payee's handles; `paid: true` records a Settlement. Handles live in `member_notes.note.handles` and are merged in SQL so two saved at once both stick.
- **Receipts:** `services/receipts.ts` sends the photo (always as a data URL; our own `/api/docs/<id>` Documents are read from the blob store) to `RECEIPT_MODEL ?? LLM_MODEL` on the gateway's `/v1/chat/completions` with an `image_url` part (no `temperature`: claude-sonnet-5-5 rejects it). The model only transcribes; zod validates, prices are parsed as strings, the total is recomputed (items + tax + tip) and a mismatch is flagged so Roomie asks. `expense_from_receipt` builds exact Shares per item (unclaimed items shared, tax and tip proportional), shows the breakdown first unless they explicitly asked to log it. Photos are Documents (`services/documents.ts`, ADR 0018): a chat photo or dashboard scan is an unfiled `photo` (Roomie can read it, the Docs list doesn't show it, retention drops it after 30 days); logging it as an Expense's receipt makes it a filed `receipt` with `source` the Expense and sets `expenses.receipt_document_id` (`receipt_url` stays the `/api/docs/<id>` link). Nothing is written under `public/uploads` any more. `RECEIPT_FAKE=1` (evals) or `setReceiptReader()` (tests) skip the model.
- **Rent** (#25, ADR 0019, `services/rent.ts`) is the recurring monthly Expense with category `rent`, one Payer and any split; `set_rent` / `rent_status` (shares only in a DM). Money's `bundle()` says it 3 local days before the due day and on the due day while someone's rent is unpaid (`owingRent`, pure: their Share of this month's occurrence is more than their Settlements to the Payer since the DMs went out; other debts don't count), and DMs each Share but the Payer's (`rentDmJob`, claimed `rent.ahead` per month, only in the Bundle's hour, clamped to 08:00 like the Bundle, since Home's Today calls `bundle()` too). A change once a month was charged starts a new parent next month.
- **Variable bills** (`expenses.variable`, `pending_amounts`): the parent has 0 cents of its own (the service allows 0 only for it) and Balances, the Settle plan and Splitwise skip it; `runRecurring` asks its Payer on the due day (one re-ask the next day), `answer_amount` logs the month split like the parent once, `prefillAmount` is the Lease Inbox's hook (the current local month's row, or a new not-yet-asked one; an old unanswered month is left alone). A failed Settle nudge run gives its `nudge.settle` claim back.
- **The Settle nudge** (`services/settle-nudge.ts`): Money's `report()` runs `settleNudgeJob` (claimed `nudge.settle`, report day and hour): one DM per pairwise debt over `settings.nudge.thresholdCents` for `thresholdDays` (default $20, 7 days; a Settlement restarts the age), skipping `note.nudges = "off"`. The report's Money line is a count ("2 open balances; I've DM'd everyone."), never names.
- **Splitwise** (ADR 0004, 0009): `SplitwiseClient` with a Composio implementation (`composio.tools.execute(slug, { userId: accounts.id, arguments })`, `connectedAccounts.link(userId, authConfigId, { callbackUrl })` for OAuth) and `FakeSplitwise`. `splitwiseClient()` returns the fake when `SPLITWISE_FAKE=1` (tests inject one with `setSplitwiseClient`); dev-chat switches to the fake by itself when `COMPOSIO_API_KEY` is missing or rejected and says so once. A 401 / missing key / no connection is `SplitwiseNotConnectedError` ("Splitwise isn't connected yet"), relayed as text, never a crash; Settings shows the card disabled with the reason. Import maps people by email, then name, else adds them as Pending; owed_share -> exact Shares, paid_share -> Payers, payments -> Settlements, refs dedupe per Group. Export is a one-time copy of what has no ref; the live mirror queues `outbox_jobs` that the scheduler pushes (create/update/delete by ref, retried with backoff).

## Groceries (step 6)

- **A Recipe never touches the Cart by itself** (plan Q7). `recipe_draft` writes and saves one (servings default to the active Members), returns ready-to-post text (need / have, step count) and an `askToAdd` question; only `recipe_add_to_cart` (someone asked, or clearly meant it) puts ingredients in, minus the Pantry and `skip` ("we have onions"), minus what's already open from that Recipe or shared, as shared items with `recipe_id`.
- **Recipe JSON** comes from `RECIPE_MODEL ?? LLM_MODEL` on `/v1/chat/completions` (no `temperature`). zod validates it; units must map to Instacart's list (`lib/units.ts`), else one retry with the error as feedback, then unknown units become `each`. A recipe written for the wrong number of people is scaled in code (countable units round up). `RECIPE_FAKE=1` / `setRecipeWriter()` skip the model.
- **Pantry** lives in `group_toolkits.settings.pantry` (groceries), names normalized. Matching is word-based with the last word as the thing itself: "oil" covers "olive oil", "rice" doesn't cover "rice vinegar".
- **Restock** (#26, `services/restock.ts` + pure `restock-math.ts`, `lib/items.ts`): `purchase_events` (migration 0017) are written by `markPurchased` (one per item, in its transaction; personal = the adder, shared = null) and `recordReceiptPurchases` (one per receipt line, once per Expense: the `purchase_events_once` unique index, so two at once write one set); `scripts/backfill-purchases.ts` covers older purchased items. The estimate reads history up to today only.
- **The estimate:** per normalized item and scope with 3+ distinct purchase days, probably low from floor(0.9 x median gap) days after the last one, never within 2 days of a purchase, never when it's open in the Cart. Shared items are Groceries' `bundle()` line; a Member's own go to their DM only (`personalCandidates`). Mutes live in `group_toolkits.settings.restockMutes` (`restock_mute` / `restock_unmute`, any active Member).
- **Restock wiring:** the scheduler logs the Bundle as Roomie's chat line (only the Bundle), so "yes" / "just the milk" right after it is in the follow-up window and goes to `restock_add_listed({ scope, only? })` (recomputes today's candidates: bought or in the Cart since = not added). `restockDmJob` (from Groceries' `bundle()`, Bundle hour only) DMs "Probably low: your oat milk. Add it?" once per Member per day (`scheduled_posts` `restock.dm`, period `<day>:<memberId>`, via `sendNudge`); a yes there is scope "mine" (from the group chat, "mine" adds nothing and says to DM). `expense_from_receipt` writes purchase events (`recordReceiptItems`; groceries / household receipts only). `cart_checkout` returns `askFirst` with `suggested` instead of a list while probably-low items aren't in the Cart; `skip_suggestions` for "just checkout" or after the answer. The Cart page has a Probably low section (Add, Mute).
- **No prices** (docs/toolkits.md#groceries): track -> Instacart list -> receipt -> who had what -> confirm -> split. Nothing is estimated; `est_cents` is no longer written (old rows are ignored), and no tool result, persona line or page shows a price or a cart total. Quantities are kept as said; `addAsSaid` returns `needsClarification` for ones that can't be read one way. Routine Groceries tools return no `links` (`cart_view` with `link: true` when someone asks for the page).
- **Photos**: `cart_from_photo` reads a recipe / list / shelf (`services/grocery-photos.ts`), asks in one line, adds on `confirm` (a recipe is saved too); a receipt comes back as `{ kind: "receipt", next: "expense_from_receipt" }` (Groceries requires Money, so the tool is always there).
- **Checkout** (`cart_checkout`, "Get Instacart link"; asks about probably-low items first, see Restock wiring): snapshots the open Cart into `cart_checkouts`, builds an Instacart shopping list (structured `quantity`/`unit`, else parsed from `qty`), returns an "Open in Instacart" button. The same open items reuse the last unpaid Checkout. If Instacart can't be reached the Checkout is still saved with a null url and Roomie says the link isn't available yet.
- **"I paid $84"** is `cart_purchased` (persona: not `log_expense`). `markPurchased` flips the open items (or a Checkout's) to purchased in a transaction, then `logExpense` with `method: "exact"`, `category: "groceries"` and `computeCartSplits` rows (one share per item: personal to the adder, shared evenly; payer-first remainder); the newest unpaid Checkout it covers gets `expense_id` + `paid_at`. The drawer previews with the same function and the active Members in `listMembers` order, so it matches to the cent.
- **Instacart** (ADR 0004): `InstacartClient` with `ComposioInstacart` (`tools.execute("INSTACART_CREATE_SHOPPING_LIST_PAGE" | "INSTACART_CREATE_RECIPE_PAGE", { userId: "roomie-app", arguments })`, Instacart IDP body shapes, `products_link_url` found at any depth) and `FakeInstacart` (deterministic `https://instacart.example/...`). Instacart is a "no auth" Composio toolkit: no auth config, no connection, only `COMPOSIO_API_KEY`. `INSTACART_FAKE=1` / `setInstacartClient()` pick the fake; dev-chat switches by itself when the key is missing or rejected; failures are `InstacartUnavailableError`, relayed as text. The dashboard button is enabled only for the real client with a healthy key. Recipe links are cached on the Recipe by `recipeKey` (title, servings, ingredients).

## Chores, upkeep and reminders (step 7)

- **Time zones:** every "today", "tonight", "Tuesday 8pm", "this week", due day, nudge hour and report window is computed in `groups.timezone` with `lib/time.ts`. Never `new Date().getDay()`/`toISOString().slice(0,10)` for a Group's day. The agent's instructions carry the local now (`describeNow`); tools take local wall-clock without an offset (`parseInZone`: an offset is honoured, a bare `2026-11-03T20:00` is the Group's zone, a bare date is 9:00). `validateSettings` maps what people say ("Chicago", "CST", "India", any IANA city) with `resolveTimeZone`; unknown -> "Which city are you in?". Test DST with America/Chicago Nov 1 2026, Europe/Berlin Oct 25 2026 and Asia/Kolkata.
- **Rotation:** `chores.rotation` (member ids in order, null = everyone). With one, the turn is the Member after whoever last did or passed it (inactive ids drop out; an empty result falls back to everyone); without one, whoever did or passed it least recently (never first, ties by name). A pass is a `chore_logs` row with `skipped`: it moves the turn, isn't a done (no streak, the chore stays due). Only whoever's turn it is can pass (`not-yours`). Logging for another active Member is fine; the Activity row says "for Dev".
- **Due and streaks:** a chore is due on (last done's local day + everyDays), never done = due today; `state` is overdue / due / ok. A Streak counts a Member's own consecutive on-time dones on that chore (on time = no later than the previous done's day + everyDays); a pass or a late done ends it. Upkeep: never done = due today (due soon, not overdue), due soon = within 7 days.
- **Reminders:** `memberId` null = the whole Group (posted with `deliver`), set = that Member privately (`deliverPrivate`), never both; if Roomie can't DM them yet it goes to the Chat once, addressed to them, with the Start hint. `created_by` gives "(set by Maya)" when set for someone else. Repeats (daily / weekly / monthly, monthly clamped to day 28) keep the local wall-clock and skip missed occurrences. The scheduler claims a reminder (sets `sent_at`) before sending and releases it on failure. Lists show only what the viewer may see (`visibleTo`); cancel = the target, the setter, anyone for a whole-group one, or an Admin.
- **Posts Roomie makes on its own (ADR 0001, ADR 0017):** the morning Bundle at `group_toolkits["house"].settings.nudgeHour` (default 9, null = off): each enabled Toolkit's `bundle()` line in post order, then core's line (whole-group Reminders due today), nothing when none has anything to say (House's chores line, only when something is due or late; Money's rent line; Groceries' probably-low line; Lease Inbox's visit tomorrow / quiet work order; and core's). Lease Inbox's event lines (a notice, a work-order reply, a rent change) are posted when the email arrives (`postLine`: none when paused, held to 08:00 at night as a `pending_posts` "line"); a notice within 72 hours takes the urgent slot instead; an hour inside quiet hours (22:00-08:00 local, `lib/quiet-hours.ts`) goes out at 08:00. One urgent post a day (`services/urgent.postUrgent`) and private nudges (`services/nudges.sendNudge`) hold to 08:00 in `pending_posts` at night; the weekly Group Report at `group_toolkits["core"].settings.report = { weekday, hour }` (default Sunday 18). Both are claimed in `scheduled_posts (group, kind, local period)` before sending (kinds `bundle`, `urgent`, `report.weekly`), so at most one per day / week across restarts and processes; a failed send gives the claim back. Upkeep has no post of its own: it's a line in the report. The window is the whole hour; a scheduler that was off for it skips that day rather than posting late.
- **The Group Report** is one message of at most ~12 lines: each enabled Toolkit's `report()` parts in post order (Money: the open balances as a count and the rent offer once; House: chores this week, the best streak, what's up now, the chart, upkeep due soon; Groceries: the Cart's size), then core's next-week whole-group reminders. Core names no Toolkit. Emoji-led lines by default; when the Group style note's tone is casual (`isCasualStyle`) the same sentences run together without the list look. `group_report` returns the same text (`groupReportText`) and Roomie posts it verbatim.
- **Onboarding copy:** the intro is three lines and no feature list (who Roomie is, "tell me what this group is for ... and I'll learn the right Tricks", the Admin); when setup finishes `set_group_settings` returns `learned` (`learnedLine`: "Learned Money and Groceries. Say "roomie, learn house" any time.", or "You didn't say what this group is for, so I kept the roommates set: ..."; while an off-by-default Trick with an `offerLine` is off, its sentence follows: "Want me to handle the landlord's emails too? Say "roomie, learn lease inbox"."), and `say` (that line + the Join link line), which Roomie posts as it is.
- **House's `onEnable`** (teaching it, and Onboarding presets that include it) adds the three starter chores (no Rotation, so new people join in; only on an empty chart) and the usual five upkeep items (only the missing ones), so twice adds nothing. Onboarding itself names no Toolkit.
- **Groceries requires Money:** "I paid 84" ends in an Expense, so teaching Groceries with Money off is refused ("it needs Money first") and forgetting Money while Groceries is on is refused ("Groceries needs Money, so I'm keeping it"); `cart_from_photo` no longer checks and a receipt always points at `expense_from_receipt`.
- **First contact** (`channels/text.ts`, shared by both adapters): `/help` (group or DM) is at most 8 lines naming the Group's Tricks (`helpText`), `/start` in a DM is one line and never a link (on WhatsApp nobody needs either; they work when typed, and other text starting with "/" goes through as text there), on Telegram other slash commands are ignored, a failure while Roomie was addressed gets one friendly line (`OOPS`) and the stack goes to the log. `npm run telegram` prints a `[roomie]` line per message (gate, tools, time, trace id) and per reply.

## Personality (one voice)

How Roomie should talk and act, and its boundaries: [ADR 0021](docs/adr/0021-a-roommate-in-the-chat.md).

[docs/personality.md](docs/personality.md), [ADR 0012](docs/adr/0012-personality-archetype-sliders-learned-style.md), [ADR 0020](docs/adr/0020-one-voice-and-private-dms.md). Roomie is the chill archetype, called Roomie, plus the Learned style. The other archetypes, the name, quirks and sliders stay in code behind a dev switch: `normalizePersonality` ignores a stored `base` / `name` / `quirks` / dials unless `ROOMIE_ARCHETYPES=1` and `NODE_ENV !== "production"` (`archetypesUnlocked`), so an old Group's "hype, Dino" is inert. Settings keeps only "Reset what it's learned" (Admins). `set_group_settings`'s `personality` fields are to be removed from the tool schema (toolkits owner).

- **Instructions are composed in code** (`mastra/persona.ts`), never one free-text prompt: core rules (facts from tools, no math, brevity) first, then the voice, sliders as sentences, quirks, learned style, `/* TOOLKIT_PERSONA */` (enabled manifests' optional `persona: string`), mood, what Roomie knows about people. Jokes are a trait, not a Toolkit.
- **Adaptation is bounded by code:** confidence comes from messages seen (`confidenceFor`); below 0.3 no slang, 0.3-0.6 one phrase per 5 replies (checked against Roomie's last 4 chat lines), above 0.6 free but never more than the group; nicknames only after 3 sightings by others. Counts come from the messages (`lib/style-stats.ts`); the model only proposes candidates. Change the rules there, with a test.
- **Say-once behaviours** claim a `pet_moments` row (group, kind, key): the day's greeting (not when quiet, not after Roomie already posted that day, one line, no link) and win cheers (square after a Settlement, chore streak 3/7/30, a Checkout), appended as one short line in the archetype's voice. `/pet` (and "pet roomie") is a hard trigger with a 1-2 line in-character reply.
- **Brief and current**: the house style says answer first, one or two lines, no recap, links only when asked. The instructions carry SINCE YOU LAST SPOKE (`activity.changesSinceRoomieSpoke`, read in `agents/roomie.ts`): what changed since Roomie last spoke, with where ("(dashboard, 2 min ago)"); when it differs from what Roomie said, Roomie says the fact in one line.
- **Mood** (`groupMood`): worried if anyone owes > $100, sleepy after 5 quiet days, happy when everyone's square, calm otherwise; the Home dino and one line of the instructions.
- **Member facts** (`remember`, `what_do_you_know_about_me`) live in `member_notes.note` next to the handles; only your own, or an Admin for anyone; "forget me" wipes them.
- Evals: the runner claims the day's greeting for every scenario except `greet: true` ones, so a hello doesn't change other replies.

## The Gate (when Roomie speaks)

`mastra/gate/policy.ts`, ADR 0002. In order: hard trigger (`isHardTrigger`: reply to Roomie, @mention, the word "roomie", the dashboard, a DM; a voice note is not one by itself) always speaks; Jev error or > 2.5 s means hard triggers only; p(act) over the Group's threshold acts; in the follow-up window (3 min / 3 messages after Roomie spoke) the agent decides with permission to answer `[silent]`, unless Jev is sure it's chatter; p(clarify) over its threshold asks. Thresholds (act / clarify): quiet .9/.8, **normal .75/.6** (default), chatty .6/.45. If nobody addressed Roomie and it's not a follow-up, the agent is told to ask before logging anything. Jev's toolkit narrows the agent's tools only at p ≥ 0.6, and Jev is only offered the Group's enabled Toolkits (plus `core`: reminders, members, settings, what Roomie can do; and `none`). While Onboarding is open (`groups.onboarded_at` null), an active Member's message in the follow-up window counts as a hard trigger, so "roommates, USD, Chicago" reaches `set_group_settings`. Poll votes never reach the Gate: native votes come in as `PollVote`s, and on a text-poll Channel a bare number while a poll is open is recorded and Roomie stays quiet (reason `poll-vote`); a DM in several Groups that names none gets the which-group question without an agent run (`which-group`).

## Abuse limits and the kill switch (audit B3, H1, H2, H4, H6)

- **Caps** (`lib/caps.ts`, counted in `rate_counters` per UTC day / 10 minutes, so restarts don't reset them): a message that would reach the model counts one agent run for its Member (60/day) and Group (30 per 10 min, 200/day), checked on all three before any is counted (a refused run uses up nobody's budget); every Chat message counts one Jev call for the Group (2,000/day; past it the Gate is hard-triggers-only; the dashboard's Asks have their own 2,000); someone adding Roomie counts one new Group (3/day per Channel user id, not on the dev Channel; past it Roomie says one line and leaves through `Channel.leaveChat`, `onGroupJoined` throws `JoinRefusedError`). Over a daily run cap Roomie says "I'm taking a breather; back tomorrow." (shaped to the vibe) once per Group per day when it was addressed, over the 10-minute cap "Give me a few minutes, I'm catching my breath." once per window, and one Member over their own cap hears "You've asked me a lot today; back tomorrow." once a day; then nothing. If `rate_counters` can't be reached, the counts go on in this process's memory (never "no caps"). Text is cut to 2,000 characters before the Gate, and `chat_messages` stores the cut text. The dashboard's Ask: 413 over 2,000 characters, 429 over a cap.
- **Kill switch:** `ROOMIE_PAUSED=1` and `respond()`, `respondToIncoming()`, joins (the boot deps) and the scheduler's `tick()` do nothing (one `[paused]` line a minute; webhooks still 200). `groups.paused_at` (Pause / Leave chat on `/admin/groups`): the Group's lines are still logged, Roomie says and posts nothing (no reminders, nudges or reports) and fetches no media; `/help`, `/start`, approval asks and a waiting intro aren't posted there either (Pending Members are still recorded). If the scheduler can't read which Groups are paused, it sends nothing to any Group that tick. Leave chat pauses first, then leaves.
- **Media only when addressed** (`policy.ts` `mediaWanted`, `pipeline.ts` `mediaWantedFor`): a photo is downloaded only when its caption or reply addresses Roomie (@mention, reply, "roomie" or the pet's name) or in the follow-up window; a voice note is transcribed only when it replies to Roomie, @mentions it, is in the follow-up window or setup is waiting on that Admin. Otherwise the adapter passes `skippedMedia` and the pipeline logs "(voice note)" / "(photo) caption" (a caption still goes on as text). When the Gate then decides to answer a skipped photo's caption (#40), the pipeline calls the adapter's `fetchSkippedPhoto`, which asks `mediaWantedFor` again with `gateActed` and only then downloads it, so the agent sees `[photo: <url>]`; a fetched photo's chat line keeps the link ("(photo) [photo: <url>] caption") so "I paid for that" in the window can pass it to a tool. With the pipeline wired in (the boot deps), its answer wins even for addressed media, so a paused Group fetches nothing.
- **WhatsApp allowlist** (`services/whatsapp-access.ts`): `WHATSAPP_ALLOWED_ADDERS` (comma-separated digits with the country code, matched exactly) plus onboarded beta requests' numbers. Anyone else who adds Roomie gets one line pointing at `<APP_URL>/#whatsapp-beta`, Roomie leaves, nothing is stored; the refusal holds for an hour or until someone adds Roomie again. Joined while offline: the adder is the group's creator or a superadmin from the metadata, never the first sender (with an allowlist on and neither known, refused). Both empty = anyone may (the old behaviour). Telegram stays open (the per-adder cap covers it).
- **Admin tools need the ask** (`toolkits/admin-ask.ts`): a manifest's `adminOnly: { <toolId>: { action, target?, fields?, ask } }` marks a tool; the registry runs it for an Admin only when their own current message (`latest` in the RequestContext, set by the pipeline) names the action and the target (with `fields`, as for `set_group_settings`: every field the call changes needs its own words, or for name / purpose / currency / time zone / chattiness its value; "roomie" never counts), else it returns `{ refused: "confirm", ask }` and Roomie asks; "yes" plus the tool's own action within 10 minutes passes, for that exact call only (tool + normalized input; a settings call needs "yes, change the settings" or yes plus words for every field). The action and the target must share a clause (split at punctuation and "and" / "but" / "then"), with no negation before the action or on the target: "don't approve Priya", "approve Priya, not Sam" and "approve Priya and decline Sam" don't approve Sam. Splitwise's tools each need their own verb next to "Splitwise" (status isn't admin-only). No `latest` (Studio, scripts) is refused; `ROOMIE_ADMIN_ASK_OFF=1` turns the check off outside production (test:tools sets it; set it for `mastra:dev`). A new admin-only tool gets an `adminOnly` entry in its manifest, never a list in code.

## Conventions

- Money is **integer cents** everywhere in services and the DB. Tools accept dollars from the model and convert with `toCents()`. The LLM never does math: balances, splits and totals come from services ([ADR 0007](docs/adr/0007-money-is-integer-cents-computed-in-code.md)).
- Every service takes `ctx: Ctx` first. `ctx.memberId` is the sender in chat or the signed-in Member on the dashboard; use it as the default payer/doer/adder. Group-level reads take `GroupCtx`.
- Tools resolve names to ids with `memberIdByName()` and throw a helpful error on unknown names (the model then asks). Money tools return amounts as ready-to-say strings ("$22.50", `expenseSummary`), so the model never formats cents.
- Tools get the Group and sender from `ctxOf(context)` (the RequestContext), never from closures.
- Tools attach buttons by returning `links: [{ text, url }]` (see `cart_checkout` / `dashboardLinks()`); the pipeline collects them from every tool result into `Outgoing.buttons`. Never paste URLs. Buttons need an absolute `APP_URL`. Only for something the person asked to open: routine actions (adds, removes, views, chores done) return none (WhatsApp shows each button as a bare URL line).
- A new Toolkit = a folder with `manifest.ts` + `server.ts` + tools, one line in `toolkits/manifests.ts` and one in `toolkits/registry.ts` (docs/toolkits.md has the checklist). Its Gate criterion, persona lines, nav tab, Home and Settings sections, its Bundle line and report sections come from the manifest and its server entry; never add them to the shell, `gate/jev.ts`, the persona, the scheduler or `services/report.ts`. `toolkits/coupling.test.ts` fails when a Toolkit id is written outside its folder and the listed files.
- The Tricks page (`/g/<id>/tricks`, same page as `/toolkits`) is the one place Tricks are taught or forgotten in the UI; Settings only summarizes and links there. In UI text it's "Tricks", not a store or marketplace (Roomie is a groupmate).
- Dashboard pattern: a page (server) calls `currentMember(groupId)`, reads services through `_components/data.ts` and renders a client screen; writes are server actions in `g/[groupId]/actions.ts` that call a service with the session's Ctx and `revalidatePath`. They return `{ ok, error, status }`, so screens toast errors. Coming-soon Toolkits (Outings, Cooking, Trips, Stickers, Guests, Move-out) are manifest-only stubs: listed on the Toolkits page and refused kindly.
- Schema changes: edit `src/db/schema.ts`, `npm run db:generate`, commit the SQL in `drizzle/`, `npm run db:migrate`. Never `drizzle-kit push`.
- Roomie's replies are 1 to 3 short lines unless someone asks for more. The trigger word is "roomie" (`callsPet`); the @mention always works. There is no other name (ADR 0020).
- Use the glossary's words in code and UI text (Member, Group, Expense, Cart...), and avoid the words it lists under _Avoid_.
## Library notes (versions in package-lock)

- **Mastra v1** (docs in `node_modules/@mastra/core/dist/docs/`, and https://mastra.ai/llms.txt): `createTool({ id, description, inputSchema, execute: async (input, context) => ... })`; `context.requestContext` carries the Group and Member. Agent options (`instructions`, `tools`, ...) can be functions of `{ requestContext }`. Call it as `mastra.getAgentById("roomie").generate(text, { requestContext, memory: { thread, resource } })`. Results use chunk format: `step.toolCalls[i].payload.toolName`.
- **LLM:** Neon AI Gateway through Mastra's model router: `model = "neon/<id>"` in `lib/llm.ts`, which reads `NEON_AI_GATEWAY_BASE_URL` + `NEON_AI_GATEWAY_TOKEN`. Use ids from the branch's `/v1/models`. Embeddings go to `{base}/v1/embeddings` through `ModelRouterEmbeddingModel` with an explicit url (`gatewayEmbedder()`).
- **Jev** is not a chat model: `POST {base}/typesafe/v1/systemone` with typed questions (`gate/jev.ts`). The gateway rate limit (input tokens per minute, account-wide) also covers Jev; on a 429 the Gate falls back to hard triggers.
- **Env:** `.env` must win over the process environment, but Node's `--env-file` and Next never override. `lib/env.ts` loads it with `dotenv({ override: true })`; import it first in every entry point. `mastra dev` tree-shakes side-effect-only imports, so bundled code must call `loadEnv()` (`lib/llm.ts` and `mastra/index.ts` do). **If you see 401 from the gateway, a system env var (e.g. a stale `NEON_AI_GATEWAY_BASE_URL`) is shadowing `.env`.**
- **Observability:** traces go to Postgres (`mastra_ai_spans`, visible in Studio) and to the Mastra platform when `MASTRA_PLATFORM_ACCESS_TOKEN` + `MASTRA_PROJECT_ID` are set. API routes call `mastra.observability.flush()` at the end. PostgresStore writes a span when it starts and updates it when it ends (`batch-with-updates`), and `spanOutputProcessors` mutate the live span, so a processor can change the stored input on end (`mastra/observability.ts`). The root span's `metadata` carries `groupId` / `memberId`; scorer runs are their own traces pointing back with `metadata.targetTraceId`; `mastra_scorers.resourceId` is the Group. The spans table's trigger sets `createdAt` on insert: retention goes by `startedAt`.
- **Voice:** no Whisper on the gateway, so `lib/voice.ts` sends the audio to an audio-capable chat model on the Neon AI Gateway (`STT_MODEL`, default `gemini-3-5-flash`; an OpenRouter-style id with a `/` is ignored) as an `audio_url` data-URL part (the gateway rejects `input_audio`) and uses the text reply as the transcript. Both adapters use it for voice notes whenever the gateway is configured (`voiceAvailable`). No OpenRouter.
- **grammY** (Telegram, `grammy` in `serverExternalPackages`): `new Bot(token, { botInfo })` skips getMe (the webhook builds botInfo from the token's id + `TELEGRAM_BOT_USERNAME`; tests do the same with a fake token). Polling: `bot.start({ allowed_updates, onStart })`; webhook: `webhookCallback(bot, "std/http", { secretToken })`. Outbound calls are captured in tests with `bot.api.config.use(transformer)`; `handleUpdate` + the adapter's `idle()` runs an update to the end. `my_chat_member` (Roomie added/removed) arrives without admin rights; `chat_member` doesn't, so we don't use it. Privacy mode must be off (BotFather `/setprivacy`) to see every group message. Groups upgraded to supergroups change id (`migrate_to_chat_id` -> `groups.moveChat`). Telegram refuses `localhost` URL buttons: the adapter sends those links as text.
- **Baileys** (WhatsApp, `baileys` pinned at `7.0.0-rc14`, in `serverExternalPackages`; docs/whatsapp.md, ADR 0013): `makeWASocket({ version: fetchLatestBaileysVersion(), auth: { creds, keys: makeCacheableSignalKeyStore(keys) }, markOnlineOnConnect: false, syncFullHistory: false, getMessage, cachedGroupMetadata })`. Don't set `shouldSyncHistoryMessage: () => false`: Baileys warns it loses its initial LID mappings. Only `messages.upsert` type `notify` is live; joins arrive as `group-participants.update` (`add` with us in `participants`, `author`/`authorPn` = the adder) or `groups.upsert` (added at creation); participants are `{ id, phoneNumber?, lid? }`; messages carry `key.participantAlt` / `key.remoteJidAlt` (the other form of the sender's id); `sock.signalRepository.lidMapping.getPNForLID(lid)`. Close codes: 401 `loggedOut` (clear, wait for login), 440 `connectionReplaced` (another process: stop), 515 `restartRequired` (right after pairing: reconnect at once), 408 while showing a QR (nobody scanned: stop). `requestPairingCode(digits)` only after the first `qr` event. Tests drive `createWhatsApp` with a fake socket and an in-memory `AuthRows`. One process per session.
- **Env (pacing):** `JOIN_DELAY_MS` (intro after joining, default 60000) and `REPLY_DELAY_MS` (pause after "typing", default 600-1800 ms random on Telegram, 1200-3200 ms on WhatsApp); tests pass 0.
- **Env (WhatsApp, operators):** `WHATSAPP_ENABLED=1` (this process holds the socket), `WHATSAPP_ALLOWED_ADDERS` (who may add Roomie to a group), `ROOMIE_PAUSED=1` (the kill switch), `WA_LOG` (Baileys' log level, default warn), `ROOMIE_OPERATOR_EMAILS` (comma-separated; `/admin/*` is a 404 for anyone else, signed out included: operators sign in at `/signin?next=/admin/beta`; the first address also gets the beta-request DMs on Telegram).
- **Neon Auth** (Managed Better Auth, `@neondatabase/auth`): `lib/auth/server.ts` = `createNeonAuth({ baseUrl, cookies: { secret, sameSite: "lax" } })` (the default `strict` drops the challenge cookie on the cross-site return from Google, so sign-in silently loops); `app/api/auth/[...path]` = `auth.handler()`; browser `createAuthClient()` (no args). The sign-in flow: `GoogleButton` calls `signIn.social({ provider: "google", callbackURL: <origin>/auth/callback?next=<path> })`; `/api/auth/sign-in/social` sets the `session_challenge` cookie; after Google, Neon Auth redirects to the callbackURL with `neon_auth_session_verifier=…` (or `error=…`); `app/auth/callback` (`lib/auth/oauth-return.ts`) exchanges verifier + challenge for the session cookies via `get-session` and 303s to `next`, or to `next?auth_error=<reason>`, which `/signin` and `/claim` show as "Sign-in didn't complete" (`authErrorFrom`; `/` forwards a stray `auth_error` to `/signin`). A missing or off-site `next` is `/signin`. Logs `[auth] oauth return ok|failed: <reason>`; the response carries `x-roomie-auth`. `src/proxy.ts` is the only middleware file (Next loads it from `src/`; a root `proxy.ts` is silently ignored): `auth.middleware({ loginUrl: "/signin" })` guards `/g/*` (its redirect is rewritten to `/signin?next=<path>`; `/signin`'s Google button returns to `/signin?next=…`, which continues to `next` once signed in), and a verifier landing on `/`, `/signin`, `/claim/*` or `/admin/*` is bounced to `/auth/callback` (the SDK middleware never exchanges on its own loginUrl, and must not run on the pages signed-out visitors see). Header `x-roomie-proxy: guard|pass|oauth-return`. Behind Fly, `request.url` is `https://localhost:3000`: never build redirects from it (use relative Locations). Tests: `app/auth/callback/route.test.ts` (fake Neon Auth server). Email+password sign-up is also enabled on the dev Auth branch (Neon's default; the app has no UI for it). `auth.getSession()` returns `{ data }`, user is `data.user`. Users live in `neon_auth` (Neon owns it; never write there). Dev Google uses Neon's shared OAuth keys.
- **Composio** (`@composio/core`, TS SDK v3): `new Composio({ apiKey })`; direct execution (`tools.execute`) needs a toolkit version, so we pass `COMPOSIO_SPLITWISE_VERSION` or `dangerouslySkipVersionCheck`. `connectedAccounts.initiate` is retired for Composio-managed OAuth; use `connectedAccounts.link`. The Splitwise auth config comes from `COMPOSIO_SPLITWISE_AUTH_CONFIG_ID`, else the first Composio-managed one, else one is created (`authConfigs.create("splitwise", { type: "use_composio_managed_auth" })`) and its id logged for `.env`.
- **Next 16:** Mastra, pg, Composio, grammY and Baileys are in `serverExternalPackages`. Read `node_modules/next/dist/docs/` before using Next APIs.

## Commands

```
npm ci
cp .env.example .env          # DATABASE_URL, NEON_AI_GATEWAY_BASE_URL/TOKEN, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET
                              # DATABASE_URL + NEON_AUTH_BASE_URL = the Neon `dev` branch (never production: its URL lives
                              # only in `fly secrets`). A new dev branch is a copy of prod: npx tsx scripts/scrub-dev.ts first
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
npm run test:tools            # every tool against the Neon dev branch in throwaway Groups (Splitwise, Instacart, recipes on fakes), no LLM
npm run evals                 # ~65 chat scenarios through the real Gate + Sonnet; prints a table and the pass rate
                              # (npx tsx scripts/evals.ts --only id,id   or   --baseline to rewrite docs/evals-baseline.md)
```

Adding deps: `npx -y npm@11 install <pkg>` (npm 10 trips on this lockfile; `npm ci` is fine).

## Before you commit

`npm run typecheck` and `npm test` must pass. Test a service with a `*.test.ts` before wiring its tool or page. Each plan step gets its own branch and PR.

## Agent skills

### Issue tracker

GitHub Issues in `sudhersankv/roommate-ops`, via `gh` (never the `upstream` remote). See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
