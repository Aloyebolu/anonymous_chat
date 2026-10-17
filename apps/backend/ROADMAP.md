# Roadmap

> Cross-session AI/human handoff notes: see [`../../CONTINUATION.md`](../../CONTINUATION.md)
> before continuing implementation.

A living plan for the anonymous adults-only chat. It reflects the current
architecture, what's already built, and the order in which the remaining pieces
should be tackled. It is deliberately opinionated: the priority ordering is
"what makes this usable by real people" first, "what makes it operationally
sane" second, and "what makes it a business" last.

Architecture is fixed and should not be redesigned:

```
core application
   ↓
generic channel port
   ↓
channel adapters (web, whatsapp)
   ↓
infrastructure (baileys, http, json db)
```

Rules that stay true across all phases:

- Baileys never leaves `src/infrastructure/channels/whatsapp/`.
- Domain types never import infrastructure.
- Ports are the only thing the application depends on.
- All user-facing strings live in `src/application/messages.ts` (backend) and
  `ui/lib/constants.ts` (frontend).
- No new abstractions unless a second concrete implementation exists.
- No new dependencies unless the platform genuinely cannot do it.

---

## Status snapshot

### Done

- Channel-independent core: `ChatApplication`, `MatchmakingService`.
- Channel port with `WhatsAppChannelDriver`, `WebChannelDriver`, `FakeChannelDriver`.
- Baileys infrastructure: real socket, QR display, `useMultiFileAuthState`,
  reconnect on non-logout disconnects.
- WhatsApp inbound mapper (text, extended text, commands, button/list replies).
- WhatsApp outbound: text + numbered text fallback for interactions.
- Numbered-reply resolution back into generic `action` events.
- Onboarding: `/start`, adult confirm, gender, country, preference, complete.
- `/start` now resumes the current step or welcomes completed profiles.
- `/help` gives state-specific guidance for onboarding, matching, chat, and idle users.
- `/leave` removes users from the waiting queue as well as ending active chats.
- Operator session creation is available from the admin page and saved in local storage.
- Keeper profiles receive a configurable matchmaking ranking boost.
- Startup runs a matchmaking sweep immediately so persisted queue entries are reconsidered.
- Per-user message rate checks and basic repeat/length/link spam scoring block abusive
  chat messages. Moderation events are persisted without storing message contents.
- Admin can view report clusters and moderation events, and shadow-ban or restore a user.
- Shadow-banned users are silently ignored, removed from matching, and blocked from
  operator matchmaking.
- Admin API supports an `ADMIN_TOKEN` Bearer check; the frontend stores it in
  session storage. Production startup requires the token.
- Telegram startup owns polling errors and retries after network failures instead
  of allowing the polling rejection to crash the process.
- Persisted chat points ledger with `/points`, idempotent message awards, and a
  daily earning cap of 20 points.
- Telegram Mini App with server-validated `initData`, profile settings, daily
  check-in and profile-completion rewards.
- Points-funded 30-day VIP with strict preferences, priority matching, partner
  gender visibility, and gender switching.
- Conversation controls: `/next`, `/leave`, `/report`, `/block`, `/help`.
- Priority-based matchmaking with `MATCHMAKING_CONFIG`:
  - directional scoring (preferred gender, preferred country, `priorityTier`)
  - wait bonus
  - jitter
  - strict-then-relaxed filtering based on `lowSupplyThreshold` and
    `relaxPreferencesAfterMs`
  - `sweep()` on a 5 s timer from `main.ts`
- AI fallback: `StubAiService` and `HttpAiService`, threshold shrinks with queue
  size via `MatchmakingService.aiThresholdMs`.
- Moderation: `RegexModerationService` blocks phone, email, URL, handle,
  obfuscated variants.
- Reports: `JsonReportRepository`, admin `/api/reports`.
- Live watch: `InMemoryMessageLogRepository`, opt-in per conversation, cleared
  on unwatch. Off by default for privacy.
- Operator match: `MatchmakingService.forceOperatorMatch`, admin
  `/api/operator/match`.
