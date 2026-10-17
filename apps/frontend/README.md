## Running the full stack

Two processes:

```sh
# backend (terminal 1)
DISABLE_WHATSAPP=1 npm run dev          # web + admin APIs

# frontend (terminal 2)
cd ui && npm install && npm run dev     # Next.js on http://localhost:3002
```

Ports:

- `3000` — backend web channel API (`/api/stream`, `/api/send`, `/health`)
- `3001` — admin API (`/api/state`, `/api/reports`, `/api/watch`, `/api/operator/match`)
- `3002` — Next.js UI (chat at `/`, admin at `/admin`)

Env vars:

- `WEB_PORT`, `ADMIN_PORT`
- `DISABLE_WHATSAPP=1` to skip Baileys
- `AI_URL` — if set, `HttpAiService` POSTs `{ conversationId, userId, text }` to that URL and expects `{ reply: string }`. Unset uses `StubAiService`.

## AI fallback

When nobody else is waiting and you've been queued long enough, the matchmaker pairs you with the AI assistant. `MatchmakingService.aiThresholdMs(queueSize)`:

```text
threshold = clamp(baseMs * queueSize / minOnlineForRealMatches, minMs, maxMs)
```

Defaults: `baseMs=60000`, `minMs=15000`, `maxMs=120000`, `minOnlineForRealMatches=5`. Fewer people waiting → faster AI fallback. Tunable in `MATCHMAKING_CONFIG.aiFallback`.

## Moderation

`RegexModerationService` inspects every relayed message. On match (phone, email, URL, handle, obfuscated variants), the message is **not** relayed — the sender gets a warning. Patterns are in `src/infrastructure/moderation/regex-moderation.ts`.

## Privacy model for live-watch

Message logging is **off by default** and **in-memory only**. The admin dashboard must explicitly `watch` a conversation to enable logging for it. Unwatching clears the buffer. Nothing is persisted.

## What's still not done

- Operator flow is minimal: the admin must supply an operator user id (create one by onboarding with channel `admin`). No dedicated "log in as operator" UI.
- No auth on the admin API. It's localhost-only; put it behind a token before deploying.
- Moderation is regex-only. Real spam or clever obfuscation will slip through.
- `StubAiService` cycles canned replies. Real AI needs `AI_URL`.
- No typing indicators, read receipts, or attachments.