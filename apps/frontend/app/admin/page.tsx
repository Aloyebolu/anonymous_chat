"use client";
import { useCallback, useEffect, useState } from "react";
import { ConversationList } from "@/components/admin/ConversationList";
import { QueueTable } from "@/components/admin/QueueTable";
import { ReportsTable } from "@/components/admin/ReportsTable";
import { UserTable } from "@/components/admin/UserTable";
import { WatchPanel } from "@/components/admin/WatchPanel";
import { STRINGS } from "@/lib/constants";
import { useAdminState } from "@/lib/hooks/useAdminState";
import type { ModerationEventSummary, ReportedUserSummary } from "@anonymous-chat/shared/contracts";
import { createOperatorSession, fetchModerationEvents, fetchReportedUsers, operatorMatch, readAdminToken, setModerator, setShadowBan, unwatchConversation, watchConversation, writeAdminToken } from "@/lib/services/admin";

export default function AdminPage() {
  const { state, reports, refresh } = useAdminState();
  const [inspectedConversation, setInspectedConversation] = useState<string | null>(null);
  const [operatorUserId, setOperatorUserId] = useState<string>("");
  const [operatorName, setOperatorName] = useState<string>("");
  const [reportedUsers, setReportedUsers] = useState<ReportedUserSummary[]>([]);
  const [moderationEvents, setModerationEvents] = useState<ModerationEventSummary[]>([]);
  const [adminToken, setAdminToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issuedModeratorToken, setIssuedModeratorToken] = useState("");

  useEffect(() => {
    setAdminToken(readAdminToken());
    setOperatorUserId(window.localStorage.getItem("operatorUserId") ?? "");
    setOperatorName(window.localStorage.getItem("operatorName") ?? "");
  }, []);

  useEffect(() => {
    void fetchReportedUsers().then((result) => setReportedUsers(result.users)).catch(() => setReportedUsers([]));
    void fetchModerationEvents().then((result) => setModerationEvents(result.events)).catch(() => setModerationEvents([]));
  }, [reports]);

  const handleOperatorLogin = useCallback(async () => {
    try {
      const session = await createOperatorSession(operatorName);
      setOperatorUserId(session.operatorUserId);
      window.localStorage.setItem("operatorUserId", session.operatorUserId);
      window.localStorage.setItem("operatorName", session.displayName);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : STRINGS.operatorLoginFailed);
    }
  }, [operatorName]);

  const handleShadowBan = useCallback(async (userId: string, banned: boolean) => {
    try {
      await setShadowBan(userId, banned);
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : STRINGS.operatorMatchFailed);
    }
  }, [refresh]);

  const handleModerator = useCallback(async (userId: string, granted: boolean) => {
    try {
      const result = await setModerator(userId, granted);
      setIssuedModeratorToken(result.token ?? "");
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update moderator access");
    }
  }, [refresh]);

  const handleWatch = useCallback(async (id: string) => {
    await watchConversation(id);
    setInspectedConversation(id);
    await refresh();
  }, [refresh]);

  const handleUnwatch = useCallback(async (id: string) => {
    await unwatchConversation(id);
    if (inspectedConversation === id) setInspectedConversation(null);
    await refresh();
  }, [inspectedConversation, refresh]);

  const handleOperatorMatch = useCallback(async (targetUserId: string) => {
    if (!operatorUserId) { setError("Enter an operator user id first (channel:externalId of a keeper)."); return; }
    try {
      await operatorMatch(operatorUserId, targetUserId);
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : STRINGS.operatorMatchFailed);
    }
  }, [operatorUserId, refresh]);

  return (
    <main>
      <h1 style={{ padding: "16px 16px 0" }}>{STRINGS.adminTitle}</h1>
      <p className="muted" style={{ padding: "0 16px" }}>
        {state ? `generated ${state.generatedAt} · queue ${state.queueSize} · AI threshold ${Math.round(state.aiThresholdMs / 1000)}s` : STRINGS.adminLoading}
      </p>
      <section className="card" style={{ margin: 16 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {STRINGS.adminTokenLabel}
          <input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} autoComplete="current-password" />
          <button onClick={() => { writeAdminToken(adminToken.trim()); void refresh(); }}>{STRINGS.adminTokenSave}</button>
        </label>
        <p className="muted">{STRINGS.adminTokenHelp}</p>
      </section>
      {error && <p style={{ padding: "0 16px", color: "#721c24" }}>{error}</p>}
      {issuedModeratorToken && <section className="card" style={{ margin: 16, border: "2px solid #6c5ce7" }}><h2>Moderator access token — copy it now</h2><p>This secret is shown once. Share it privately with the moderator. They can open <code>/moderator</code> and connect another channel from that page.</p><input readOnly value={issuedModeratorToken} onFocus={(event) => event.currentTarget.select()} style={{ width: "100%" }} /><button onClick={() => { void navigator.clipboard.writeText(issuedModeratorToken); }}>Copy token</button><button onClick={() => setIssuedModeratorToken("")}>Dismiss</button></section>}

      <div className="admin-grid">
        <section className="card">
          <h2>{STRINGS.queueTitle}</h2>
          {state && <QueueTable users={state.users} onOperatorMatch={handleOperatorMatch} />}
        </section>

        <section className="card">
          <h2>{STRINGS.activeTitle}</h2>
          {state && (
            <ConversationList
              conversations={state.conversations}
              watched={state.watchedConversationIds}
              onWatch={handleWatch}
              onUnwatch={handleUnwatch}
              onInspect={setInspectedConversation}
            />
          )}
        </section>

        <section className="card">
          <h2>{STRINGS.watchTitle}</h2>
          <WatchPanel conversationId={inspectedConversation} onClose={() => setInspectedConversation(null)} />
        </section>

        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>Operator</h2>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {STRINGS.operatorName}
            <input value={operatorName} onChange={(e) => setOperatorName(e.target.value)} placeholder={STRINGS.operatorNamePlaceholder} maxLength={32} />
            <button onClick={() => void handleOperatorLogin()} disabled={!operatorName.trim()}>{STRINGS.operatorLogin}</button>
          </label>
          {operatorUserId && <p className="muted">{STRINGS.operatorSignedIn}</p>}
        </section>

        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>{STRINGS.reportsTitle}</h2>
          <ReportsTable reports={reports} />
        </section>

        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>{STRINGS.usersTitle}</h2>
          {state && <UserTable users={state.users} onShadowBan={(id, banned) => void handleShadowBan(id, banned)} onModerator={(id, granted) => void handleModerator(id, granted)} />}
        </section>

        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>{STRINGS.reportedUsers}</h2>
          {reportedUsers.length === 0 ? <p className="muted">{STRINGS.noReports}</p> : (
            <table><thead><tr><th>{STRINGS.tableUser}</th><th>{STRINGS.reportCount}</th><th>{STRINGS.tableWhen}</th></tr></thead>
              <tbody>{reportedUsers.map((item) => <tr key={item.reportedUserId}><td><code>{item.reportedUserId}</code></td><td>{item.reports}</td><td>{new Date(item.latestReportAt).toLocaleString()}</td></tr>)}</tbody>
            </table>
          )}
        </section>

        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>{STRINGS.moderationTitle}</h2>
          {moderationEvents.length === 0 ? <p className="muted">{STRINGS.moderationEmpty}</p> : (
            <table><thead><tr><th>{STRINGS.tableUser}</th><th>{STRINGS.moderationReason}</th><th>{STRINGS.moderationScore}</th><th>{STRINGS.tableWhen}</th></tr></thead>
              <tbody>{moderationEvents.slice(-50).reverse().map((event) => <tr key={event.id}><td><code>{event.userId}</code></td><td>{event.reason}</td><td>{event.score}</td><td>{new Date(event.createdAt).toLocaleString()}</td></tr>)}</tbody>
            </table>
          )}
        </section>

        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>{STRINGS.configTitle}</h2>
          <pre style={{ background: "#f8f8f8", padding: 10, borderRadius: 6, overflow: "auto", fontSize: 12 }}>
            {state ? JSON.stringify(state.matchmaking, null, 2) : ""}
          </pre>
        </section>
      </div>
    </main>
  );
}
