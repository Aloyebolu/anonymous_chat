# Project continuation notes

This file is the handoff point for any human or AI continuing the project. Read it
first, then `apps/backend/ROADMAP.md` and the relevant README. Keep this updated
when architecture, commands, setup, or milestone status changes.

## Product intent

An anonymous, adults-only chat product with Telegram as the primary experience,
plus web and WhatsApp adapters. The product should feel safe, welcoming, and
polished. Planned product work includes earned points, meaningful point rewards,
a Telegram Mini App, robust onboarding, a useful command set, and clear bot replies.

## Architecture constraints

- Backend core: `apps/backend/src/application` and `domain`.
- Channel adapters: `apps/backend/src/infrastructure/channels`.
- Ports are the boundary between core and infrastructure.
- Baileys code stays in its WhatsApp infrastructure directory.
- User-facing backend copy belongs in `apps/backend/src/application/messages.ts`;
  frontend copy belongs in `apps/frontend/lib/constants.ts`.
- Current persistence is a single-process JSON database at `.data/db.json`.
- Do not put secrets in source. Telegram requires `TELEGRAM_BOT_TOKEN`.

## Current state and known gaps

- Web, WhatsApp, and Telegram adapters exist; Telegram bridge/mapper have
  unfinished sections and must be audited before claiming feature parity.
- `/start` now resumes onboarding for incomplete profiles and welcomes completed
  profiles instead of resetting their flow.
- Telegram startup no longer falls back to an embedded credential. Set
  `TELEGRAM_BOT_TOKEN` in the runtime environment.
- `npm run dev` is safe local mode: isolated `.data/development` persistence,
  localhost-only web/admin/API binds, stub AI, and no Telegram/WhatsApp connection
  unless explicitly enabled with `ENABLE_TELEGRAM=1` / `ENABLE_WHATSAPP=1`.
  `npm start` selects production mode and `.data` persistence.
- Points now have a persisted JSON ledger, `/points`, idempotent message awards,
  a 20 point per UTC day chat cap, Mini App daily check-in/profile completion
  rewards, and points-funded VIP.
- Telegram Mini App launch/auth, profile settings, and mobile UI are implemented.
  Deployment still requires HTTPS, BotFather domain setup, and the variables in
  the backend/frontend `.env.example` files.
- VIP costs 100 points for 30 days and provides strict preference matching,
  match priority, partner-gender visibility, and gender switching.
- `/help` is state-aware, keeper profiles affect matchmaking ranking, operator
  sessions can be created in the admin UI, and the backend runs a matchmaking
  sweep immediately after startup. `/leave` also cancels queue membership.
- Text moderation now includes a sliding-window message limit and spam heuristics;
  moderation event metadata is persisted (bounded retention) and visible in admin.
  Reports group by reported account, and admin can shadow-ban/unban users. Shadow-
  banned users are ignored and excluded from matchmaking.
- Admin routes require Bearer auth when `ADMIN_TOKEN` is configured. Production
  refuses to start the admin API without it; local development warns and remains
  open when unset. Configure a strong token before deployment.
- Human moderators can be granted from the admin user list. Each receives a
  separate least-privilege token and uses `/moderator` to opt in/out, select
  channels, link another account with a 10-minute `/modlink` code, and shadow-ban
  or restore accounts. Eligible waiting users are assigned to idle moderators
  before AI fallback; moderators receive an assignment on the opted-in channel,
  while users see the normal connected-chat message. Revocation ends active chats.
- Treat any previously committed Telegram token as compromised: rotate it using
  BotFather and keep the replacement only in secret configuration.
- The Next.js UI now includes a Telegram Mini App at `/miniapp`.

## Next implementation sequence

1. Audit remaining Telegram update mapping and reply-to context; confirm useful
   responses and inline interactions across the supported command set.
2. Add point history and redemption options, then introduce payment providers
   behind a provider-neutral VIP checkout interface (Telegram Stars/cards).
3. Finish deployment configuration for the Mini App, with HTTPS origins, domain
   setup, durable multi-process persistence, and operational monitoring.
4. Expand privacy, account, language, and safety controls based on user needs.

## Handoff discipline

Record each completed milestone, changed contracts, environment variables,
verification run and result, and any unresolved risk below. Do not mark a feature
complete based only on a plan or mock screen.

### Change log

- 2026-10-17: Added continuation guide; fixed `/start` resume behavior and removed
  the source-embedded Telegram bot credential fallback.
- 2026-10-17: Telegram polling startup errors are caught and retried with backoff;
  added persisted, capped points earning and `/points` across available drivers.
- 2026-10-17: Added state-aware `/help`, a configurable keeper score boost, a
  lightweight operator session flow, and immediate startup matchmaking sweep.
- 2026-10-17: Added text spam/rate checks, moderation event retention and admin
  review, report grouping, and shadow-ban enforcement.
- 2026-10-17: Added static Bearer-token protection for admin APIs, session-scoped
  token entry in the admin UI, and a production startup requirement.
- 2026-10-17: Added Telegram Mini App API with signed `initData` validation,
  profile settings, daily/profile rewards, point-funded VIP, strict matching,
  VIP partner-gender visibility, and VIP gender switching. Added `/app`, `/vip`,
  `/end`, connected-match guidance, setup docs, and environment examples.
- 2026-10-17: Added safe local development mode with isolated persistence, local
  HTTP binding, stub AI, explicit live-channel opt-ins, and a production start
  entry point. Backend build and local startup check passed.
- 2026-10-17: Added moderator tokens, availability and channel selection, secure
  channel linking, automatic overflow matches, support notifications, and
  shadow-ban controls. Backend/frontend production builds pass; tests were not run.
