# anonymous_chat

## Web chat

The project landing page lists the available chat channels. Web chat is served at `/chat`; users create an account with a 3–20 character username (letters, numbers, and underscores) and a password of at least 10 characters. Account passwords are stored as salted scrypt hashes, and web sessions expire after 30 days.

Set `NEXT_PUBLIC_TELEGRAM_URL` and `NEXT_PUBLIC_WHATSAPP_URL` in the frontend environment to show the Telegram and WhatsApp channel links on the landing page. The web channel is always available at `/chat`.

## Staff multi-session workspace

Moderators can open `/moderator` with their existing moderator token, select connected channels, choose a concurrent-session limit from 1 to 10, and enable automatic assignments. Their live chat workspace is available at `/moderator/sessions`.

Admins can create operator access tokens from `/admin` and share them privately. Operators use the token at `/operator` to choose a session limit and enable automatic assignments. Waiting users are assigned to moderators first, then operators, after the existing human-match wait; AI remains the final fallback.

Staff workspaces update over WebSocket and show both participant and staff messages. Quick replies can be inserted from the session composer, and staff can end a session from its card. When staff have multiple active sessions, replies and conversation controls sent through a connected chat channel are redirected to the web workspace to prevent acting on the wrong conversation.
