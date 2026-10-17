"use client";

import { useCallback, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_ADMIN_API;
type ModeratorState = { userId: string; available: boolean; channels: string[]; connectedChannels: string[]; activeConversationId: string | null };

export default function ModeratorPage() {
  const [token, setToken] = useState("");
  const [state, setState] = useState<ModeratorState | null>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const [available, setAvailable] = useState(false);
  const [linkCode, setLinkCode] = useState("");
  const [banId, setBanId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...init.headers } });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
    return body;
  }, [token]);

  const refresh = useCallback(async () => {
    try {
      const data = await request("/api/moderator/me") as unknown as ModeratorState;
      setState(data); setChannels(data.channels); setAvailable(data.available); setError("");
      window.sessionStorage.setItem("moderatorToken", token);
    } catch (reason) { setState(null); setError(reason instanceof Error ? reason.message : "Could not load moderator account"); }
  }, [request, token]);

  useEffect(() => { setToken(window.sessionStorage.getItem("moderatorToken") ?? ""); }, []);
  useEffect(() => { if (token) void refresh(); }, [token, refresh]);

  const save = async (nextAvailable = available, nextChannels = channels) => {
    try {
      await request("/api/moderator/settings", { method: "PATCH", body: JSON.stringify({ available: nextAvailable, channels: nextChannels }) });
      setAvailable(nextAvailable); setChannels(nextChannels); setNotice(nextAvailable ? "You’re available for support chats." : "You’re offline.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save settings"); }
  };

  const createLinkCode = async () => {
    try { const result = await request("/api/moderator/link-code", { method: "POST", body: "{}" }); setLinkCode(String(result.code)); setNotice("Code expires in 10 minutes. Send it from the other channel as /modlink CODE."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create link code"); }
  };

  const setShadowBan = async (banned: boolean) => {
    try { await request("/api/moderator/shadow-ban", { method: "POST", body: JSON.stringify({ userId: banId.trim(), banned }) }); setNotice(banned ? "Account shadow-banned." : "Shadow-ban lifted."); setBanId(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update account"); }
  };

  return <main style={{ maxWidth: 720, margin: "32px auto", padding: 20 }}>
    <h1>Moderator space</h1>
    <p className="muted">Manage your availability and help users who need a human connection.</p>
    {!state ? <section className="card"><label>Moderator access token <input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="current-password" /></label><button onClick={() => void refresh()} disabled={!token}>Connect</button></section> : <>
      <section className="card" style={{ marginTop: 16 }}><h2>{available ? "Available for chats" : "Currently offline"}</h2><p>Active conversation: {state.activeConversationId ? "You’re helping someone now" : "None"}</p>
        <h3>Connected channels</h3>{state.connectedChannels.length ? state.connectedChannels.map((channel) => <label key={channel} style={{ display: "block", padding: 8 }}><input type="checkbox" checked={channels.includes(channel)} onChange={(event) => { const next = event.target.checked ? [...channels, channel] : channels.filter((item) => item !== channel); setChannels(next); void save(available, next); }} /> {channel}</label>) : <p>No chat channels linked yet.</p>}
        <button disabled={channels.length === 0} onClick={() => void save(!available)}>{available ? "Opt out" : "Opt in to support chats"}</button>
        <button onClick={() => void createLinkCode()} style={{ marginLeft: 8 }}>Connect another device/channel</button>
        {linkCode && <p>Send <code>/modlink {linkCode}</code> to the bot from the account you want to link.</p>}
      </section>
      <section className="card" style={{ marginTop: 16 }}><h2>Account safety</h2><p>Shadow-ban prevents a user from messaging or entering matchmaking. Use only when needed for safety.</p><label>User ID <input value={banId} onChange={(event) => setBanId(event.target.value)} placeholder="Paste user ID from the admin report" /></label><button disabled={!banId.trim()} onClick={() => void setShadowBan(true)}>Shadow-ban user</button><button disabled={!banId.trim()} onClick={() => void setShadowBan(false)} style={{ marginLeft: 8 }}>Lift shadow-ban</button></section>
      <button style={{ marginTop: 16 }} onClick={() => { window.sessionStorage.removeItem("moderatorToken"); setToken(""); setState(null); }}>Sign out</button>
    </>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" style={{ color: "#a22" }}>{error}</p>}
  </main>;
}
