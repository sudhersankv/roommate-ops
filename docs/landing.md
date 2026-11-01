# The landing page, /help, /signin and the WhatsApp beta

`/` is Roomie's public page; `/help` explains how it works. Both pitch Roomie as **the roommate who actually keeps track** (ADR 0015): one apartment's group chat, rent, splits, groceries, chores and the landlord. Other kinds of group get one line. The page is built to be shared, not to explain everything: one headline, one line, two buttons and one chat above the fold; the rest is below. Nothing on either page says AI, bot, brain, assistant or smart, and there is no vibe picker (ADR 0020); `src/app/_landing/words.test.ts` checks.

## Routes

| Route | What | Code |
|---|---|---|
| `/` | The landing page, for everyone. Signed in, the nav's "Sign in" becomes "Open dashboard" (`/app`). A stray `?auth_error=` is sent on to `/signin`. | `src/app/page.tsx`, `src/app/_landing/` |
| `/help` | How Roomie works, for a new person in the apartment's chat, and the FAQ. Public, indexable (canonical `/help`, FAQPage JSON-LD). | `src/app/help/` |
| `/app` | Where a signed-in person lands: the Group they were last in (or their first), else "no groups yet" with the paste-a-Claim-link form. Signed out: `/signin`. | `src/app/app/page.tsx` |
| `/signin` | Google button, paste a Claim link, the "Sign-in didn't complete" alert. `?next=` is where to go afterwards. Signed in: straight to `next` (default `/app`; `/` is never a `next`). "New here?" links `/` and `/help`. | `src/app/signin/page.tsx` |
| `/privacy` | What Roomie keeps, per Group, "forget me", who else sees it. Static. The one page allowed to say "AI model" and "AI Gateway", because it names what the code calls (audit B4). | `src/app/privacy/page.tsx` |
| `/admin/beta` | Operators only (`ROOMIE_OPERATOR_EMAILS`, 404 for everyone else, `noindex`): the beta requests, newest first, with a status. | `src/app/admin/beta/` |

## Sign-in paths

- `src/proxy.ts` guards `/g/*` and `/admin/*` with `auth.middleware({ loginUrl: "/signin" })` and rewrites the SDK's bare redirect to `/signin?next=<the page you wanted>`. `/`, `/help`, `/signin` and `/claim/*` pass signed out; a verifier landing on `/`, `/signin` or `/claim/*` is bounced to `/auth/callback`.
- `lib/auth/oauth-paths.ts`: `SIGNIN_PATH`, `APP_PATH`, `safeNext` (anything off-site becomes `/signin`), `afterSignIn` (never back to `/signin` or `/`; `/app` by default), `signInPath(next)`.
- `GoogleButton` defaults to returning to `/signin`; on `/signin` it returns to `/signin?next=…`, so a failed sign-in shows its reason there and a good one continues to `next`. Claim links still return to `/claim/<token>`.
- `currentMember()` redirects signed-out visitors to `/signin?next=/g/<id>`.

## The landing page, section by section

All in `src/app/_landing/landing.tsx` (server components). Client components: `stage.tsx` (the dino watching a chat), `vote-button.tsx`, `share-row.tsx` (copy link) and `beta-form.tsx`.

