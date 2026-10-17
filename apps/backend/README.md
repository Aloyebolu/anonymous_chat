# Anonymous adult chat — Baileys WhatsApp runtime

This is a small vertical slice for an adults-only anonymous chat service. The core
application is channel-independent. Two channel drivers are wired in: a local web
driver for development, and a Baileys WhatsApp driver for real use.

```
Core application
   ↓
generic channel port  (src/ports/channels.ts)
   ↓
 ┌───────────────────────────┬────────────────────────────────────┐
 │ Web channel adapter       │ WhatsApp channel adapter           │
 │ (src/infrastructure/      │ (src/infrastructure/channels/      │
 │  channels/web)            │  whatsapp)                         │
 └───────────────────────────┴────────────────────────────────────┘
                             ↓
                    Baileys socket bridge → WhatsApp
```

Baileys types never leave the WhatsApp infrastructure folder. The application and domain
layers do not import Baileys.

## Commands

```sh
npm install
npm test
npm run build
npm run dev
```

`npm run dev` uses `tsx` to execute `src/main.ts` in safe local development mode.

## Running without touching WhatsApp

`npm run dev` uses an isolated `.data/development/` database and starts only the
web simulator. It does not connect to Telegram or WhatsApp, so you can exercise
onboarding, matching, chat, points, commands, and admin tools locally without
deploying or messaging real users.

```sh
npm run dev
```

Open two browser tabs:

- Tab A: `http://localhost:3000/` with user `alice`
- Tab B: `http://localhost:3000/` with user `bob`

The user field in the header switches identity (each tab becomes a separate participant).
Interactions are clickable buttons in the web UI.

Walk through the flow in each tab:

1. Send `/start`.
2. Click `I am 18+`.
3. Click a gender.
4. Send your country as text (e.g. `Nigeria`).
5. Click a preference.
6. Send `/find`.

When the second tab also sends `/find`, both tabs receive
`You have been matched. Say hello!`. Messages typed in either tab appear in the other.

The web channel, admin API, and Telegram Mini App API share one HTTP port.
Set `PORT` on Render; locally, the default is `3000` (`WEB_PORT` remains available
as a local override).

Development mode does not load the production `.data/db.json` or WhatsApp auth
state. To test with a real Telegram bot, explicitly set `ENABLE_TELEGRAM=1` and
`TELEGRAM_BOT_TOKEN` in the local environment file; use a separate test bot since
this sends real bot traffic. WhatsApp requires the separate explicit
`ENABLE_WHATSAPP=1` flag and uses development-only auth state. Leave both flags
at `0` for web-only development.

## Running with WhatsApp

`npm start` explicitly selects production mode and uses `.data/` for its
configured database and WhatsApp auth. Use `DISABLE_TELEGRAM=1` or
`DISABLE_WHATSAPP=1` to disable a production channel.

Expected output:

```text
Web chat available at http://localhost:3000/
Starting WhatsApp…
WhatsApp auth state is stored in .data/whatsapp-auth.
QR code available. Scan the QR code with WhatsApp:
<scannable QR code>
Connected to WhatsApp.
```

Then from WhatsApp:

1. Send `/start` to the linked number.
2. Tap `I am 18+`, or reply `1`.
3. Answer the gender prompt (`1`/`2`/`3` or the label).
4. Send your country as plain text (e.g. `Nigeria`).
5. Answer the preference prompt.
6. Send `/find`.

Conversation controls:

- `/next` ends the current conversation and re-enters matchmaking.
- `/leave` ends the current conversation.
- `/report` records a report and ends the current conversation.
- `/block` blocks the counterpart and ends the current conversation.
- `/help` lists commands.
- `/end` ends a conversation (same action as `/leave`).
- `/vip` shows the points-funded VIP offer.
- `/app` opens the Telegram Mini App when `TELEGRAM_MINI_APP_URL` is configured.
- `/points` shows your persisted balance. Valid chat messages earn one point each,
  up to 20 points per UTC day. Duplicate delivery of the same channel message
  does not award points twice. Points are not redeemable yet.

## Telegram Mini App

