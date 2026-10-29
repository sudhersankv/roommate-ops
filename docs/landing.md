# The landing page, /help, /signin and the WhatsApp beta

`/` is Roomie's public page; `/help` explains how it works. Both pitch Roomie as **an AI that joins your group chat and learns Tricks**, for any group (roommates are one example among trips, friends, families, teams and clubs). The page is built to be shared, not to explain everything: one headline, one line, two buttons and one chat above the fold; the rest is below.

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

All in `src/app/_landing/landing.tsx` (server components). Client components: `stage.tsx` (the dino watching a chat), `vote-button.tsx`, `share-row.tsx` (copy link) and `beta-form.tsx`.

1. **Hero** (forest band, dark tokens, embers): the logo, "How it works" (`/help`), "Sign in" / "Open dashboard", the headline **"Your group chat finally has a brain."** (`HEADLINE`), one line (`SUBLINE`), **Add to Telegram** (`https://t.me/<TELEGRAM_BOT_USERNAME or imroomiebot>?startgroup=true`, new tab) and **WhatsApp beta** (`#whatsapp-beta`), "Free while in beta.", and one chat (`HERO` in `demos.ts`: an argument about pizza money, settled) that plays on load while the dino reacts.
2. **Demos** ("Moments worth a screenshot."): four chats, each labelled with its Trick and a different kind of group and vibe: a trip splitting the Airbnb (Splitting, hype), a receipt photo (Splitting, chill), the Cart -> Instacart (Groceries, gremlin), the 7-day dish streak with a glowing 🔥 (Chores, hype). Each is followed by a small "Add Roomie to your group" link.
3. **Tricks** (`#tricks`, "Teach it Tricks."): one card per built Trick from `MANIFESTS` (icon, name, `summary`, "Taught by" = the group kinds whose preset includes it), then the coming-soon ones from the catalog, muted (dashed, desaturated, "Coming soon" badge) with an **I want this** button (below).
4. **Vibes** ("Pick its vibe."): six cards, gremlin and deadpan first, each with one line from `ARCHETYPES` (`VIBE_LINES` in `demos.ts`: gremlin's dishes example, `previewOwes` for deadpan, mom, butler and chill, hype's "everyone's square" win). Scrolls sideways on phones.
5. **What's your group?**: Roommates, Trip, Friends, Family, Work, Club (`GROUP_KINDS` in `_landing/tricks.ts`), each with a one-line scenario and the Tricks it starts with, read from `PRESETS` (`toolkits/presets.ts`). "Club" isn't a Group purpose yet, so it shows the `other` preset until a `club` one exists.
6. **How it works** (`#how`): three steps, Add to Telegram, a link to `/help`, then "Speaks when spoken to" (with the dino asleep), "Stays in your group", "A dashboard per group".
7. **Dashboard peek**: three phone frames from `public/landing/dashboard-{money,home,chores}.jpg` (600x1116, `next/image` with fixed dimensions).
8. **WhatsApp beta form** (`#whatsapp-beta`).
9. **Share row**: "Know a group chat that needs this?" with **Send on Telegram** (`https://t.me/share/url?url=<url>&text=<text>`), **Send on WhatsApp** (`https://wa.me/?text=<text> <url>`) and **Copy link**. `<url>` is `APP_URL` when absolute, else `https://roomie.fly.dev`; `<text>` is `SHARE_TEXT` in `_landing/marks.tsx`.
10. Footer: How it works, Privacy, Sign in, GitHub, "Built with Mastra + Neon".

### Words

- User-facing, a Toolkit is a **Trick**; groups **teach** it and Roomie **learns** it ("roomie, learn trips"). Never "toolkit", "capability", "module", "plugin" or "feature" on the page.
- Roomie is "it", an AI and a dino in the group chat. "Pet" is flavor at most two or three times, never the headline or the category.
- Don't market that it picks up how a group talks; that's for people to notice. "It settles in over time" is the most either page may say.
- The glossary's words (Member, Group, Cart, Expense) and none of its _Avoid_ words (no "bot", "assistant", "shopping list"). Never the operator's email.
- No paragraph longer than two lines on a phone.

### Changing the copy