1. **Hero** (forest band, dark tokens, embers): the logo, "How it works" (`/help`), "Sign in" / "Open dashboard", the headline **"The roommate who actually keeps track."** (`HEADLINE`), the one line (`SUBLINE`: "A tiny dino that lives in your group chat. Rent, splits, groceries, chores and the landlord's emails: it keeps track, so nothing gets buried.", the launch video's words), **Add it on Telegram** (primary: it works today; `https://t.me/<TELEGRAM_BOT_USERNAME or imroomiebot>?startgroup=true`, new tab) and **WhatsApp waitlist** (`#whatsapp-beta`), "Free while in beta.", and one chat (`HERO` in `demos.ts`: Apt 4B, with a rent line, a split and the landlord's reply in one scroll) that plays on load while the dino reacts.
2. **Channels** (`#channels`, "Where it lives"): WhatsApp (Beta, "Ask to join" → the form) · Telegram ("Works today") · Discord and iMessage (Soon, dashed, an **I want this** each). The channel votes reuse `trick_votes` with the ids `channel:discord` / `channel:imessage` (`SOON_CHANNELS` in `services/trick-votes.ts`).
3. **The launch video** (`#video`, `VIDEO_TITLE` "Nothing gets buried."): the 2-minute vertical video in a phone frame, served from our own `public/landing/roomie-video.mp4` (`VIDEO_SRC`: 720x1280, H.264, `+faststart`, about 9.7 MB; made from the 1080p master with `ffmpeg -vf scale=720:1280 -crf 27 -preset slow -c:a aac -b:a 96k -movflags +faststart`) with the end card as its poster (`roomie-video-poster.jpg`). `preload="none"`, so nothing downloads until someone presses play, and no YouTube title or channel bar, beside one line about it and the two things it says: "Just talk to it." and "Never calls anyone out." (who owes what is a private reminder, until it's paid), then the two buttons.
4. **Demos** ("Five apps and a group mom. Or Roomie.", `DEMOS_TITLE`; the line under it names the five apps). Five chats from `DEMOS`, one per bucket, all in Apt 4B, each with its Trick chip (the name from ADR 0015: Money, Lease Inbox, Groceries, House, Money) and its arithmetic in a comment (`demos.test.ts` checks it):
   1. *Nobody has to be that guy anymore.* (Money): the rent line for the group, then the viewer's DM "You owe Maya $800 for rent" with a Venmo button, "paid", square. The DM lines carry `dm: true` and render "to you, privately" with a dashed brand-green edge (`.lp-dm-bubble`). This is the settle-nudge story's title (the private pay link is the point), so there is no sixth demo.
   2. *The landlord, handled.* (Lease Inbox): "roomie the sink's leaking, tell them" → "Sent: reported the leaking kitchen sink." → a day later "Landlord: plumber Tuesday 10-12. I'll remind you Monday."
   3. *It notices before you run out.* (Groceries): the morning "Probably low: milk, dish soap. Add them?" → "yes" → "Added both as shared. Cart's at 4." → Sam's oat milk, 5.
   4. *The 7-day dish streak.* (House): the streak in the one (chill) voice with a glowing 🔥, then the morning line.
   5. *Who had pizza? Ask the room.* (Money): a Poll bubble (`poll` line shape: question, options with tallies and voters, "4 of 4 answered", bars that grow in CSS) and the split: $36 three ways, $12 each.
   After the grid: "Say “roomie” and ask. Or message it privately: “what do I owe?”" and the two buttons again.
5. **Tricks** (`#tricks`, "Teach it Tricks. They snap on." / "Roommates start with the stack."): the built Tricks from `MANIFESTS` as a stack of chunky blocks in their accents (studs on top, icon, name, `summary`, and from `sm` "<nav label> page"), the first manifest at the bottom, with the dino sitting on top (a `Stage`), and "Say “roomie, learn lease inbox” in the chat, or tap Teach on the dashboard." under it (the stack is sticky on `lg`). Beside it ("Waiting to snap on. Vote for what it learns next."), the coming-soon ones from `CATALOG` in catalog order as greyed, dashed blocks (ghost studs, a "Soon" tag) with an **I want this** button: two columns on phones and `lg`, three on `sm`. The names, summaries and the Soon list are the manifests' (`src/toolkits/`): renaming Splitting to Money or adding Guests and Move-out there changes the page by itself. Under the section, one line: **"Not roommates? It works for trips and friends too."** (`OTHER_GROUPS_LINE`). The six-card "What's your group?" grid and the "Pick its vibe" section are gone.
6. **How it works** (`#how`): three steps (add it to the group chat; answer one question; then just talk to it, with the dashboard "if you want it"), the two buttons, a link to `/help`, then "Never nags in the group" (with the dino asleep: money and chore reminders are private; in the group it speaks when spoken to, plus one morning post), "Stays in your group" (who owes what is said privately), "A dashboard per group".
7. **Dashboard peek** ("And a dashboard, if you want it."): three phone frames from `public/landing/dashboard-{money,home,chores}.jpg` (600x1116, `next/image` with fixed dimensions). To be retaken with the read-first dashboard (issue #28, story 28).
8. **WhatsApp beta form** (`#whatsapp-beta`, "Want it on WhatsApp?" / "WhatsApp is in a small beta. Join the waitlist and we'll add you.").
9. **Share row**: "Know an apartment chat that needs this?" with **Send on WhatsApp** (`https://wa.me/?text=<text> <url>`), **Send on Telegram** (`https://t.me/share/url?url=<url>&text=<text>`) and **Copy link**. `<url>` is `APP_URL` when absolute, else `https://tryroomie.me`; `<text>` is `SHARE_TEXT` in `_landing/marks.tsx`: "Adding this to our apartment chat. It remembers who paid 🦖".
10. Footer: How it works, Privacy, Sign in, "Free while in beta." No stack, no GitHub link.

### Words

- User-facing, a Toolkit is a **Trick**; groups **teach** it and Roomie **learns** or **forgets** it ("roomie, learn lease inbox"). Never "toolkit", "capability", "module", "plugin", "feature" or "enable" on the page.
- Roomie is "it", a roommate and a dino in the group chat. Never AI, bot, brain, assistant or smart; "pet" is flavour at most (`/pet` in `/help`). No vibes, no name field: one voice (ADR 0020).
- Don't market that it picks up how a group talks; that's for people to notice. "It settles in over time" is the most either page may say.
- The glossary's words (Member, Group, Cart, Expense, DM, Poll, Landlord) and none of its _Avoid_ words. Never the operator's email.
- No paragraph longer than two lines on a phone.
- `src/app/_landing/words.test.ts` scans the landing, `/help`, `/privacy` and `page.tsx` sources (comments and imports stripped), the Onboarding copy, every manifest's name / summary / longDescription / persona and `channels/text.ts`'s lines for `AI, bot, brain, assistant, smart, toolkit, feature, enable, vibe` (whole words, any case). The only allowlist is `/privacy`'s "AI model(s)" and "AI Gateway".

### Changing the copy

- The chats: `src/app/_landing/demos.ts` (`APARTMENT`, `HERO`, `DEMOS`). Roomie's lines follow docs/personality.md's two registers: the task part capitalized with names written properly, the aside in the one voice (`ARCHETYPES.chill`). Keep the numbers adding up: each chat has its arithmetic in a comment and `demos.test.ts` asserts it. A line with `win: true` gets the ember ring and makes the dino cheer; `dm: true` is a private line; a `{ poll, options, of, time }` line is a Poll.
- Headline and sub-line: `HEADLINE` / `SUBLINE` / `DEMOS_TITLE` / `OTHER_GROUPS_LINE` in `landing.tsx`; the title and description in `generateMetadata` (`src/app/page.tsx`); the share image text in `scripts/og-image.ts`. After changing the headline, run `npx tsx scripts/og-image.ts` (it caches Figtree in the temp dir).
- Tricks come from the manifests; a new Trick shows up by itself. Its accent color is the `ACCENT` map in `_landing/tricks.ts` (brand green when missing; today's ids and ADR 0015's are both in it). Whether a Trick is "On from the start for roommates" (in `/help`) comes from `PRESETS.roommates`.

### Headline (Oct 2026)

**"The roommate who actually keeps track."** (ADR 0015). Before it: "Your group chat finally has a brain."

## Motion and color

CSS only (`_landing/landing.css`), transforms and opacity, no layout shift, no animation library. `stage.tsx` adds a few lines of IntersectionObserver so a demo plays when it's on screen.

| What moves | How | With `prefers-reduced-motion: reduce` |
|---|---|---|
| Hero embers (11) and the warm glow behind them | `lp-rise` / `lp-drift`, transform + opacity | Embers rest in the glow, nothing moves |
| Chat lines pop in | Hero: on load. Demos: `Stage` sets `data-state="armed"` (hidden), then `"play"` when 35% visible | Every line shown; no JS timers |
| The dino on each chat | Naps (`sleepy`) until someone says "roomie", perks up (`calm`), `happy` when Roomie answers (a Poll counts), the one-shot hop (`useCheer`) on a `win` line | Happy, still (the mascot's own CSS stops its animations) |
| The giant peeking dino (`peek.tsx`, `peek-plan.ts`) | One dino for the page, about 60% of a chat's size (up to 320 px), hidden behind the hero and demo chats. Every 5-9 s (first at 2.6 s) it goes to the most visible chat it didn't just leave, walks to an edge with room on screen (hero: right or top; demos: their outer side; phones: the top, else none), crouches, pops ~40% of itself out with an overshoot and a lean, tilts its head at you, squints happily when caught and ducks back in 160 ms (3.2 s in all). Hovering a chat calls it over (4 s cooldown). Web Animations API, transforms only, `pointer-events: none`, waits while the tab is hidden | Not rendered |
| The win | Ember ring pulse on the bubble, 🔥 flickers 6 times with an amber/coral glow | Ring and glow shown, no flicker |
| A Poll's bars | `scaleX` from 0 to the option's share (`--w`) as the line lands (`lp-poll-grow`) | The final bars |
| Trick blocks | `Stage` arms the stack (blocks hidden), then at 35% visible each block snaps on from 40px above, bottom first (`lp-snap-on`, 0.42 s, 0.16 s apart: the last lands at ~1 s); the dino goes sleepy -> calm (0.3 s) -> happy with a hop (1.05 s); then a sheen (`lp-sheen`) and a glow in each block's accent (`lp-glow-once`, opacity) run up the stack once. Hover / tap: the block lifts 4px and its accent glow shows (an `::after`, opacity) | The stacked final frame, the dino happy; hover shows the glow without the lift |
| Coming-soon blocks and the Soon channels | Lift 4px with a glow in the Trick's accent on hover / tap, a little less grey | Glow and border only |
| "Noted ✨" after a vote | Ring pulse and a six-dot spark | The badge, no spark |

The ember palette (`--ember-1/2/3`: `#ffb547` amber, `#ff7a59` coral, `#ff4f9a` hot pink) is only for wins, the streak and the share card. A DM line has a dashed edge in the brand green (`--color-owed`). Without JS, everything is simply visible. No new images; the LCP is the headline.

## Trick votes, end to end

1. The coming-soon cards come from the catalog (`status: "coming-soon"`); the Soon channels from `SOON_CHANNELS` (`channel:discord`, `channel:imessage`). `page.tsx` reads the counts (`trickVoteCounts`, an empty map if the database can't be reached) and passes them down; a count shows only from **5** (`SHOW_COUNT_FROM`).
2. **I want this** calls the server action `voteTrick` (`_landing/actions.ts`) -> `voteForTrick` in `src/services/trick-votes.ts`: only coming-soon ids and the Soon channel ids (`votableTrickIds`); the IP (`fly-client-ip`, else the first `x-forwarded-for`) becomes `hashIp` (the same HMAC as beta requests); **one vote per id per address a day** (a repeat is a quiet success, not stored) and **12 votes an hour per address** (`WindowLimiter`, in memory); then one row in `trick_votes` (`id`, `trick_id`, `created_at`, `ip_hash`; migration 0008). Logs `[votes] +1 <id>`.
3. The button turns into "Noted ✨" and the browser remembers it (`localStorage`, `roomie:trick-vote:<id>`).
4. Reading them: `select trick_id, count(*) from trick_votes group by 1 order by 2 desc`.

## /help

`src/app/help/page.tsx`, one page with a sticky jump bar: What Roomie is (the two ADR 0015 lines, the four Tricks, "Not roommates? …") · Add it to the group chat (WhatsApp: the beta form, first; Telegram: the link; Discord and iMessage soon) · What happens when it joins (intro, the one setup question: what for, currency, city; the defaults; the Join link) · Talking to it ("roomie", @mention, a reply; the one morning post; one line on DMs: "what do I owe", "remind me Friday"; `/pet`) · Tricks (each built Trick with three things to say from its manifest's `gate.examples`, "On from the start for roommates." from `PRESETS`; coming-soon ones muted, linking to the votes) · The dashboard (the Join link, "roomie send us the dashboard"; Members, Admins, Pending) · Privacy (links `/privacy`, "forget me") · **FAQ**: 16 questions as `<details>` (no JS) in `src/app/help/faq.tsx`, with the same answers as FAQPage JSON-LD (each entry's `text`). `faq.test.ts` renders each `a` and compares its words with `text`, so keep them saying the same thing. New since ADR 0015: "Does it nag people about money in the group?" (no: the private Settle nudge), "Does it work on iMessage?" ("Soon, through a relay we run."), "Does the landlord know it's a shared inbox?" ("Yes. Every email it sends says it's the residents' shared inbox and names who asked."). Gone: the vibe/name question.

## A beta request, end to end

1. The form posts to the server action `requestBeta` (`_landing/actions.ts`), which reads the IP (`fly-client-ip`, else the first `x-forwarded-for`) and the user agent and calls `submitBetaRequest` in `src/services/beta.ts`.
2. The service: a filled honeypot field (`website`, invisible) gets a fake success and nothing is stored; zod validates (name, email, group size `2 | 3-4 | 5-8 | 9-15 | 16+`, purpose = the Group purposes, an optional phone with 7-15 digits stored as `+digits`, notes up to 1000 characters); then at most **3 requests per IP per hour** (`WindowLimiter`, in memory, so a restart forgets); then one row in `beta_requests` (migration 0007) with an HMAC of the IP (`ip_hash`, keyed by `NEON_AUTH_COOKIE_SECRET`), never the IP itself.
3. After the response (`after()`), the operator is told by email (`services/operator-mail.ts`): from `notify@<AGENTMAIL_DOMAIN>` (an AgentMail inbox made once, idempotent by its client id) to `OPERATOR_EMAIL` (a Fly secret, comma-separated: the first is To, the rest CC; personal addresses never go in the code or on the site), subject "Roomie beta request: <name>", the summary and a link to `/admin/beta` through `/signin`. Without `OPERATOR_EMAIL` or an AgentMail key, the old path: a Telegram DM to the first `ROOMIE_OPERATOR_EMAILS` Account's Telegram Member, else a `[beta] …` log line in `fly logs`. Every counted "I want this" vote is emailed the same way ("Roomie vote: <Trick> (n so far)"), in the background.
4. The visitor sees "Got it. You'll hear from us within a day or two." The operator writes back by hand.
5. The operator works the list at `/admin/beta` (status: new / contacted / onboarded / declined; `setBetaStatus` checks the operator again). The phone links to `wa.me`.

For the DM to arrive, the operator must be a Member of some Telegram Group with Roomie (claimed with their operator Google account, so the Account exists) and must have pressed Start in a DM once.

## Tests

`src/app/_landing/demos.test.ts` (every chat's arithmetic and the five buckets), `src/app/_landing/words.test.ts` (the forbidden words), `src/app/help/faq.test.ts` (the FAQ invariant, the trust questions), `src/services/beta.test.ts` (validation, honeypot, the limit, the summary, the DM and every fallback), `src/services/trick-votes.test.ts` (coming-soon and channel ids only, one per id per address, the hourly limit, a failed insert, the count threshold), `src/lib/auth/oauth-paths.test.ts`, and `src/app/auth/callback/route.test.ts` (the proxy's `/signin?next=` redirect and pass-throughs). Screens: `design/screens/tricks-section-{desktop,mobile,reduced-motion}.jpeg`, `design/screens/tricks-page-upcoming{,-drawer}.jpeg` (the in-app Tricks page and the More drawer), `design/screens/help-mobile.jpeg`; to be retaken for the roommates-first page (issue #28).