The Mini App is served by the frontend at `/miniapp`; its backend API is mounted
under `/api/miniapp/` on the shared HTTP port. Set `TELEGRAM_MINI_APP_URL` to the
HTTPS frontend URL and `NEXT_PUBLIC_MINI_APP_API` to the HTTPS backend origin
(or use `NEXT_PUBLIC_WEB_API` for all backend routes). Set the
Telegram bot's Mini App domain in BotFather, deploy both services behind HTTPS,
then send `/app` to the bot. The backend verifies Telegram `initData` and rejects
expired or invalid signatures before loading or changing account data.

Users can edit their display name, name visibility, age, country, language, and
match preferences. They can earn 3 points for a daily check-in and a one-time
5-point profile-completion reward, in addition to chat points. VIP costs 100
points for 30 days and enables strict preference matching, match priority,
partner-gender visibility, and gender switching. The current VIP checkout uses
points; other payment methods are a future extension.

The two matched users never see each other's phone numbers through the application;
messages are relayed through their `CommunicationIdentity`.

## Human moderators

The admin dashboard at `/admin` can grant moderator access to an existing user
account. The grant creates a separate, high-entropy moderator token, shown once;
share it privately with the moderator. It does not grant access to the full admin
dashboard. The moderator signs in at `/moderator` and can opt in/out, choose the
connected Telegram/WhatsApp channel for assignments, and shadow-ban or restore a
reported account. Admins can revoke the role and rotate access by granting again.

To connect both Telegram and WhatsApp to one moderator account, the moderator
opens `/moderator`, creates a short-lived link code, and sends `/modlink CODE` to
the bot from the other account. The bot attaches that verified channel identity
to the same moderator account. A code expires after 10 minutes and can be used
once.

After ordinary user-to-user matches are considered, each waiting user can be
assigned to an available moderator who has no active conversation. The user gets
the normal connected-chat message; the moderator gets a support-assignment
message on their selected channel. If no moderator is available, the regular
queue and AI fallback continue to work. The AI path remains explicit that the
partner is an assistant.

## Where WhatsApp credentials live

The Baileys auth state is written to `.data/whatsapp-auth/` (via
`useMultiFileAuthState`). This directory is listed in `.gitignore` and must not be
committed. Because credentials are persisted, you only need to scan the QR code the
first time (or after logging out of the linked device).

## What is still in-memory / deliberately mocked

- `InMemoryUserRepository`, `InMemoryMatchQueueRepository`, and
  `InMemoryConversationRepository` are the current persistence. They are constructed in
  `src/main.ts` and can be swapped for a real implementation behind the same ports.
- Reports and blocks are not persisted anywhere yet; they only end the current
  conversation.
- WhatsApp native buttons are not used. The Baileys button payload is unstable across
  versions, so the adapter always renders interactions as a numbered text fallback. The
  driver records pending actions per chat and translates numeric or label replies back
  into generic `action` events.
- The web driver is a plain HTTP + SSE server with an embedded HTML page. It is meant
  for local development, not deployment.

## Baileys-specific limitations

- The installed Baileys version is invoked through `makeWASocket`, `useMultiFileAuthState`,
  `fetchLatestBaileysVersion`, and `DisconnectReason`. When the connection closes for a
  reason other than `loggedOut`, the bridge reconnects.
- Interactive button/list messages are not relied on; the numbered text fallback is the
  supported path.
- Group chats are not handled; only 1:1 chats (`@s.whatsapp.net` JIDs) are processed by
  the mapper.

## Tests

`npm test` covers:

- the existing channel-independent vertical slice via `FakeChannelDriver`;
- Baileys-shaped payloads becoming generic `InboundEvent`s;
- generic outbound text and interactions becoming the appropriate WhatsApp operations
  (text fallback for interactions);
- the WhatsApp driver translating numeric and label replies back into actions;
- the web driver mapping HTTP requests into generic events and rejecting malformed
  requests.

No file outside `src/infrastructure/channels/whatsapp/` imports Baileys.

## Getting started