- Moderator flow: admin-granted least-privilege tokens, a dedicated web page,
  availability and channel selection, temporary cross-channel identity linking,
  automatic support assignment before AI fallback, and moderator shadow-ban
  controls.
- Persistence: `JsonDatabase` + JSON-backed user / queue / conversation / report
  repositories.
- Admin HTTP server with `/api/state`, `/api/reports`, `/api/watch`,
  `/api/operator/match`. CORS applied.
- Next.js UI in `ui/`:
  - chat page with SSE stream, command palette, clickable commands, numbered
    interactions
  - admin page with queue, active sessions, watch panel, reports, operator
    panel, config viewer
  - strict split: services → hooks → components
- Backend tests: architecture vertical slice, WhatsApp mapper, WhatsApp driver,
  web driver, onboarding flow, matchmaking (with fake timers).

### Partially done

- Operator experience: a lightweight session flow exists. Configure `ADMIN_TOKEN`
  before running the admin API in production.
- AI: transport and config exist; `StubAiService` cycles canned replies. No
  real prompt, no memory, no safety layer.
- Moderation: text rate/spam checks and event history exist; media abuse controls and
  time-based temporary bans remain.
- Admin and moderation APIs support role grants/revocation, manual matches,
  shadow-ban controls, and moderator availability. Add an audit log for manual
  moderation actions before expanding moderator privileges.
- Persistence: JSON file. Single-process only, no locking across processes.

### Not started

- Additional VIP payment providers (points are implemented; leave the payment
  surface open for Telegram Stars and card providers).
- Point-history UI, additional point-earning activities, and reward redemption.
- Deployment hardening for the Mini App, including HTTPS origins, BotFather
  setup, and production persistence/monitoring.
- Fine-grained permission audit trail and session/device management.
- Deployment (Docker, reverse proxy, TLS, process manager).
- Structured logging, metrics, error reporting.
- Postgres.
- Image / voice / attachment support on either channel.
- Group chats.

---

## Guiding constraints

These keep the project honest and small:

1. **No feature ships without a channel-agnostic path.** If a feature only
   makes sense on WhatsApp, it belongs in the WhatsApp adapter, not in the
   application.
2. **Every behavior is tunable from one place.** Matching already is; AI
   threshold should stay in `MATCHMAKING_CONFIG`; user-facing copy should stay
   in `MSG` / `STRINGS`.
3. **The admin can see everything, but the user's privacy is the default.**
   Live watch is opt-in per conversation, and the message log is in-memory.
4. **No fake abstractions.** A port exists only when there are (or will be
   within one milestone) two implementations. `AiService` qualifies because
   stub and HTTP both exist. `ReportRepository` qualifies because in-memory and
   JSON both exist.
5. **Nothing in the domain layer knows about HTTP, sockets, JSON files, or
   Baileys.**

---

## Phase 1 — Make it pleasant to use (next)

The goal is: a stranger gets matched, has a real conversation, and never feels
stuck.

### 1.1 Wait-time feedback

