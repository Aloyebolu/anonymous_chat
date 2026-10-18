"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { API_PATHS } from "@anonymous-chat/shared/api";
import type { StaffConversationState } from "@anonymous-chat/shared/contracts";

type StaffRole = "moderator" | "operator";
type WorkspaceState = {
  readonly userId: string;
  readonly available: boolean;
  readonly sessionLimit: number;
  readonly channels?: readonly string[];
  readonly sessions: readonly StaffConversationState[];
};

const API = process.env.NEXT_PUBLIC_ADMIN_API ?? process.env.NEXT_PUBLIC_WEB_API;

export const StaffWorkspace = ({ role }: { readonly role: StaffRole }) => {
  const tokenKey = role === "moderator" ? "moderatorToken" : "operatorToken";
  const mePath = role === "moderator" ? API_PATHS.moderator.me : API_PATHS.operator.me;
  const settingsPath = role === "moderator" ? API_PATHS.moderator.settings : API_PATHS.operator.settings;
  const messagePath = role === "moderator" ? API_PATHS.moderator.message : API_PATHS.operator.message;
  const [token, setToken] = useState("");
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [sessionLimit, setSessionLimit] = useState(1);
  const [available, setAvailable] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...init.headers
      }
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Request failed (${response.status})`);
    }
    return response.status === 204 ? undefined : response.json() as Promise<unknown>;
  }, [token]);

  const applyState = useCallback((next: WorkspaceState) => {
    setState(next);
    setAvailable(next.available);
    setSessionLimit(next.sessionLimit);
    window.sessionStorage.setItem(tokenKey, token);
  }, [token, tokenKey]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      const data = await request(mePath) as WorkspaceState;
      applyState(data);
      setError("");
    } catch (reason) {
      setState(null);
      setError(reason instanceof Error ? reason.message : "Could not open staff workspace");
    } finally {
      setBusy(false);
    }
  }, [applyState, mePath, request, token]);

  useEffect(() => {
    setToken(window.sessionStorage.getItem(tokenKey) ?? "");
  }, [tokenKey]);

  useEffect(() => {
    if (token) void refresh();
  }, [refresh, token]);

  useEffect(() => {
    if (!token || !API) return;
    const url = new URL(API_PATHS.admin.live, API);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);
    const socket = new WebSocket(url);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as {
          type?: string;
          state?: WorkspaceState;
        };
        if (message.state && (
          (role === "moderator" && message.type === "moderator-update") ||
          (role === "operator" && message.type === "operator-update")
        )) applyState(message.state);
      } catch (reason) {
        console.error("Could not parse staff workspace update.", reason);
      }
    };
    socket.onerror = () => setError("Live updates disconnected. Refresh to reconnect.");
    return () => socket.close();
  }, [applyState, role, token]);

  const saveCapacity = async () => {
    if (!state) return;
    setBusy(true);
    try {
      const body = role === "moderator"
        ? { available, sessionLimit, channels: state.channels ?? [] }
        : { available, sessionLimit };
      await request(settingsPath, { method: "PATCH", body: JSON.stringify(body) });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update session capacity");
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async (conversationId: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = drafts[conversationId]?.trim();
    if (!text) return;
    setBusy(true);
    try {
      await request(messagePath, {
        method: "POST",
        body: JSON.stringify({ conversationId, text })
      });
      setDrafts((current) => ({ ...current, [conversationId]: "" }));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Message could not be sent");
    } finally {
      setBusy(false);
    }
  };

  const title = role === "moderator" ? "Moderator sessions" : "Operator sessions";

  return (
    <main className="staff-workspace">
      <header className="staff-header">
        <div>
          <a href={role === "moderator" ? "/moderator" : "/admin"}>← Back</a>
          <p className="staff-eyebrow">LIVE SUPPORT</p>
          <h1>{title}</h1>
          <p>Set your concurrent session limit. Waiting users will be connected automatically.</p>
        </div>
        {state && <span className={`staff-status ${available ? "is-online" : ""}`}>{available ? "Accepting sessions" : "Not accepting"}</span>}
      </header>

      {error && <p className="staff-error" role="alert">{error}</p>}
      {!state ? (
        <section className="staff-card staff-login">
          <h2>Sign in to your workspace</h2>
          <p>Use your {role} access token. It is stored only in this browser session.</p>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={`${role} access token`}
            autoComplete="current-password"
          />
          <button disabled={!token || busy} onClick={() => void refresh()}>{busy ? "Connecting…" : "Connect"}</button>
        </section>
      ) : (
        <>
          <section className="staff-card staff-controls">
            <label>
              <span>Maximum simultaneous chats</span>
              <input type="number" min={1} max={10} value={sessionLimit} onChange={(event) => setSessionLimit(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} />
            </label>
            <label className="staff-availability">
              <input type="checkbox" checked={available} onChange={(event) => setAvailable(event.target.checked)} />
              <span>Automatically connect waiting users</span>
            </label>
            <button disabled={busy || (role === "moderator" && !state.channels?.length)} onClick={() => void saveCapacity()}>
              Save and {available ? "go available" : "go offline"}
            </button>
            {role === "moderator" && !state.channels?.length && <small>Choose at least one connected channel on your moderator page.</small>}
            <p>{state.sessions.length} active of {sessionLimit} selected sessions</p>
          </section>

          {state.sessions.length === 0 ? (
            <section className="staff-card staff-empty">
              <h2>No active sessions yet</h2>
              <p>{available ? "You are opted in. New chats will appear here as eligible users reach the support fallback." : "Opt in above to receive waiting chats automatically."}</p>
            </section>
          ) : (
            <section className="staff-sessions">
              {state.sessions.map((session) => (
                <article className="staff-card staff-session" key={session.conversationId}>
                  <header className="staff-session-head">
                    <div>
                      <p className="staff-eyebrow">{session.participant.channel} · SESSION</p>
                      <h2>{session.participant.displayName || "Anonymous participant"}</h2>
                      <p>{session.participant.age ?? "Age not set"} · {session.participant.gender} · {session.participant.country}</p>
                    </div>
                    <span className="staff-session-indicator">Live</span>
                  </header>
                  <div className="staff-messages" aria-live="polite">
                    {session.messages.length === 0 ? <p className="staff-muted">Say hello to start the conversation.</p> :
                      session.messages.map((message) => (
                        <div className={`staff-message ${message.fromUserId === state.userId ? "staff-message-self" : ""}`} key={message.id}>
                          <p>{message.text}</p>
                          <time>{new Date(message.timestamp).toLocaleTimeString()}</time>
                        </div>
                      ))}
                  </div>
                  <form className="staff-compose" onSubmit={(event) => void sendMessage(session.conversationId, event)}>
                    <input
                      value={drafts[session.conversationId] ?? ""}
                      onChange={(event) => setDrafts((current) => ({ ...current, [session.conversationId]: event.target.value }))}
                      placeholder="Write a reply…"
                      maxLength={4000}
                    />
                    <button disabled={busy || !drafts[session.conversationId]?.trim()}>Send</button>
                  </form>
                </article>
              ))}
            </section>
          )}
        </>
      )}
      <style>{CSS}</style>
    </main>
  );
};

const CSS = `
.staff-workspace{--ink:#19233b;--muted:#66728b;max-width:1240px;min-height:100vh;margin:auto;padding:30px 20px 50px;background:#f5f6fb;color:var(--ink);font-family:ui-sans-serif,system-ui,sans-serif}
.staff-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin:0 auto 22px}
.staff-header a{color:#6957d8;font-size:13px;font-weight:700;text-decoration:none}
.staff-header h1{margin:5px 0;font-size:30px;letter-spacing:-.04em}
.staff-header p:last-child{margin:0;color:var(--muted);font-size:14px}
.staff-eyebrow{margin:12px 0 0;color:#7564d8;font-size:10px;font-weight:900;letter-spacing:.16em}
.staff-status,.staff-session-indicator{border-radius:99px;padding:7px 12px;background:#e5e7eb;color:#606a7c;font-size:12px;font-weight:800;white-space:nowrap}
.staff-status.is-online,.staff-session-indicator{background:#dcfce9;color:#13744a}
.staff-card{border:1px solid #e5e7ef;border-radius:18px;padding:18px;background:white;box-shadow:0 8px 24px #2432570b}
.staff-controls{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:20px}
.staff-controls label:first-child{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700}
.staff-controls input[type=number]{width:96px;height:40px;border:1px solid #dfe2eb;border-radius:10px;padding:0 10px;font:inherit}
.staff-availability{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:650}
.staff-availability input{width:18px;height:18px;accent-color:#7059e8}
.staff-controls button,.staff-login button,.staff-compose button{border:0;border-radius:10px;padding:11px 15px;background:#7059e8;color:white;font:inherit;font-weight:750;cursor:pointer}
.staff-controls button:disabled,.staff-login button:disabled,.staff-compose button:disabled{opacity:.5;cursor:not-allowed}
.staff-controls small{color:#9a4a24}
.staff-controls>p{margin:0 0 0 auto;color:var(--muted);font-size:12px}
.staff-empty{text-align:center;padding:45px 20px}
.staff-empty p,.staff-muted{color:var(--muted)}
.staff-login{display:grid;gap:12px;max-width:460px}
.staff-login h2,.staff-login p{margin:0}
.staff-login p{color:var(--muted);font-size:13px}
.staff-login input,.staff-compose input{min-width:0;height:42px;border:1px solid #dfe2eb;border-radius:10px;padding:0 12px;font:inherit}
.staff-sessions{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:16px}
.staff-session{display:flex;min-height:450px;flex-direction:column;gap:14px}
.staff-session-head{display:flex;justify-content:space-between;gap:12px}
.staff-session-head .staff-eyebrow{margin-top:0}
.staff-session-head h2{margin:5px 0;font-size:18px}
.staff-session-head p:last-child{margin:0;color:var(--muted);font-size:12px;text-transform:capitalize}
.staff-messages{display:flex;flex:1;min-height:220px;max-height:380px;flex-direction:column;gap:9px;overflow:auto;border-radius:12px;padding:12px;background:#f6f7fb}
.staff-message{max-width:88%;align-self:flex-start;border-radius:13px 13px 13px 4px;padding:9px 11px;background:white;box-shadow:0 2px 5px #1c25450a;overflow-wrap:anywhere}
.staff-message p{margin:0;white-space:pre-wrap;font-size:13px;line-height:1.45}
.staff-message time{display:block;margin-top:5px;color:#8b93a4;font-size:9px;text-align:right}
.staff-message-self{align-self:flex-end;border-radius:13px 13px 4px 13px;background:#e8e3ff}
.staff-compose{display:flex;gap:8px}
.staff-compose input{flex:1}
.staff-error{border-radius:10px;padding:12px;background:#fff0f1;color:#a23345}
@media(max-width:600px){.staff-workspace{padding:22px 13px}.staff-header{flex-direction:column}.staff-controls{align-items:stretch;flex-direction:column}.staff-controls>p{margin:0}.staff-session{min-height:420px}}
`;