You do **not** need to know any commands to start. Just say anything (`hi` is fine)
and the bot will walk you through the flow: 18+ confirmation → gender → country →
match preference → `/find`. Any `/command` shown in a message is clickable in the web
UI, and the command palette above the input gives you one-click access to all of them.

## Matchmaking and persistence

- Matchmaking runs in two stages. First, `MatchmakingService.join` tries a strict
  match: both users' gender and country preferences must be satisfied by the other.
  If nothing fits, the user is added to a queue with a timestamp.
- Every 15 seconds a sweep runs. Any queued user who has been waiting ≥ 2 minutes
  has their own preferences relaxed — they will accept the next available queued
  partner whose own preferences still accept them. This gives you the classic
  "wait 2 minutes for a match" behavior without a bot silently dropping your request.
- The queue, users, profiles, eligibility, drafts, and conversations are persisted as
  JSON to `.data/db.json` (atomic write via a `.tmp` file + rename). This is a
  development persistence layer. Swapping it for PostgreSQL later only requires new
  implementations of the `UserRepository`, `MatchQueueRepository`, and
  `ConversationRepository` ports, plus a one-line change in `src/main.ts`.
- To reset locally, delete `.data/db.json`.

### Commands

## Matchmaking (v1)

Scoring is driven by `MATCHMAKING_CONFIG` in `src/application/matchmaking.ts`. Everything
is tunable from that single const — do not hard-code heuristics elsewhere.

How a pass works (`MatchmakingService.runMatchingPass`):

1. Every queued user is scored against every other queued user. A directional score
   is computed from the viewer's perspective:
   - `preferredGenderMatch` / `preferredGenderMismatch`
   - `preferredCountryMatch` / `preferredCountryMismatch`
   - `priorityTier * priorityTier` — reserved for future paid tiers, 0 for free users
2. The pair score adds a wait bonus (per second of the longer-waiting party) and jitter.
3. A pair is only rejected when **all** of the following hold:
   - the queue has at least `lowSupplyThreshold` users, and
   - neither party has waited `relaxPreferencesAfterMs` or more.
   Otherwise preferences become soft — the pair is still scored and ranked, but nothing
   is filtered out.
4. Candidates are sorted: relaxed pairs first (oldest wait first), then by score.
   They are matched greedily, so nobody appears in two conversations.
5. `MatchmakingService.sweep()` runs the same pass on a timer (every 5 s from `main.ts`),
   so a newly arriving user can be picked up by someone who is already waiting.

Tuning examples:

- Make matching more permissive: lower `lowSupplyThreshold` won't help — raise it. Or
  lower `relaxPreferencesAfterMs`.
- Make matching more strict: raise `lowSupplyThreshold`, raise `relaxPreferencesAfterMs`,
  lower `preferredGenderMatch`.
- Introduce paid priority: set `priorityTier` on a user's `UserProfile` (e.g. via an
  admin action or Stripe webhook). Tier 1 = +250 points, tier 2 = +500, etc.

## Admin dashboard

`npm run dev` also exposes the admin API on the same port as the web channel:
`http://localhost:3000/api/` (or the configured `PORT` / `WEB_PORT`). The web
channel uses `/api/stream` and `/api/send`; the admin API uses its own routes such
as `/api/state`, `/api/reports`, and `/api/watch`. The Telegram Mini App API is
mounted under `/api/miniapp/` when a bot token is configured. The dashboard shows:

- **Waiting room** — every queued user, their channel and how long they've been waiting.
- **Active sessions** — every active conversation and its participants by channel/external id.
- **All users** — channel, eligibility, profile, and current status (idle / waiting / in chat).
- **Matchmaking config** — the live values of `MATCHMAKING_CONFIG`.

The dashboard polls `/api/state` every 2 seconds. Set `ADMIN_TOKEN` to protect all
admin API routes with a Bearer token. Enter the same value in the admin page; it is
kept in `sessionStorage` for that browser tab session. Production startup fails if
the token is missing. Local development remains available without a token and logs
a warning.

## Health check

The web driver exposes `GET /health` returning `{ "ok": true, "clients": <n> }` where `n`
is the number of open SSE connections. Useful for uptime checks.