- The chats: `src/app/_landing/demos.ts` (`HERO`, `DEMOS`, `VIBE_LINES`). Roomie's lines follow docs/personality.md's two registers: the task part capitalized with names written properly, the vibe in the aside. Keep the numbers adding up (each demo has its arithmetic in a comment; the receipt split is the service's rule: unclaimed items shared, tax proportional). A line with `win: true` gets the ember ring and makes the dino cheer.
- Headline and sub-line: `HEADLINE` / `SUBLINE` in `landing.tsx`; the title and description in `generateMetadata` (`src/app/page.tsx`); the share image text in `scripts/og-image.ts`. After changing the headline, run `npx tsx scripts/og-image.ts` (it caches Figtree in the temp dir).
- Tricks and presets come from the manifests and `PRESETS`; a new Trick shows up by itself. Its accent color is the `ACCENT` map in `_landing/tricks.ts` (brand green when missing).

### Headline options (Oct 2026)

Chosen: **"Your group chat finally has a brain."** Considered: "Settle it in the group chat." · "Who paid? Ask the group chat." · "The group chat's new favorite member." · "Stop doing group-chat math."

## Motion and color

CSS only (`_landing/landing.css`), transforms and opacity, no layout shift, no animation library. `stage.tsx` adds a few lines of IntersectionObserver so a demo plays when it's on screen.

| What moves | How | With `prefers-reduced-motion: reduce` |
|---|---|---|
| Hero embers (11) and the warm glow behind them | `lp-rise` / `lp-drift`, transform + opacity | Embers rest in the glow, nothing moves |
| Chat lines pop in | Hero: on load. Demos: `Stage` sets `data-state="armed"` (hidden), then `"play"` when 35% visible | Every line shown; no JS timers |
| The dino on each chat | Naps (`sleepy`) until someone says "roomie", perks up (`calm`), `happy` when Roomie answers, the one-shot hop (`useCheer`) on a `win` line | Happy, still (the mascot's own CSS stops its animations) |
| The win | Ember ring pulse on the bubble, 🔥 flickers 6 times with an amber/coral glow | Ring and glow shown, no flicker |
| Trick cards | Lift 4px with a glow in the Trick's accent on hover / tap | Glow and border only |
| Hype vibe card | Confetti bits wiggle on hover | Static confetti |
| "Noted ✨" after a vote | Ring pulse and a six-dot spark | The badge, no spark |

The ember palette (`--ember-1/2/3`: `#ffb547` amber, `#ff7a59` coral, `#ff4f9a` hot pink) is only for wins, the streak and the share card. Without JS, everything is simply visible. No new images; the LCP is the headline.

## Trick votes, end to end

1. The coming-soon cards come from the catalog (`status: "coming-soon"`). `page.tsx` reads the counts (`trickVoteCounts`, an empty map if the database can't be reached) and passes them down; a count shows only from **5** (`SHOW_COUNT_FROM`).
2. **I want this** calls the server action `voteTrick` (`_landing/actions.ts`) -> `voteForTrick` in `src/services/trick-votes.ts`: only coming-soon ids; the IP (`fly-client-ip`, else the first `x-forwarded-for`) becomes `hashIp` (the same HMAC as beta requests); **one vote per Trick per address a day** (a repeat is a quiet success, not stored) and **12 votes an hour per address** (`WindowLimiter`, in memory); then one row in `trick_votes` (`id`, `trick_id`, `created_at`, `ip_hash`; migration 0008). Logs `[votes] +1 <trick>`.
3. The button turns into "Noted ✨" and the browser remembers it (`localStorage`, `roomie:trick-vote:<id>`).
4. Reading them: `select trick_id, count(*) from trick_votes group by 1 order by 2 desc`.

## /help

`src/app/help/page.tsx`, one page with a sticky jump bar: What Roomie is · Add it to a group (the Telegram link; WhatsApp: the beta form) · What happens when it joins (intro, one setup question, the defaults) · Talking to it ("roomie" or its name, @mention, a reply; quiet otherwise; `/pet`) · Tricks (each built Trick with three things to say from its manifest's `gate.examples`; coming-soon ones muted, linking to the votes) · The dashboard ("roomie send me the dashboard", one link per person; Members, Admins, Pending) · Vibes (the six taglines from `ARCHETYPES`) · Privacy (links `/privacy`, "forget me") · **FAQ**: 14 questions as `<details>` (no JS), with the same answers as FAQPage JSON-LD (each entry's `text`). Keep `a` and `text` saying the same thing.

## A beta request, end to end

1. The form posts to the server action `requestBeta` (`_landing/actions.ts`), which reads the IP (`fly-client-ip`, else the first `x-forwarded-for`) and the user agent and calls `submitBetaRequest` in `src/services/beta.ts`.
2. The service: a filled honeypot field (`website`, invisible) gets a fake success and nothing is stored; zod validates (name, email, group size `2 | 3-4 | 5-8 | 9-15 | 16+`, purpose = the Group purposes, an optional phone with 7-15 digits stored as `+digits`, notes up to 1000 characters); then at most **3 requests per IP per hour** (`WindowLimiter`, in memory, so a restart forgets); then one row in `beta_requests` (migration 0007) with an HMAC of the IP (`ip_hash`, keyed by `NEON_AUTH_COOKIE_SECRET`), never the IP itself.
3. After the response (`after()`), the operator is told: the Account of the first `ROOMIE_OPERATOR_EMAILS` address -> its Member in a Telegram Group -> `channel_user_id` -> `telegramChannel().sendPrivate(...)` with a three- or four-line summary and an "Open beta requests" button (`APP_URL/admin/beta`). If there's no Telegram token, no such Member, or the DM fails (the operator never pressed Start on @imroomiebot), it logs `[beta] … ` with the same summary instead, so it shows in `fly logs`.
4. The visitor sees "Got it. You'll hear from us within a day or two." There is no mailer: the operator writes back by hand.
5. The operator works the list at `/admin/beta` (status: new / contacted / onboarded / declined; `setBetaStatus` checks the operator again). The phone links to `wa.me`.

For the DM to arrive, the operator must be a Member of some Telegram Group with Roomie (claimed with their operator Google account, so the Account exists) and must have pressed Start in a DM with the bot once.

## Tests

`src/services/beta.test.ts` (validation, honeypot, the limit, the summary, the DM and every fallback), `src/services/trick-votes.test.ts` (coming-soon only, one per Trick per address, the hourly limit, a failed insert, the count threshold), `src/lib/auth/oauth-paths.test.ts`, and `src/app/auth/callback/route.test.ts` (the proxy's `/signin?next=` redirect and pass-throughs). Screens: `design/screens/landing-tricks-{mobile,desktop,reduced-motion}.jpeg`, `design/screens/help-mobile.jpeg`.
