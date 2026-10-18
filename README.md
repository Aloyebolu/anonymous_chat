# anonymous_chat

## Staff multi-session workspace

Moderators can open `/moderator` with their existing moderator token, select connected channels, choose a concurrent-session limit from 1 to 10, and enable automatic assignments. Their live chat workspace is available at `/moderator/sessions`.

Admins can create operator access tokens from `/admin` and share them privately. Operators use the token at `/operator` to choose a session limit and enable automatic assignments. Waiting users are assigned to moderators first, then operators, after the existing human-match wait; AI remains the final fallback.

Staff workspaces update over WebSocket and show both participant and staff messages. Quick replies can be inserted from the session composer, and staff can end a session from its card. When staff have multiple active sessions, replies and conversation controls sent through a connected chat channel are redirected to the web workspace to prevent acting on the wrong conversation.
