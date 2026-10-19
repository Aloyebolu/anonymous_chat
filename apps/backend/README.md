# Anonymous adult chat — WhatsApp integrations

This is an adults-only anonymous chat service. The core application is channel-independent.
The WhatsApp integration supports Baileys for compatibility and an official Cloud API
adapter for production deployments.

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
                    Baileys socket bridge or Cloud API → WhatsApp
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
The backend uses PostgreSQL in both development and production. Copy
`.env.example` to `src/.env`, start the local database, then apply migrations:

```sh
cp .env.example src/.env
docker compose up -d db
npm run db:migrate
```

The Compose service stores its data in a named volume, so restarting or
recreating the container does not remove the local database. For deployment,
configure `DATABASE_URL` with your managed PostgreSQL connection string. The
application applies any pending SQL migrations on startup; `npm run db:migrate`
can also be used explicitly. Migrations are ordered files in
`src/infrastructure/persistence/migrations/`; add a new numbered `.sql` file
for each schema change rather than editing a migration that has already shipped.

Types, constants, and API route paths used across both apps live in
`../../packages/shared`. Add shared domain or API definitions there instead of
duplicating them in either app.

### Rich text and fallback matchmaking

Backend text and interaction messages use HTML as their portable rich-text
format. Telegram sends it with HTML parse mode; WhatsApp converts supported
markup and entities to readable plain text; the web client renders a safe,
limited set of formatting tags. Escape user- or model-generated text before
including it in HTML so it remains literal text rather than markup.

Matchmaking always tries user-to-user matches first. Waiters remain in the
regular queue until the configured AI fallback threshold; at that point an
available moderator is tried first, followed by AI when no moderator can take
the chat.

## Running without touching WhatsApp

`npm run dev` starts only the web simulator and uses the PostgreSQL database
configured by `DATABASE_URL`. It does not connect to Telegram or WhatsApp, so
you can exercise onboarding, matching, chat, points, commands, and admin tools
locally without messaging real users.

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

Baileys auth state remains separate under `.data/`. To test with a real
Telegram bot, explicitly set `ENABLE_TELEGRAM=1` and
`TELEGRAM_BOT_TOKEN` in the local environment file; use a separate test bot since
this sends real bot traffic. WhatsApp requires the separate explicit
`ENABLE_WHATSAPP=1` flag and uses development-only auth state. Leave both flags
at `0` for web-only development.

## WhatsApp production safety

Baileys is an unofficial WhatsApp Web integration. Its use can violate WhatsApp's
terms and a linked number can be disconnected or banned; rate limiting does not
remove that risk. Do not link a personal or otherwise important number. The code
paces Baileys sends to one per second, bounds its pending send queue, and uses
exponential reconnect backoff, but these are operational safeguards, not a ban
guarantee. In production, WhatsApp is disabled unless `ENABLE_WHATSAPP=1` is set.

The official Cloud API adapter is available but is not selected by default. To
switch when a WhatsApp Business Platform number and Meta credentials are ready,
configure `WHATSAPP_PROVIDER=cloud-api`, `ENABLE_WHATSAPP=1`,
`WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`,
`WHATSAPP_CLOUD_VERIFY_TOKEN`, `META_APP_SECRET`, and
`WHATSAPP_CLOUD_API_VERSION`. Configure Meta's webhook callback as
`https://<backend-host>/api/webhooks/whatsapp`, subscribe to `messages`, and use
the same verify token. The adapter verifies Meta's HMAC webhook signature,
deduplicates webhook message IDs in-process, supports text, interactive replies
and common media, and enforces the 24-hour customer-service window for
free-form sends. Messages outside that window need an approved template; this
adapter intentionally does not send templates.

Review WhatsApp Business Platform policies and account eligibility for the
service's use case before launch. The Cloud API lowers the risk associated with
an unofficial linked-device client, but does not exempt a business from Meta's
messaging, consent, or content rules.

## Running with WhatsApp

`npm start` explicitly selects production mode and uses `DATABASE_URL` for
PostgreSQL. Set `ENABLE_WHATSAPP=1` to explicitly enable WhatsApp, and
`DISABLE_WHATSAPP=1` to override it. Baileys remains the default provider unless
`WHATSAPP_PROVIDER=cloud-api` is selected.

With `WHATSAPP_PROVIDER=baileys`, expected output:

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

The web chat accepts images, video, audio, and documents up to 5 MB and renders
forwarded attachments inline when the browser supports the format. Telegram and
WhatsApp adapters translate supported media types to their native send APIs;
WhatsApp inbound media is downloaded from the original Baileys message when a
forward requires portable bytes.
Adapters expose message deletion where their transport supports it; the settings
interaction uses deletion to replace the previous menu instead of stacking prompts.

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

While assigned, the moderator console shows the active participant and exposes
moderator-only profile editing plus formatted welcome, kindness, and safety notes.
The profile endpoint only permits edits to the participant in that moderator's
active support conversation.

## Where WhatsApp credentials live

The Baileys auth state is written to `.data/whatsapp-auth/` (via
`useMultiFileAuthState`). This directory is listed in `.gitignore` and must not be
committed. Because credentials are persisted, you only need to scan the QR code the
first time (or after logging out of the linked device).

## What is still in-memory / deliberately mocked

- The production app uses PostgreSQL repositories. Message logs remain in-memory
  and are intentionally not persisted.
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
- Every 5 seconds a sweep runs. Any queued user who has been waiting ≥ 2 minutes
  has their own preferences relaxed — they will accept the next available queued
  partner whose own preferences still accept them. This gives you the classic
  "wait 2 minutes for a match" behavior without a bot silently dropping your request.
- The queue, users, profiles, eligibility, drafts, conversations, reports,
  points, and moderation events are persisted in PostgreSQL. Set `DATABASE_URL`;
  the backend applies pending SQL migrations automatically on startup.

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
