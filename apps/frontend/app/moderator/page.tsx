"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { API_PATHS } from "@anonymous-chat/shared/api";

const API = process.env.NEXT_PUBLIC_ADMIN_API;

type ModeratorState = {
  userId: string;
  available: boolean;
  channels: string[];
  connectedChannels: string[];
  activeConversationId: string | null;
};
const WebIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
  </svg>
);

const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.51.11-.11.25-.29.37-.44.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29Z" />
  </svg>
);

const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
    <path d="M21.94 4.3 18.6 20.05c-.25 1.11-.91 1.38-1.84.86l-5.09-3.75-2.46 2.36c-.27.27-.5.5-1.02.5l.36-5.18 9.43-8.52c.41-.36-.09-.56-.63-.2L6.7 12.68 1.68 11.1c-1.09-.34-1.11-1.09.23-1.62L20.5 2.26c.91-.34 1.71.2 1.44 2.04Z" />
  </svg>
);

type ChannelMeta = { label: string; icon: ReactNode; tint: string };

const CHANNEL_META: Record<string, ChannelMeta> = {
  web: { label: "Web chat", icon: <WebIcon />, tint: "#22d3ee" },
  whatsapp: { label: "WhatsApp", icon: <WhatsAppIcon />, tint: "#25d366" },
  telegram: { label: "Telegram", icon: <TelegramIcon />, tint: "#2aabee" }
};

function channelMeta(channel: string): ChannelMeta {
  return CHANNEL_META[channel.toLowerCase()] ?? {
    label: channel.charAt(0).toUpperCase() + channel.slice(1),
    icon: <WebIcon />,
    tint: "#a78bfa"
  };
}