- Notify the waiting user when the AI threshold changes materially (e.g. "about
  a minute left").
- Consider a short "no match yet — /next to give up" message every 60 s while
  queued.
- Keep the messages in `MSG`, driven by a small table in `MatchmakingService`
  or a dedicated notifier.

### 1.2 Better onboarding copy

- The current 18+ gate, gender, country, preference steps work, but the copy is
  terse.
- This is a pure `MSG` change. No structural work.

### 1.3 `/help` per state (done)

- Right now `/help` is one static string.
- It should reflect state: "you're waiting", "you're in a chat", "you haven't
  finished onboarding". This belongs in `ChatApplication`, not the drivers.

### 1.4 Operator login (basic local session flow done; authentication remains Phase 2)

- The admin flow assumes the operator already has a `UserId`.
- Add a tiny page: pick a display name, `findOrCreate` under channel `operator`,
  store the returned userId in `localStorage`, and use it for
  `/api/operator/match`.
- This is a UI-only change plus one new small endpoint that proxies
  `findOrCreate`.

### 1.5 Keeper users (ranking boost done; staffing controls remain)

- A "keeper" is a real human who poses as a matched user to keep someone else
  company when no real match is available.
- Design decision to make here: keepers are just users with `profile.keeper =
  true`. The matchmaker already can prefer them when the AI threshold is close
  but not reached.
- Add `keeper` handling to `MATCHMAKING_CONFIG` as a boost, not a separate
  algorithm.

Deliverables for Phase 1:

- Copy + `MSG` refactor for the above states.
- Operator login page.
- Keeper flag support in the matchmaker.
- All backend tests still pass; add one test for state-dependent `/help`.

---

## Phase 2 — Make it safe to run

The goal is: if 50 people used this tomorrow, nothing embarrassing happens.

### 2.1 Moderation hardening

- Rate limit per user (in-memory sliding window; the queue is already in
  memory).
- Add a simple spam score: message length, repeat count, link density.
- Log every block to a new `ModerationEventRepository` so the admin can see
  patterns.
- Do **not** call an external ML API yet — that's Phase 4.

### 2.2 Report review flow

- Reports are stored but nobody acts on them. Add:
  - a "reported users" view in admin that groups by reported user
  - a manual "shadow-ban" flag on `UserProfile`
  - shadow-ban handling in `ChatApplication.receive`: silently drop the user's
    outbound messages and don't re-queue them.

### 2.3 Admin auth (static bearer token done)

- A single static token in an env var, checked on every `/api/*` request.
- Session storage in the Next.js UI.
- Explicitly **not** rolling auth. One token is enough for a single-operator
  product.

### 2.4 Graceful shutdown and restart

- The sweeper is a `setInterval`. On shutdown, clear it before closing channels.
- On startup, run one immediate `sweep()` so users who were queued during a
  restart don't wait an extra tick.

### 2.5 Persistence sanity

- `JsonDatabase.mutate` currently rewrites the whole file on every change. Fine
  for a handful of users, not for hundreds. Add:
  - an explicit `WAL`-style append log for high-frequency writes (queue
    add/remove, message log)
  - a compaction step on startup
- This is not Postgres. It's a stopgap so we can go to 100 users before
  migrating.

Deliverables for Phase 2:

- Rate limiter, spam score, moderation event log (text path done).
- Reported users view + shadow-ban (basic controls done).
- Admin token auth.
- Startup sweep + graceful shutdown.
- Append-log persistence.

---

## Phase 3 — Make it operable

The goal is: someone other than the author can run it, watch it, and fix it.

### 3.1 Deployment

- `Dockerfile` for the backend, one for the UI.
- `docker-compose.yml` with:
  - backend service (web + admin + whatsapp)
  - ui service
  - a bind mount for `.data/`
  - `restart: unless-stopped`
- Reverse proxy example (Caddy) for TLS.

### 3.2 Observability

- Structured JSON logs from one place: `src/infrastructure/logging/`.
- The admin `/api/state` is enough for the dashboard; add `/api/metrics`
  returning counters only (users, matches, AI fallbacks, moderation blocks,
  reports).
- No Prometheus, no OpenTelemetry yet.

### 3.3 Backups

- `.data/db.json` and `.data/whatsapp-auth/` are the only state.
- Cron-style daily copy to a second directory + optional S3-compatible target.
- Restore is "stop, replace, start".

### 3.4 Reliability checks

- A small health script hitting `/health`, `/api/state`, and WhatsApp presence.
- Optional: cron it and alert on failure. No alerting framework yet.

Deliverables for Phase 3:

- Docker + compose + Caddy example.
- Structured logging.
- `/api/metrics`.
- Backup script.
- Health script.

---

## Phase 4 — Make it a product

The goal is: money in, growth out, without violating the constraint that this
stays a small system.

### 4.1 Payment tier

- `priorityTier` is already read by the matchmaker. Wire it up:
  - a `PaymentProvider` port (Stripe + fake)
  - `POST /api/payments/checkout` returns a provider URL
  - a webhook handler upgrades `profile.priorityTier`
- Tiers:
  - `0` free
  - `1` "priority": +250 score, first in relaxed queue
  - `2` "instant": skip the queue entirely, matched with the next available
    partner regardless of compatibility (subject to the other side's
    preferences)
- Keep the tier math in `MATCHMAKING_CONFIG.scoring.priorityTier`.

### 4.2 Real AI

- Replace `StubAiService` with a real prompt-based implementation behind
  `HttpAiService`, keeping the request/response contract.
- Add:
  - conversation memory (last N turns, stored in-memory only)
  - a safety filter on generated output (reuse `RegexModerationService`)
  - persona selection so the AI doesn't feel identical every time

### 4.3 Recommendation

- Track successful match outcomes (both users sent ≥ N messages).
- Feed that into the matchmaking score as a soft "did similar people get along"
  term.
- This is genuinely the only place where a light statistical model is
  justified. Do not build a recommender before Phase 1 and 2 are done.

### 4.4 Postgres migration

- New implementations of `UserRepository`, `MatchQueueRepository`,
  `ConversationRepository`, `ReportRepository` against Postgres.
- One-line change in `main.ts` to pick the Postgres impl when
  `DATABASE_URL` is set.
- The domain and application layers do not change.

Deliverables for Phase 4:

- Stripe integration (or a fake provider for testing).
- Real AI service.
- Postgres repositories.
- Optional: outcome-based scoring term.

---

## Cross-cutting concerns

### Testing strategy

- Application tests use `FakeChannelDriver` and in-memory repositories.
- Infrastructure tests use fake sockets / fake HTTP, never real network.
- Matchmaking tests use `vi.useFakeTimers()` and a config with `jitter: 0`.
- Every new port gets a fake implementation.
- Every new user-facing behavior gets a test that asserts the exact string from
  `MSG` / `STRINGS` — not a hardcoded copy — so a copy change is one edit.

### Feature flags

Anything that changes the shape of the matchmaker or the AI should be behind a
boolean in the config object it belongs to:

- `MATCHMAKING_CONFIG.aiFallback.enabled` — exists.
- `MATCHMAKING_CONFIG.keeper.enabled` — add in Phase 1.
- `MODERATION_CONFIG.strict` — add in Phase 2.

### Documentation

- `README.md` covers setup and architecture.
- `ROADMAP.md` (this file) covers direction.
- Any new port gets a one-line comment on the interface saying who calls it and
  why, not what it does.

### Things to explicitly not do

- Do not add Redis.
- Do not add Kubernetes.
- Do not add a GraphQL layer.
- Do not add a second admin UI.
- Do not replace JSON persistence with Postgres before Phase 4.
- Do not write abstractions for a use case that doesn't exist yet.

---

## Open questions

These are real, unresolved, and worth deciding before the phase they belong to.

1. **Do keepers talk as themselves or as a matched user?** If they replace a
   real user, then reports against them need to route somewhere different. If
   they talk as themselves, they should have a distinct badge in the admin.
2. **What happens when a paying user can't be matched at all?** Refund? Free
   "priority" for the rest of the day? The current queue has no memory of
   failures.
3. **Should the AI ever appear in the queue?** Right now it's a fallback, not a
   participant. This matters for the admin dashboard and for reports.
4. **Where does the operator-user's home live?** A separate channel
   (`operator`), or a profile flag on the web channel? Right now the design is
   silent on this.
5. **Is `Report` per-conversation or per-user?** Currently per-conversation,
   which means a repeated offender shows up as many reports, not as one
   escalation.

---

## Milestone checkpoints

- **M1 (end of Phase 1):** a stranger can be onboarded, matched (with a real
  human, a keeper, or the AI), chat, and end the conversation. No admin needed.
- **M2 (end of Phase 2):** the platform survives contact with an unfriendly
  user. Moderation blocks, reports are triaged, admin is authenticated.
- **M3 (end of Phase 3):** someone else can deploy, watch, and back up the
  system.
- **M4 (end of Phase 4):** users can pay for priority, the AI is real, and the
  data lives in Postgres.

Ship M1 before starting Phase 2. Ship M2 before writing a single line of
payment code.
```
