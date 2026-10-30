# The landing page, /help, /signin and the WhatsApp beta

`/` is Roomie's public page; `/help` explains how it works. The line is **"Roomie keeps the receipts."** The page is built to be shared, not to explain everything: one headline, one line, two buttons and one chat above the fold; the rest is below.

## Positioning (Oct 2026, applies to every word on `/` and `/help`)

- **What Roomie is:** the groupmate that handles the shared-living admin for roommates (who paid, what we're out of, whose turn it is, and soon the leasing office) so nobody has to be "that roommate" who asks, reminds and nags.
- **What it is not:** not a general AI assistant, not a companion or a pet, not "smart" or "a brain". Never pitch intelligence; pitch the chores it takes off people.
- **Emotional core:** it takes the awkward jobs. The humor comes from the real pains (the $4 left on read, zero milk, the dish tower, the email nobody read); facts and money are always exact and plain.
- **Audience:** roommates first, trips second. Other groups live in "What's your group?".
- **Tricks:** it learns what your group needs. Tricks snap on like blocks, and each one adds its own page to the dashboard.
- **Page story, top to bottom:** the line → the pains ("Sound familiar?") → adding it to the chat → the fixes one by one (groceries, splitting, chores) → Tricks → the dashboard → try it.
- **Headlines** name a pain or what Roomie does about it. No generic feature headings ("Features", "Powerful", "Smart splitting").
- **CTAs:** "Add to Telegram", "WhatsApp beta", "Try it". Never "Get started", "Unlock", "Supercharge".
- Say what it does and what it fixes. Never models, internals, "the AI never does math", or how anything works underneath (the `/help` privacy paragraph and its FAQ twin are the exception: they say where messages go, as `/privacy` does). Don't claim Discord or Slack, or that it learns how you talk (docs/personality.md).
- No emojis in UI chrome (headings, labels, icons, tiles): lucide icons through `ToolkitIcon` / `lucide-react`. Emojis inside the fake chats are fine.
- The Cart has no prices: no estimates or totals for it anywhere (a receipt's total is a receipt, not the Cart).

## Routes

| Route | What | Code |
|---|---|---|
| `/` | The landing page, for everyone. Signed in, the nav's "Sign in" becomes "Open dashboard" (`/app`). A stray `?auth_error=` is sent on to `/signin`. | `src/app/page.tsx`, `src/app/_landing/` |
| `/help` | How Roomie works, for a new person, and the FAQ. Public, indexable (canonical `/help`, FAQPage JSON-LD). | `src/app/help/` |
| `/app` | Where a signed-in person lands: the Group they were last in (or their first), else "no groups yet" with the paste-a-Claim-link form. Signed out: `/signin`. | `src/app/app/page.tsx` |
| `/signin` | Google button, paste a Claim link, the "Sign-in didn't complete" alert. `?next=` is where to go afterwards. Signed in: straight to `next` (default `/app`; `/` is never a `next`). "New here?" links `/` and `/help`. | `src/app/signin/page.tsx` |
| `/privacy` | What Roomie keeps, per Group, "forget me", who else sees it. Static. | `src/app/privacy/page.tsx` |
| `/admin/beta` | Operators only (`ROOMIE_OPERATOR_EMAILS`, 404 for everyone else, `noindex`): the beta requests, newest first, with a status. | `src/app/admin/beta/` |

## Sign-in paths

- `src/proxy.ts` guards `/g/*` and `/admin/*` with `auth.middleware({ loginUrl: "/signin" })` and rewrites the SDK's bare redirect to `/signin?next=<the page you wanted>`. `/`, `/help`, `/signin` and `/claim/*` pass signed out; a verifier landing on `/`, `/signin` or `/claim/*` is bounced to `/auth/callback`.
- `lib/auth/oauth-paths.ts`: `SIGNIN_PATH`, `APP_PATH`, `safeNext` (anything off-site becomes `/signin`), `afterSignIn` (never back to `/signin` or `/`; `/app` by default), `signInPath(next)`.
- `GoogleButton` defaults to returning to `/signin`; on `/signin` it returns to `/signin?next=…`, so a failed sign-in shows its reason there and a good one continues to `next`. Claim links still return to `/claim/<token>`.
- `currentMember()` redirects signed-out visitors to `/signin?next=/g/<id>`.

## The landing page, section by section

All in `src/app/_landing/landing.tsx` (server components). Client components: `stage.tsx` (`Stage`, the dino watching a chat, and `Reveal`, the same play-once switch without a dino), `vote-button.tsx`, `share-row.tsx` (copy link) and `beta-form.tsx`.

1. **Hero** (forest band, dark tokens, embers): the logo, "How it works" (`/help`), "Sign in" / "Open dashboard", the headline **"Roomie keeps the receipts."** (`HEADLINE`), the line (`SUBLINE`: "Add it to your roommate group chat. It tracks who paid, keeps the grocery list, runs the chore chart, and does the asking, so nobody has to be that roommate."), **Add to Telegram** (`https://t.me/<TELEGRAM_BOT_USERNAME or imroomiebot>?startgroup=true`, new tab) and **WhatsApp beta** (`#whatsapp-beta`), "Free while in beta.", and one chat (`HERO` in `demos.ts`: Apt 4B arguing about pizza money, settled) that plays on load while the dino reacts.
2. **Sound familiar?** (`PAINS`): four cards, each a pain line, a fix line with a lucide icon, and a small illustration built from divs and lucide icons that plays once (`Reveal`):
   - "Day 21 of asking for $4. They liked the request." → "Roomie keeps the tab and hands out the pay buttons." (a thumbs-up pops onto the $4 request)
   - "Three cartons of eggs. Zero milk." → "One shared Cart. Say it in the chat, it's on the list." (three cartons drop in next to an empty dashed "milk?" slot)
   - "The sink is a Jenga tower." → "Chores rotate, and Roomie calls out whose turn it is." (a stack of plates wobbles once)
   - "The water shut off mid-shower. The email was in your inbox." → "Soon: Roomie reads the leasing office's emails for you." (Coming soon; the unread badge counts up to 47 by stepping a column of numbers)
3. **How it works** (`#how`, "Add it to the group chat. One question and it's set."): three steps ("Add Roomie to the group" / "Tell it what the group's for" / "It learns the right Tricks"), Add to Telegram and the `/help` link, next to one chat (`ADD_FLOW`): the first two lines of `introMessage()` (`src/onboarding.ts`), Maya's "roommates! LA, USD, chill vibe pls", and `learnedLine(PRESETS.roommates)`. The dino drops onto the window's edge and hops when the learned line lands; the four Trick chips pop in under it. Below: "Mostly naps" (Say "roomie", @mention it or reply to it. It chimes in only when it's clearly needed.), "Stays in your group", "A dashboard per group".
4. **The fixes** ("Say it in the chat. Roomie keeps track."): four chats in this order, each labelled with its Trick: a photo of a handwritten list added to the Cart, then the Instacart list (Groceries, gremlin; the photo's caption addresses Roomie, no prices), the receipt photo (Splitting, chill; after Roomie's reply three per-person totals land under the chat, Dev $23.12, Maya $9.53, Sam $9.53 = $42.18), the trip's Airbnb (Splitting, hype), and the chart (Chores, hype: Maya's 7-in-a-row win line, then "roomie who's slacking?" answered with `chartLine()` from `src/services/chores.ts`). Each is followed by a small Add to Telegram link.
5. **See it in 90 seconds** (`Video`): rendered only when both `public/landing/roomie.mp4` and `public/landing/roomie-poster.jpg` exist (checked with `existsSync` at render). A click-to-play `<video controls preload="none" playsInline>` with the poster, 16:9, no autoplay. Add `public/landing/roomie.vtt` too and it gets a captions track.
6. **Tricks** (`#tricks`, "Teach it Tricks. They snap on." / "Each Trick brings its own page on the dashboard."): the built Tricks from `MANIFESTS` as a stack of rounded blocks in their accents (`accentOf`) with studs, their lucide icon, `summary` and the page they bring (`pageOf`: the manifest's nav label); Splitting is the base. They stack in from the bottom when scrolled to, then the coming-soon `NEXT_TRICK` (Lease stuff) snaps on top, dashed, with a short accent flare. Then the coming-soon cards from the catalog, Lease stuff first with an accent ring and its color, the rest muted (dashed, desaturated, "Coming soon" badge), each with **I want this** (below).
7. **What's your group?**: Roommates first as the wide, primary card, then Trip, Friends, Family, Work, Club (`GROUP_KINDS` in `_landing/tricks.ts`), each with a one-line scenario and the Tricks it starts with, read from `PRESETS` (`toolkits/presets.ts`). "Club" isn't a Group purpose yet, so it shows the `other` preset until a `club` one exists.
8. **Vibes** ("It does the nagging. You pick the voice."): six cards, gremlin and deadpan first, each with one line from `ARCHETYPES` (`VIBE_LINES` in `demos.ts`). Scrolls sideways on phones.
9. **Dashboard peek** ("Every group gets a dashboard." / "Balances, the Cart, the chore chart, and a page for every Trick you teach."): three phone frames from `public/landing/dashboard-{money,home,chores}.jpg` (600x1116, `next/image` with fixed dimensions). Checked Oct 2026: they show no Cart prices (Home shows "7 things in the Cart"), so no retake is needed for that.
10. **WhatsApp beta form** (`#whatsapp-beta`).
11. **Try it** (the share card's layout): "Roomie keeps the receipts. Try it." with Add to Telegram and WhatsApp beta; under a separator, "Know a group chat that needs this?" with **Send on Telegram** (`https://t.me/share/url?url=<url>&text=<text>`), **Send on WhatsApp** (`https://wa.me/?text=<text> <url>`) and **Copy link**. `<url>` is `APP_URL` when absolute, else `https://roomie.fly.dev`; `<text>` is `SHARE_TEXT` in `_landing/marks.tsx` ("Adding this to our group chat. It keeps the receipts 🦖").
12. Footer: How it works, Privacy, Sign in, GitHub, "Built with Mastra + Neon".

### Adding the video

Put a 16:9 MP4 (H.264, about 90 seconds) at `public/landing/roomie.mp4` and a 1280x720 JPEG at `public/landing/roomie-poster.jpg`; optionally English captions at `public/landing/roomie.vtt`. Commit them and deploy: the section appears after the demos by itself. Remove either file and it disappears again.

### Words

- User-facing, a Toolkit is a **Trick**; groups **teach** it and Roomie **learns** it ("roomie, learn trips"). Never "toolkit", "capability", "module", "plugin" or "feature" on the page.
- Roomie is "it", the groupmate (a dino) in the group chat. Not "an AI", not "a brain", not an assistant; "pet" only for the `/pet` command.
- Don't market that it picks up how a group talks; that's for people to notice. "It settles in over time" is the most either page may say.
- The glossary's words (Member, Group, Cart, Expense) and none of its _Avoid_ words (no "bot", "assistant", "shopping list"). Never the operator's email.
- No paragraph longer than two lines on a phone.

### Changing the copy

- The chats: `src/app/_landing/demos.ts` (`HERO`, `ADD_FLOW`, `DEMOS`, `VIBE_LINES`). `ADD_FLOW` and the chores chart call the real `introMessage`, `learnedLine` and `chartLine`, so they follow the code; don't paste their text. A receipt demo's `totals` must add up to its receipt. Roomie's lines follow docs/personality.md's two registers: the task part capitalized with names written properly, the vibe in the aside. Keep the numbers adding up (each demo has its arithmetic in a comment; the receipt split is the service's rule: unclaimed items shared, tax proportional). A line with `win: true` gets the ember ring and makes the dino cheer.
- Headline and sub-line: `HEADLINE` / `SUBLINE` in `landing.tsx`; the title and description in `generateMetadata` (`src/app/page.tsx`); the share image text in `scripts/og-image.ts`. After changing the headline, run `npx tsx scripts/og-image.ts` (it caches Figtree in the temp dir).
- Tricks and presets come from the manifests and `PRESETS`; a new Trick shows up by itself. Its accent color is the `ACCENT` map in `_landing/tricks.ts` (brand green when missing).

### Headline options (Oct 2026)

Chosen: **"Roomie keeps the receipts."** (the founder's line). Before it: "Your group chat finally has a brain." (dropped: it pitches intelligence). Considered earlier: "Settle it in the group chat." · "Who paid? Ask the group chat." · "Stop doing group-chat math."

## Motion and color

CSS only (`_landing/landing.css`), transforms and opacity, no layout shift, no animation library. `stage.tsx` adds a few lines of IntersectionObserver (`usePlayOnView`) so a chat or an illustration plays once when it's on screen: `data-state` is `static` (SSR, reduced motion, no IntersectionObserver: the final frame), `armed` (hidden, waiting) or `play`. Every new animation is under ~1.2 s and none loops (only the embers and the mascot's idle do).

| What moves | How | With `prefers-reduced-motion: reduce` |
|---|---|---|
| Hero embers (11) and the warm glow behind them | `lp-rise` / `lp-drift`, transform + opacity | Embers rest in the glow, nothing moves |
| Chat lines pop in | Hero: on load. Demos: `Stage` sets `data-state="armed"` (hidden), then `"play"` when 35% visible | Every line shown; no JS timers |
| The dino on each chat | Naps (`sleepy`) until someone says "roomie", perks up (`calm`), `happy` when Roomie answers, the one-shot hop (`useCheer`) on a `win` line | Happy, still (the mascot's own CSS stops its animations) |
| The win | Ember ring pulse on the bubble, 🔥 flickers 6 times with an amber/coral glow | Ring and glow shown, no flicker |
| Sound familiar? illustrations | Thumbs-up pops onto the $4 request; three cartons drop in by the "milk?" slot; the plate stack wobbles once; the unread badge steps 1 → 47 | Thumbs-up on, cartons landed, plates still, badge at 47 |
| Add-flow chat | The dino drops onto the window's edge, hops (`useCheer`) as the learned line lands; the four Trick chips pop in one by one | Dino on the edge, every line and chip shown |
| Receipt demo totals | After Roomie's reply, three lines run down from the chat and Dev $23.12, Maya $9.53, Sam $9.53 land | Lines and totals shown |
| Trick blocks | Stack in from the bottom, then Lease stuff snaps on top with a short accent flare | Stacked, Lease stuff on top with a soft ring |
| Coming-soon cards | Lift 4px with a glow in the Trick's accent on hover / tap (Lease stuff keeps its color and ring) | Glow and border only |
| Hype vibe card | Confetti bits wiggle on hover | Static confetti |
| "Noted ✨" after a vote | Ring pulse and a six-dot spark | The badge, no spark |

The ember palette (`--ember-1/2/3`: `#ffb547` amber, `#ff7a59` coral, `#ff4f9a` hot pink) is only for wins, the streak and the share card. Without JS, everything is simply visible. No new images; the LCP is the headline.

## Trick votes, end to end

1. The coming-soon cards come from the catalog (`status: "coming-soon"`). `page.tsx` reads the counts (`trickVoteCounts`, an empty map if the database can't be reached) and passes them down; a count shows only from **5** (`SHOW_COUNT_FROM`).
2. **I want this** calls the server action `voteTrick` (`_landing/actions.ts`) -> `voteForTrick` in `src/services/trick-votes.ts`: only coming-soon ids; the IP (`fly-client-ip`, else the first `x-forwarded-for`) becomes `hashIp` (the same HMAC as beta requests); **one vote per Trick per address a day** (a repeat is a quiet success, not stored) and **12 votes an hour per address** (`WindowLimiter`, in memory); then one row in `trick_votes` (`id`, `trick_id`, `created_at`, `ip_hash`; migration 0008). Logs `[votes] +1 <trick>`.
3. The button turns into "Noted ✨" and the browser remembers it (`localStorage`, `roomie:trick-vote:<id>`).
4. Reading them: `select trick_id, count(*) from trick_votes group by 1 order by 2 desc`.

## /help

`src/app/help/page.tsx`, one page with a sticky jump bar ("Roomie keeps the receipts." under the title; the same positioning as the landing page, "mostly naps", Teach / Forget on the dashboard's Tricks page, the closing "Roomie keeps the receipts. Try it." with Add to Telegram and WhatsApp beta): What Roomie is · Add it to a group (the Telegram link; WhatsApp: the beta form) · What happens when it joins (intro, one setup question, the defaults) · Talking to it ("roomie" or its name, @mention, a reply; quiet otherwise; `/pet`) · Tricks (each built Trick with three things to say from its manifest's `gate.examples`; coming-soon ones muted, linking to the votes) · The dashboard ("roomie send me the dashboard", one link per person; Members, Admins, Pending) · Vibes (the six taglines from `ARCHETYPES`) · Privacy (links `/privacy`, "forget me") · **FAQ**: 14 questions as `<details>` (no JS), with the same answers as FAQPage JSON-LD (each entry's `text`). Keep `a` and `text` saying the same thing.

## A beta request, end to end

1. The form posts to the server action `requestBeta` (`_landing/actions.ts`), which reads the IP (`fly-client-ip`, else the first `x-forwarded-for`) and the user agent and calls `submitBetaRequest` in `src/services/beta.ts`.
2. The service: a filled honeypot field (`website`, invisible) gets a fake success and nothing is stored; zod validates (name, email, group size `2 | 3-4 | 5-8 | 9-15 | 16+`, purpose = the Group purposes, an optional phone with 7-15 digits stored as `+digits`, notes up to 1000 characters); then at most **3 requests per IP per hour** (`WindowLimiter`, in memory, so a restart forgets); then one row in `beta_requests` (migration 0007) with an HMAC of the IP (`ip_hash`, keyed by `NEON_AUTH_COOKIE_SECRET`), never the IP itself.
3. After the response (`after()`), the operator is told: the Account of the first `ROOMIE_OPERATOR_EMAILS` address -> its Member in a Telegram Group -> `channel_user_id` -> `telegramChannel().sendPrivate(...)` with a three- or four-line summary and an "Open beta requests" button (`APP_URL/admin/beta`). If there's no Telegram token, no such Member, or the DM fails (the operator never pressed Start on @imroomiebot), it logs `[beta] … ` with the same summary instead, so it shows in `fly logs`.
4. The visitor sees "Got it. You'll hear from us within a day or two." There is no mailer: the operator writes back by hand.
5. The operator works the list at `/admin/beta` (status: new / contacted / onboarded / declined; `setBetaStatus` checks the operator again). The phone links to `wa.me`.

For the DM to arrive, the operator must be a Member of some Telegram Group with Roomie (claimed with their operator Google account, so the Account exists) and must have pressed Start in a DM with the bot once.

## Tests

`src/services/beta.test.ts` (validation, honeypot, the limit, the summary, the DM and every fallback), `src/services/trick-votes.test.ts` (coming-soon only, one per Trick per address, the hourly limit, a failed insert, the count threshold), `src/lib/auth/oauth-paths.test.ts`, and `src/app/auth/callback/route.test.ts` (the proxy's `/signin?next=` redirect and pass-throughs). Screens: `design/screens/landing-receipts-{mobile,desktop,reduced-motion}.jpeg` (360 wide / 1280x800, full page; no horizontal scroll at 360), the older `landing-tricks-*.jpeg`, `design/screens/help-mobile.jpeg`.