export default function ModeratorPage() {
  const [token, setToken] = useState("");
  const [state, setState] = useState<ModeratorState | null>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const [available, setAvailable] = useState(false);
  const [linkCode, setLinkCode] = useState("");
  const [banId, setBanId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...init.headers
      }
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
    }
    return body;
  }, [token]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const data = (await request(API_PATHS.moderator.me)) as unknown as ModeratorState;
      setState(data);
      setChannels(data.channels);
      setAvailable(data.available);
      setError("");
      window.sessionStorage.setItem("moderatorToken", token);
    } catch (reason) {
      setState(null);
      setError(reason instanceof Error ? reason.message : "Could not load moderator account");
    } finally {
      setBusy(false);
    }
  }, [request, token]);

  useEffect(() => {
    setToken(window.sessionStorage.getItem("moderatorToken") ?? "");
  }, []);

  useEffect(() => {
    if (token) void refresh();
  }, [token, refresh]);

  const save = async (nextAvailable = available, nextChannels = channels) => {
    setBusy(true);
    try {
      await request(API_PATHS.moderator.settings, {
        method: "PATCH",
        body: JSON.stringify({ available: nextAvailable, channels: nextChannels })
      });
      setAvailable(nextAvailable);
      setChannels(nextChannels);
      setNotice(nextAvailable ? "You’re available for support chats." : "You’re offline.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  };

  const createLinkCode = async () => {
    try {
      const result = await request(API_PATHS.moderator.linkCode, { method: "POST", body: "{}" });
      setLinkCode(String(result.code));
      setNotice("Code expires in 10 minutes. Send it from the other channel as /modlink CODE.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create link code");
    }
  };

  const setShadowBan = async (banned: boolean) => {
    try {
      await request(API_PATHS.moderator.shadowBan, {
        method: "POST",
        body: JSON.stringify({ userId: banId.trim(), banned })
      });
      setNotice(banned ? "Account shadow-banned." : "Shadow-ban lifted.");
      setBanId("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update account");
    }
  };

  const signOut = () => {
    window.sessionStorage.removeItem("moderatorToken");
    setToken("");
    setState(null);
    setLinkCode("");
    setNotice("");
    setError("");
  };

  const styles = useMemo(() => CSS_TEXT, []);

  const initials = useMemo(() => {
    if (!state?.userId) return "M";
    return state.userId.slice(0, 2).toUpperCase();
  }, [state?.userId]);

  return (
    <div className="mod-app">
      <style>{styles}</style>
      <div className="mod-orb mod-orb-1" />
      <div className="mod-orb mod-orb-2" />
      <div className="mod-orb mod-orb-3" />

      <main className="mod-main">
        <header className="mod-header">
          <div className="mod-badge">
            <span className="mod-badge-shield">🛡️</span>
          </div>
          <div className="mod-header-text">
            <p className="mod-eyebrow">MODERATOR · HUMAN SUPPORT</p>
            <h1>Moderator space</h1>
            <p className="mod-sub">Manage your availability and help users who need a human connection.</p>
          </div>
        </header>

        {(notice || error) && (
          <div className="mod-alerts">
            {error && <div className="mod-alert mod-alert-error" role="alert">{error}</div>}
            {notice && <div className="mod-alert mod-alert-success" role="status">{notice}</div>}
          </div>
        )}

        {!state ? (
          <section className="mod-card">
            <div className="mod-card-head">
              <span className="mod-card-icon">🔑</span>
              <div>
                <h2>Sign in</h2>
                <p>Paste your moderator access token to continue.</p>
              </div>
            </div>
            <label className="mod-field">
              <span className="mod-field-label">Moderator access token</span>
              <div className="mod-token-row">
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Paste your token"
                />
                <button
                  type="button"
                  className="mod-btn mod-btn-ghost"
                  onClick={async () => {
                    try {
                      const nextToken = await navigator.clipboard.readText();
                      if (nextToken) setToken(nextToken);
                    } catch {
                      setError("Clipboard access unavailable");
                    }
                  }}
                  disabled={typeof navigator === "undefined" || !navigator.clipboard}
                >
                  Paste
                </button>
              </div>
            </label>
            <button
              type="button"
              className="mod-btn mod-btn-primary mod-btn-block"
              onClick={() => void refresh()}
              disabled={!token || busy}
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
          </section>
        ) : (
          <>
            <section className="mod-hero">
              <div className="mod-hero-glow" />
              <div className="mod-hero-top">
                <div className="mod-avatar">{initials}</div>
                <div className="mod-hero-info">
                  <p className="mod-eyebrow">SIGNED IN AS</p>
                  <p className="mod-hero-id">Moderator {state.userId.slice(0, 8)}</p>
                </div>
                <span className={`mod-status ${available ? "mod-status-on" : "mod-status-off"}`}>
                  <span className="mod-status-dot" />
                  {available ? "Available" : "Offline"}
                </span>
              </div>
              <div className="mod-hero-stat">
                <span className="mod-hero-stat-label">Active conversation</span>
                <span className="mod-hero-stat-value">
                  {state.activeConversationId ? "Helping someone now" : "None right now"}
                </span>
              </div>
            </section>

            <section className="mod-card">
              <div className="mod-card-head">
                <span className="mod-card-icon">📡</span>
                <div>
                  <h2>Connected channels</h2>
                  <p>Choose which channels you want to receive support chats on.</p>
                </div>
              </div>
              {state.connectedChannels.length === 0 ? (
                <p className="mod-empty">No chat channels linked yet. Connect one below.</p>
              ) : (
                <div className="mod-channel-list">
                  {state.connectedChannels.map((channel) => {
                    const meta = channelMeta(channel);
                    const checked = channels.includes(channel);
                    return (
                      <label key={channel} className={`mod-channel${checked ? " mod-channel-on" : ""}`}><span className="mod-channel-icon" style={{ background: `${meta.tint}22`, borderColor: `${meta.tint}55`, color: meta.tint }}>
                          {meta.icon}
                        </span>

                        <span className="mod-channel-info">
                          <b>{meta.label}</b>
                          <small>{channel}</small>
                        </span>
                        <span className="mod-switch">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...channels, channel]
                                : channels.filter((item) => item !== channel);
                              setChannels(next);
                              void save(available, next);
                            }}
                          />
                          <span className="mod-switch-track"><span className="mod-switch-thumb" /></span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="mod-actions">
                <button
                  type="button"
                  className={`mod-btn ${available ? "mod-btn-warn" : "mod-btn-primary"}`}
                  disabled={channels.length === 0 || busy}
                  onClick={() => void save(!available)}
                >
                  {available ? "Go offline" : "Opt in to support chats"}
                </button>
                <button type="button" className="mod-btn mod-btn-ghost" onClick={() => void createLinkCode()}>
                  Connect another channel
                </button>
              </div>
              {linkCode && (
                <div className="mod-code">
                  <span>Send this from the account you want to link:</span>
                  <code>/modlink {linkCode}</code>
                </div>
              )}
            </section>

            <section className="mod-card">
              <div className="mod-card-head">
                <span className="mod-card-icon">🛑</span>
                <div>
                  <h2>Account safety</h2>
                  <p>Shadow-ban prevents a user from messaging or entering matchmaking. Use only when needed for safety.</p>
                </div>
              </div>
              <label className="mod-field">
                <span className="mod-field-label">User ID</span>
                <input
                  value={banId}
                  onChange={(event) => setBanId(event.target.value)}
                  placeholder="Paste user ID from the admin report"
                />
              </label>
              <div className="mod-actions">
                <button
                  type="button"
                  className="mod-btn mod-btn-danger"
                  disabled={!banId.trim()}
                  onClick={() => void setShadowBan(true)}
                >
                  Shadow-ban user
                </button>
                <button
                  type="button"
                  className="mod-btn mod-btn-ghost"
                  disabled={!banId.trim()}
                  onClick={() => void setShadowBan(false)}
                >
                  Lift shadow-ban
                </button>
              </div>
            </section>

            <button type="button" className="mod-signout" onClick={signOut}>
              Sign out
            </button>
          </>
        )}
      </main>
    </div>
  );
}

const CSS_TEXT = `
.mod-app {
  --bg-1:#07070d; --bg-2:#0f0d1c; --bg-3:#040409;
  --surface:rgba(255,255,255,.045); --surface-2:rgba(255,255,255,.08);
  --border:rgba(255,255,255,.08); --border-strong:rgba(255,255,255,.16);
  --text:#f4f1ff; --text-dim:rgba(244,241,255,.6); --text-faint:rgba(244,241,255,.38);
  --accent:#a78bfa; --accent-2:#7c3aed; --accent-3:#f472b6;
  --success:#34d399; --danger:#fb7185; --warn:#fbbf24;
  --shadow:0 24px 60px -24px rgba(0,0,0,.7); --radius:22px;
  min-height:100dvh; position:relative; overflow:hidden;
  background:radial-gradient(120% 80% at 50% -10%, var(--bg-2), var(--bg-1) 55%, var(--bg-3));
  color:var(--text); font-size:15px; -webkit-font-smoothing:antialiased;
  font-family:ui-sans-serif,-apple-system,"SF Pro Display","Segoe UI",system-ui,sans-serif;
  color-scheme:dark;
}
.mod-app *{box-sizing:border-box}
.mod-orb{position:fixed;border-radius:50%;filter:blur(80px);opacity:.45;pointer-events:none;z-index:0;animation:mod-float 18s ease-in-out infinite}
.mod-orb-1{width:340px;height:340px;background:#7c3aed;top:-120px;left:-100px}
.mod-orb-2{width:280px;height:280px;background:#ec4899;bottom:5%;right:-120px;animation-delay:-6s;opacity:.3}
.mod-orb-3{width:240px;height:240px;background:#22d3ee;top:45%;left:45%;animation-delay:-12s;opacity:.2}
@keyframes mod-float{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(20px,-30px,0) scale(1.08)}}
.mod-main{position:relative;z-index:1;max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:16px;
  padding:max(28px,env(safe-area-inset-top)) 18px 48px}
.mod-header{display:flex;gap:16px;align-items:center;padding:6px 4px 10px;animation:mod-rise .5s cubic-bezier(.2,.9,.2,1) both}
.mod-badge{width:56px;height:56px;border-radius:18px;display:grid;place-items:center;flex:none;
  background:linear-gradient(145deg,rgba(167,139,250,.35),rgba(236,72,153,.2));
  border:1px solid var(--border-strong);box-shadow:inset 0 1px 0 rgba(255,255,255,.2),var(--shadow)}
.mod-badge-shield{font-size:28px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.4))}
.mod-header-text{min-width:0}
.mod-eyebrow{margin:0 0 4px;font-size:10px;letter-spacing:.18em;font-weight:800;color:var(--text-faint)}
.mod-header h1{margin:0;font-size:24px;font-weight:800;letter-spacing:-.03em}
.mod-sub{margin:4px 0 0;font-size:13px;color:var(--text-dim);line-height:1.5}
.mod-alerts{display:flex;flex-direction:column;gap:8px}
.mod-alert{padding:12px 14px;border-radius:14px;font-size:13px;border:1px solid transparent;animation:mod-rise .35s cubic-bezier(.2,.9,.2,1) both}
.mod-alert-error{background:rgba(251,113,133,.12);color:#ffb4c0;border-color:rgba(251,113,133,.25)}
.mod-alert-success{background:rgba(52,211,153,.12);color:#86efc7;border-color:rgba(52,211,153,.25)}
.mod-card{position:relative;border-radius:var(--radius);padding:20px;background:var(--surface);
  border:1px solid var(--border);box-shadow:var(--shadow);
  backdrop-filter:blur(24px) saturate(140%);-webkit-backdrop-filter:blur(24px) saturate(140%);
  display:flex;flex-direction:column;gap:14px;animation:mod-rise .45s cubic-bezier(.2,.9,.2,1) both}
.mod-card-head{display:flex;gap:12px;align-items:flex-start}
.mod-card-icon{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;flex:none;font-size:18px;
  background:linear-gradient(145deg,rgba(167,139,250,.28),rgba(34,211,238,.14));border:1px solid var(--border)}
.mod-card-head h2{margin:0;font-size:16px;font-weight:700;letter-spacing:-.01em}
.mod-card-head p{margin:3px 0 0;font-size:12px;color:var(--text-dim);line-height:1.5}
.mod-field{display:flex;flex-direction:column;gap:6px}
.mod-field-label{font-size:11px;font-weight:600;color:var(--text-dim);letter-spacing:.02em}
.mod-field input{width:100%;height:46px;padding:0 14px;border-radius:13px;font-size:14px;font-family:inherit;
  background:var(--surface-2);border:1px solid var(--border);color:var(--text);outline:none;
  transition:border-color .2s ease,box-shadow .2s ease,background .2s ease}
.mod-field input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(167,139,250,.18)}
.mod-field input::placeholder{color:var(--text-faint)}
.mod-token-row{display:flex;gap:8px;align-items:center}
.mod-token-row input{flex:1}
.mod-btn{border:0;border-radius:13px;padding:12px 18px;font-size:14px;font-weight:700;cursor:pointer;
  font-family:inherit;transition:transform .15s ease,box-shadow .2s ease,opacity .2s ease;
  display:inline-flex;align-items:center;justify-content:center;gap:8px;color:#fff}
.mod-btn:active{transform:scale(.97)}
.mod-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.mod-btn-block{width:100%}
.mod-btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:0 12px 28px -10px rgba(124,58,237,.7)}
.mod-btn-ghost{background:var(--surface-2);border:1px solid var(--border-strong);color:var(--text)}
.mod-btn-warn{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#1a0f33}
.mod-btn-danger{background:linear-gradient(135deg,#fb7185,#e11d48);box-shadow:0 12px 28px -12px rgba(225,29,72,.7)}
.mod-hero{position:relative;overflow:hidden;border-radius:var(--radius);padding:22px;color:#fff;
  background:linear-gradient(135deg,#1b2750,#3f3677 65%,#614886);box-shadow:var(--shadow);
  display:flex;flex-direction:column;gap:16px;animation:mod-rise .4s cubic-bezier(.2,.9,.2,1) both}
.mod-hero-glow{position:absolute;width:220px;height:220px;right:-70px;top:-100px;border-radius:50%;
  background:radial-gradient(circle,rgba(188,169,255,.4),transparent 70%);pointer-events:none}
.mod-hero-top{display:flex;align-items:center;gap:14px;position:relative}
.mod-avatar{width:52px;height:52px;border-radius:16px;flex:none;display:grid;place-items:center;font-size:18px;font-weight:800;
  background:linear-gradient(145deg,#ffe8a8,#d5b1ff);color:#31244e;box-shadow:0 8px 20px rgba(0,0,0,.35)}
.mod-hero-info{flex:1;min-width:0}
.mod-hero-info .mod-eyebrow{color:rgba(255,255,255,.55)}
.mod-hero-id{margin:0;font-size:16px;font-weight:800;letter-spacing:-.01em}
.mod-status{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:99px;font-size:11px;font-weight:700;
  background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16)}
.mod-status-dot{width:7px;height:7px;border-radius:50%;flex:none}
.mod-status-on .mod-status-dot{background:#34d399;box-shadow:0 0 0 4px rgba(52,211,153,.25);animation:mod-pulse 2s ease-in-out infinite}
.mod-status-off .mod-status-dot{background:#fb7185}
@keyframes mod-pulse{0%,100%{box-shadow:0 0 0 4px rgba(52,211,153,.25)}50%{box-shadow:0 0 0 8px rgba(52,211,153,.08)}}
.mod-hero-stat{display:flex;flex-direction:column;gap:3px;padding-top:14px;border-top:1px solid rgba(255,255,255,.12);position:relative}
.mod-hero-stat-label{font-size:10px;letter-spacing:.14em;font-weight:800;color:rgba(255,255,255,.5)}
.mod-hero-stat-value{font-size:14px;font-weight:600}
.mod-empty{margin:0;font-size:13px;color:var(--text-dim)}
.mod-channel-list{display:flex;flex-direction:column;gap:10px}
.mod-channel{display:flex;align-items:center;gap:12px;padding:12px;border-radius:16px;
  background:var(--surface-2);border:1px solid var(--border);cursor:pointer;transition:border-color .2s ease,background .2s ease,transform .15s ease}
.mod-channel:hover{transform:translateY(-1px)}
.mod-channel-on{border-color:rgba(167,139,250,.45);background:rgba(167,139,250,.08)}
.mod-channel-icon{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px;flex:none;border:1px solid}
.mod-channel-info{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.mod-channel-info b{font-size:14px}
.mod-channel-info small{font-size:11px;color:var(--text-faint);text-transform:capitalize}
.mod-switch{position:relative;flex:none}
.mod-switch input{position:absolute;opacity:0;pointer-events:none}
.mod-switch-track{display:block;width:46px;height:28px;border-radius:99px;background:var(--border-strong);position:relative;
  transition:background .25s ease}
.mod-switch-thumb{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;
  transition:transform .3s cubic-bezier(.34,1.56,.64,1);box-shadow:0 2px 6px rgba(0,0,0,.35)}
.mod-switch input:checked + .mod-switch-track{background:linear-gradient(135deg,var(--accent),var(--accent-2))}
.mod-switch input:checked + .mod-switch-track .mod-switch-thumb{transform:translateX(18px)}
.mod-actions{display:flex;gap:10px;flex-wrap:wrap}
.mod-actions .mod-btn{flex:1;min-width:140px}
.mod-code{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:14px;
  background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.25);font-size:12px;color:var(--text-dim)}
.mod-code code{font-size:14px;font-weight:700;color:#67e8f9;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.mod-signout{align-self:center;margin-top:8px;background:transparent;border:0;color:var(--text-faint);
  font-size:13px;font-family:inherit;cursor:pointer;text-decoration:underline;padding:10px}
.mod-signout:hover{color:var(--text-dim)}
@keyframes mod-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
`;