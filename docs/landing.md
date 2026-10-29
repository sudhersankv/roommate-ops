# The landing page, /signin and the WhatsApp beta

`/` is Roomie's public page for people who are signed out. Signed in, `/` is what it always was: your last (or first) Group's dashboard, or "No groups yet" with the paste-a-Claim-link form.

## Routes

| Route | What | Code |
|---|---|---|
| `/` | The landing page, for everyone. Signed in, the nav's "Sign in" becomes "Open dashboard" (`/app`). A stray `?auth_error=` is sent on to `/signin`. | `src/app/page.tsx`, `src/app/_landing/` |
| `/app` | Where a signed-in person lands: the Group they were last in (or their first), else "no groups yet" with the paste-a-Claim-link form. Signed out: `/signin`. | `src/app/app/page.tsx` |
| `/signin` | Google button, paste a Claim link, the "Sign-in didn't complete" alert. `?next=` is where to go afterwards. Signed in: straight to `next` (default `/app`; `/` is never a `next`). | `src/app/signin/page.tsx` |
| `/privacy` | What Roomie keeps, per Group, "forget me", who else sees it. Static. | `src/app/privacy/page.tsx` |
| `/admin/beta` | Operators only (`ROOMIE_OPERATOR_EMAILS`, 404 for everyone else, `noindex`): the beta requests, newest first, with a status. | `src/app/admin/beta/` |

## Sign-in paths

- `src/proxy.ts` guards `/g/*` and `/admin/*` with `auth.middleware({ loginUrl: "/signin" })` and rewrites the SDK's bare redirect to `/signin?next=<the page you wanted>`. `/`, `/signin` and `/claim/*` pass signed out; a verifier landing on any of them is bounced to `/auth/callback`.
- `lib/auth/oauth-paths.ts`: `SIGNIN_PATH`, `APP_PATH`, `safeNext` (anything off-site becomes `/signin`), `afterSignIn` (never back to `/signin` or `/`; `/app` by default), `signInPath(next)`.
- `GoogleButton` defaults to returning to `/signin`; on `/signin` it returns to `/signin?next=…`, so a failed sign-in shows its reason there and a good one continues to `next`. Claim links still return to `/claim/<token>`.
- `currentMember()` redirects signed-out visitors to `/signin?next=/g/<id>`.

## Sections

All in `src/app/_landing/landing.tsx` (server components; the only client component is the form). In order:

1. **Hero** (forest band, always dark tokens): the logo, "Sign in", the headline, **Add to Telegram** (`https://t.me/<TELEGRAM_BOT_USERNAME or imroomiebot>?startgroup=true`, Telegram's "pick a group" link, new tab) and **Join the WhatsApp beta** (`#whatsapp-beta`), "Free while in beta.", and a chat that plays once on load with the dino on top.
2. **Demos**: four fake chats (splitting, receipt photo, Cart -> Instacart, chores + streak + the morning nudge).
3. **Vibes**: the same two messages answered by a chill and a hype Roomie, then the six vibes as chips. Both come from `ARCHETYPES` in `lib/personality.ts` (examples, labels, taglines, accessories), so editing an archetype updates the page.
4. **How it works**: three steps, then "speaks when spoken to", "stays in your group", "a page per group".
5. **Dashboard peek**: three phone frames from `public/landing/dashboard-{money,home,chores}.jpg` (cropped from `design/screens/real-*.jpeg`, 600x1116, `next/image` with fixed dimensions).
6. **WhatsApp beta form** (`#whatsapp-beta`), then the footer (Privacy, Sign in, GitHub, "Built with Mastra + Neon").

Motion is CSS only (`_landing/landing.css`): the hero's lines pop in on load; the demos' lines pop in as they scroll into view where the browser has scroll-driven animations (static elsewhere). Nothing moves with `prefers-reduced-motion`. The share image is `public/landing/og.png`; rebuild it with `npx tsx scripts/og-image.ts` after a brand change.

### Changing the copy

- The chats: `src/app/_landing/demos.ts` (`HERO`, `DEMOS`, `VIBE_DEMO`). Keep Roomie's lines in its voice (docs/personality.md): short, facts first, lowercase for chill, no lists, and only answering when someone said "roomie". Keep the numbers adding up (the receipt split is the service's rule: unclaimed items shared, tax proportional).
- Headlines, steps and facts: `landing.tsx` (`STEPS`, `FACTS`, the section titles). Metadata (title, description, Open Graph): `generateMetadata` in `src/app/page.tsx`.
- Use the glossary's words (Member, Group, Cart, Expense) and none of its _Avoid_ words (no "bot", "assistant", "shopping list"). Never put the operator's email anywhere on the page.

## A beta request, end to end

1. The form posts to the server action `requestBeta` (`_landing/actions.ts`), which reads the IP (`fly-client-ip`, else the first `x-forwarded-for`) and the user agent and calls `submitBetaRequest` in `src/services/beta.ts`.
2. The service: a filled honeypot field (`website`, invisible) gets a fake success and nothing is stored; zod validates (name, email, group size `2 | 3-4 | 5-8 | 9-15 | 16+`, purpose = the Group purposes, an optional phone with 7-15 digits stored as `+digits`, notes up to 1000 characters); then at most **3 requests per IP per hour** (`WindowLimiter`, in memory, so a restart forgets); then one row in `beta_requests` (migration 0007) with an HMAC of the IP (`ip_hash`, keyed by `NEON_AUTH_COOKIE_SECRET`), never the IP itself.
3. After the response (`after()`), the operator is told: the Account of the first `ROOMIE_OPERATOR_EMAILS` address -> its Member in a Telegram Group -> `channel_user_id` -> `telegramChannel().sendPrivate(...)` with a three- or four-line summary and an "Open beta requests" button (`APP_URL/admin/beta`). If there's no Telegram token, no such Member, or the DM fails (the operator never pressed Start on @imroomiebot), it logs `[beta] … ` with the same summary instead, so it shows in `fly logs`.
4. The visitor sees "Got it. You'll hear from us within a day or two." There is no mailer: the operator writes back by hand.
5. The operator works the list at `/admin/beta` (status: new / contacted / onboarded / declined; `setBetaStatus` checks the operator again). The phone links to `wa.me`.

For the DM to arrive, the operator must be a Member of some Telegram Group with Roomie (claimed with their operator Google account, so the Account exists) and must have pressed Start in a DM with the bot once.

## Tests

`src/services/beta.test.ts` (validation, honeypot, the limit, the summary, the DM and every fallback), `src/lib/auth/oauth-paths.test.ts`, and `src/app/auth/callback/route.test.ts` (the proxy's `/signin?next=` redirect and pass-throughs).
