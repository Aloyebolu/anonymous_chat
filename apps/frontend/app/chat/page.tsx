"use client";
import { useCallback, useState, type FormEvent } from "react";
import { ChatLog } from "@/components/ChatLog";
import { CommandPalette } from "@/components/CommandPalette";
import { Composer } from "@/components/Composer";
import { STRINGS } from "@/lib/constants";
import { useChatStream } from "@/lib/hooks/useChatStream";
import { useSendMessage } from "@/lib/hooks/useSendMessage";
import { useUserIdentity } from "@/lib/hooks/useUserIdentity";
import { API_PATHS } from "@anonymous-chat/shared/api";
import { editWebMessage, reactToWebMessage } from "@/lib/services/api";

interface ComposerContext {
  readonly kind: "reply" | "edit";
  readonly messageId: string;
  readonly preview: string;
}

const WEB_API = process.env.NEXT_PUBLIC_WEB_API ?? "http://localhost:3000";

export default function HomePage() {
  const { user, token, signIn, signOut } = useUserIdentity();
  const [draft, setDraft] = useState("");
  const [password, setPassword] = useState("");
  const [registering, setRegistering] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [composerContext, setComposerContext] = useState<ComposerContext | undefined>();
  const [actionError, setActionError] = useState("");
  const { entries, appendOutbound, updateText, appendReaction } = useChatStream(user, token);
  const send = useSendMessage(user, token);

  const sendText = useCallback((text: string) => {
    void (async () => {
      setActionError("");
      try {
        if (!user || !token) return;
        if (composerContext?.kind === "edit") {
          await editWebMessage(user, token, composerContext.messageId, text);
          updateText(composerContext.messageId, text);
          setComposerContext(undefined);
          return;
        }
        const messageId = crypto.randomUUID();
        await send({
          text,
          externalMessageId: messageId,
          replyToMessageId: composerContext?.kind === "reply" ? composerContext.messageId : undefined
        });
        appendOutbound({
          kind: "text",
          text,
          replyToMessageId: composerContext?.kind === "reply" ? composerContext.messageId : undefined
        }, messageId);
        setComposerContext(undefined);
      } catch (reason) {
        setActionError(reason instanceof Error ? reason.message : "Could not send the message.");
      }
    })();
  }, [appendOutbound, composerContext, send, token, updateText, user]);

  const sendCommand = useCallback((command: string) => {
    setComposerContext(undefined);
    setActionError("");
    void (async () => {
      try {
        await send({ text: command });
        appendOutbound({ kind: "text", text: command }, crypto.randomUUID());
      } catch (reason) {
        setActionError(reason instanceof Error ? reason.message : "Could not send the command.");
      }
    })();
  }, [appendOutbound, send]);

  const sendAction = useCallback((action: { id: string; label: string }) => {
    void (async () => {
      setActionError("");
      try {
        await send({ actionId: action.id });
        appendOutbound({ kind: "text", text: action.label }, crypto.randomUUID());
      } catch (reason) {
        setActionError(reason instanceof Error ? reason.message : "Could not send the action.");
      }
    })();
  }, [appendOutbound, send]);

  const sendMedia = useCallback(async (media: {
    kind: "image" | "video" | "audio" | "voice" | "document";
    mimeType: string;
    filename: string;
    base64: string;
  }) => {
    if (!user) return;
    setActionError("");
    const messageId = crypto.randomUUID();
    try {
      await send({
        media,
        externalMessageId: messageId,
        replyToMessageId: composerContext?.kind === "reply" ? composerContext.messageId : undefined
      });
      appendOutbound({
        kind: "media",
        replyToMessageId: composerContext?.kind === "reply" ? composerContext.messageId : undefined,
        media: {
          kind: media.kind,
          mimeType: media.mimeType,
          filename: media.filename,
          url: `data:${media.mimeType};base64,${media.base64}`
        }
      }, messageId);
      setComposerContext(undefined);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not send the media.");
      throw reason;
    }
  }, [appendOutbound, composerContext, send, user]);

  const react = useCallback((messageId: string, emoji: string) => {
    void (async () => {
      setActionError("");
      try {
        if (!user || !token) return;
        await reactToWebMessage(user, token, messageId, emoji);
        appendReaction(messageId, emoji);
      } catch (reason) {
        setActionError(reason instanceof Error ? reason.message : "Could not react to the message.");
      }
    })();
  }, [appendReaction, token, user]);

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const response = await fetch(`${WEB_API}${registering ? API_PATHS.web.register : API_PATHS.web.login}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: draft, password })
      });
      const result = await response.json() as { username?: string; token?: string; error?: string };
      if (!response.ok || !result.username || !result.token) {
        throw new Error(result.error || "Could not sign in.");
      }
      signIn(result.username, result.token);
      setPassword("");
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : "Could not sign in.");
    } finally {
      setAuthBusy(false);
    }
  };

  // Gate: nothing below renders until the user has an identity.
  if (!user) {
    return (
      <>
        <style>{CSS_TEXT}</style>
        <div className="hp-gate">
          <div className="hp-gate-card">
            <div className="hp-logo hp-logo-lg" aria-hidden>💬</div>
            <h1>{STRINGS.appTitle}</h1>
            <p className="hp-gate-sub">Create an account or sign in to continue.</p>

            <form
              className="hp-gate-form"
              onSubmit={(event) => void authenticate(event)}
            >
              <label className="hp-gate-label">
                <span>Your name</span>
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="e.g. ada_chat"
                  maxLength={20}
                  autoFocus
                  autoComplete="username"
                  aria-label="Username"
                />
              </label>
              <label className="hp-gate-label">
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 5 characters"
                  minLength={5}
                  maxLength={128}
                  autoComplete={registering ? "new-password" : "current-password"}
                  aria-label="Password"
                />
              </label>
              {authError && <p className="hp-auth-error" role="alert">{authError}</p>}
              <button
                type="submit"
                className="hp-gate-btn"
                disabled={!draft.trim() || password.length < (registering ? 5 : 1) || authBusy}
              >
                {authBusy ? "Please wait…" : registering ? "Create account" : "Sign in"}
              </button>
            </form>
            <button type="button" className="hp-auth-switch" onClick={() => { setRegistering(!registering); setAuthError(""); }}>
              {registering ? "Already registered? Sign in" : "New here? Create an account"}
            </button>

            <p className="hp-gate-tip">Username: 3–20 letters, numbers, or underscores. Password: at least 5 characters.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{CSS_TEXT}</style>
      <div className="hp-shell">
        <header className="hp-header">
          <div className="hp-brand">
            <div className="hp-logo" aria-hidden>💬</div>
            <div className="hp-brand-text">
              <h1>{STRINGS.appTitle}</h1>
              <p>{STRINGS.headerTip}</p>
            </div>
          </div>
          <div className="hp-user">
            <span className="hp-user-pill" title="Your display name">
              <span className="hp-user-dot" aria-hidden />
              {user}
            </span>
            <button type="button" className="hp-user-change" onClick={signOut}>Sign out</button>
          </div>
        </header>

        <main className="hp-body">
          <ChatLog
            entries={entries}
            onCommand={sendCommand}
            onAction={sendAction}
            onReply={(messageId, preview) => setComposerContext({ kind: "reply", messageId, preview })}
            onEdit={(messageId, text) => setComposerContext({ kind: "edit", messageId, preview: text })}
            onReact={react}
          />
        </main>

        <footer className="hp-footer">
          <CommandPalette onCommand={sendCommand} />
          {actionError && <p className="hp-auth-error" role="alert">{actionError}</p>}
          <Composer
            onSend={sendText}
            onSendMedia={sendMedia}
            context={composerContext}
            onCancelContext={() => setComposerContext(undefined)}
          />
        </footer>
      </div>
    </>
  );
}

const CSS_TEXT = `
.hp-shell, .hp-gate {
  color-scheme:light dark;
  font-family:ui-sans-serif,-apple-system,"SF Pro Display","Segoe UI",system-ui,sans-serif;
}
.hp-shell *, .hp-gate * { box-sizing:border-box; }

/* ---------- gate ---------- */
.hp-gate {
  display:grid; place-items:center;
  height:100dvh; height:100vh;
  padding:24px;
  background:
    radial-gradient(120% 80% at 50% 0%, #eef2ff, #f8fafc 60%, #f1f5f9);
}
@supports (height: 100dvh) { .hp-gate, .hp-shell { height:100dvh; } }

.hp-gate-card {
  width:100%; max-width:400px;
  display:flex; flex-direction:column; align-items:center;
  padding:32px 26px 26px;
  border-radius:22px;
  background:#fff;
  border:1px solid rgba(15,23,42,.07);
  box-shadow:0 24px 60px -30px rgba(15,23,42,.35);
  text-align:center;
  animation:hp-rise .4s cubic-bezier(.2,.9,.2,1) both;
}
.hp-gate-card h1 {
  margin:14px 0 6px;
  font-size:20px; font-weight:800; letter-spacing:-.02em;
  color:#0f172a;
}
.hp-gate-sub {
  margin:0 0 22px;
  font-size:13px; line-height:1.45;
  color:#64748b;
}
.hp-auth-error { width:100%;margin:0;padding:10px 12px;border-radius:10px;background:#fff0f1;color:#a23345;font-size:12px;text-align:left; }
.hp-auth-switch { margin:14px 0 0;padding:7px;border:0;background:transparent;color:#5b52ae;font:inherit;font-size:12px;font-weight:700;cursor:pointer; }
.hp-gate-form { width:100%; display:flex; flex-direction:column; gap:12px; }
.hp-gate-label {
  display:flex; flex-direction:column; gap:6px; text-align:left;
}
.hp-gate-label span {
  font-size:11px; font-weight:700; letter-spacing:.02em; color:#475569;
}
.hp-gate-label input {
  width:100%; height:46px;
  padding:0 14px; border-radius:13px;
  border:1px solid rgba(15,23,42,.12);
  background:#fff; color:#0f172a;
  font-size:15px; font-family:inherit; outline:none;
  transition:border-color .18s, box-shadow .18s;
}
.hp-gate-label input:focus {
  border-color:#6366f1;
  box-shadow:0 0 0 4px rgba(99,102,241,.16);
}
.hp-gate-label input::placeholder { color:#94a3b8; }

.hp-gate-btn {
  height:46px; border:0; border-radius:13px;
  background:linear-gradient(135deg,#6366f1,#4f46e5);
  color:#fff; font-size:14.5px; font-weight:700; font-family:inherit;
  cursor:pointer;
  box-shadow:0 14px 28px -14px rgba(79,70,229,.85);
  transition:transform .15s, box-shadow .2s, opacity .2s;
}
.hp-gate-btn:hover:not(:disabled) { box-shadow:0 16px 34px -14px rgba(79,70,229,1); }
.hp-gate-btn:active:not(:disabled) { transform:scale(.97); }
.hp-gate-btn:disabled { opacity:.45; cursor:not-allowed; }

.hp-gate-tip {
  margin:18px 0 0;
  font-size:11px; line-height:1.4;
  color:#94a3b8;
}

@media (prefers-color-scheme: dark) {
  .hp-gate {
    background:radial-gradient(120% 80% at 50% 0%, #131a33, #0b1120 60%, #070c18);
  }
  .hp-gate-card {
    background:#0f172a;
    border-color:rgba(148,163,184,.14);
    box-shadow:0 24px 60px -30px rgba(0,0,0,.7);
  }
  .hp-gate-card h1 { color:#f1f5f9; }
  .hp-gate-sub { color:#94a3b8; }
  .hp-gate-label span { color:#cbd5e1; }
  .hp-gate-label input {
    background:#1e293b;
    border-color:rgba(148,163,184,.2);
    color:#f1f5f9;
  }
  .hp-gate-label input::placeholder { color:#64748b; }
  .hp-gate-tip { color:#64748b; }
}

/* ---------- shell ---------- */
.hp-shell {
  display:flex; flex-direction:column;
  height:100dvh; height:100vh;
  max-width:760px; margin:0 auto;
  background:#fff;
}

.hp-header {
  display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:14px 16px; flex:none;
  border-bottom:1px solid rgba(15,23,42,.08);
  background:rgba(255,255,255,.9);
  backdrop-filter:blur(14px);
  -webkit-backdrop-filter:blur(14px);
  position:sticky; top:0; z-index:5;
}
.hp-brand { display:flex; align-items:center; gap:12px; min-width:0; }
.hp-logo {
  display:grid; place-items:center; flex:none;
  width:38px; height:38px; border-radius:12px;
  background:linear-gradient(135deg,#6366f1,#4f46e5);
  box-shadow:0 6px 16px -6px rgba(79,70,229,.7);
  font-size:20px;
}
.hp-logo-lg {
  width:56px; height:56px; border-radius:18px; font-size:28px;
  box-shadow:0 10px 24px -10px rgba(79,70,229,.9);
}
.hp-brand-text { min-width:0; }
.hp-brand-text h1 {
  margin:0; font-size:15.5px; font-weight:700; letter-spacing:-.01em;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.hp-brand-text p {
  margin:2px 0 0; font-size:11.5px; line-height:1.3;
  color:#64748b;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}

.hp-user { display:flex; align-items:center; gap:8px; flex:none; }
.hp-user-pill {
  display:inline-flex; align-items:center; gap:7px;
  max-width:150px;
  padding:7px 12px; border-radius:999px;
  background:rgba(99,102,241,.1);
  border:1px solid rgba(99,102,241,.3);
  color:#4f46e5;
  font-size:12.5px; font-weight:700;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.hp-user-dot {
  width:7px; height:7px; border-radius:50%; flex:none;
  background:#22c55e;
  box-shadow:0 0 0 3px rgba(34,197,94,.2);
}
.hp-user-change {
  background:transparent; border:0; padding:4px 6px;
  color:#64748b; font-size:12px; font-weight:600; font-family:inherit;
  cursor:pointer; border-radius:8px;
  transition:color .18s, background .18s;
}
.hp-user-change:hover { color:#0f172a; background:rgba(15,23,42,.05); }

@media (prefers-color-scheme: dark) {
  .hp-shell { background:#0b1120; }
  .hp-header {
    border-bottom-color:rgba(148,163,184,.14);
    background:rgba(11,17,32,.85);
  }
  .hp-brand-text h1 { color:#f1f5f9; }
  .hp-brand-text p { color:#94a3b8; }
  .hp-user-pill {
    background:rgba(129,140,248,.14);
    border-color:rgba(129,140,248,.35);
    color:#a5b4fc;
  }
  .hp-user-change { color:#94a3b8; }
  .hp-user-change:hover { color:#f1f5f9; background:rgba(148,163,184,.1); }
}

.hp-body {
  flex:1; min-height:0;
  display:flex; flex-direction:column;
  background:linear-gradient(180deg, rgba(248,250,252,1), rgba(241,245,249,1));
}
@media (prefers-color-scheme: dark) {
  .hp-body { background:linear-gradient(180deg,#0b1120,#0f172a); }
}

.hp-footer {
  flex:none;
  display:flex; flex-direction:column; gap:10px;
  padding:10px 14px calc(12px + env(safe-area-inset-bottom));
  border-top:1px solid rgba(15,23,42,.08);
  background:rgba(255,255,255,.92);
  backdrop-filter:blur(14px);
  -webkit-backdrop-filter:blur(14px);
}
@media (prefers-color-scheme: dark) {
  .hp-footer {
    border-top-color:rgba(148,163,184,.14);
    background:rgba(15,23,42,.92);
  }
}

@media (max-width:480px) {
  .hp-brand-text p { display:none; }
  .hp-header { padding:10px 12px; }
  .hp-footer { padding:8px 10px calc(10px + env(safe-area-inset-bottom)); }
  .hp-user-pill { max-width:110px; }
}

@media (prefers-reduced-motion: reduce) {
  .hp-gate-card { animation:none; }
}
@keyframes hp-rise {
  from { opacity:0; transform:translateY(10px) scale(.98); }
  to   { opacity:1; transform:none; }
}
`;