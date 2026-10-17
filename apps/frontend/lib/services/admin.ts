import type { AdminReport, AdminState, MessageLogEntry } from "../types";

const ADMIN = process.env.NEXT_PUBLIC_ADMIN_API ?? "http://localhost:3001";

export const readAdminToken = (): string => window.sessionStorage.getItem("adminToken") ?? "";
export const writeAdminToken = (token: string): void => {
  if (token) window.sessionStorage.setItem("adminToken", token);
  else window.sessionStorage.removeItem("adminToken");
};

const adminFetch = (path: string, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers);
  const token = readAdminToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(`${ADMIN}${path}`, { ...init, headers });
};

export const fetchState = async (): Promise<AdminState> => {
  const res = await adminFetch("/api/state");
  if (!res.ok) throw new Error(`state failed: ${res.status}`);
  return (await res.json()) as AdminState;
};

export const fetchReports = async (): Promise<{ reports: AdminReport[] }> => {
  const res = await adminFetch("/api/reports");
  if (!res.ok) throw new Error(`reports failed: ${res.status}`);
  return (await res.json()) as { reports: AdminReport[] };
};

export const watchConversation = async (conversationId: string): Promise<void> => {
  const res = await adminFetch("/api/watch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId })
  });
  if (!res.ok) throw new Error(`watch failed: ${res.status}`);
};

export const unwatchConversation = async (conversationId: string): Promise<void> => {
  const res = await adminFetch(`/api/watch?conversationId=${encodeURIComponent(conversationId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`unwatch failed: ${res.status}`);
};

export const fetchWatchLog = async (conversationId: string): Promise<{ entries: MessageLogEntry[] }> => {
  const res = await adminFetch(`/api/watch?conversationId=${encodeURIComponent(conversationId)}`);
  if (!res.ok) throw new Error(`watch log failed: ${res.status}`);
  return (await res.json()) as { entries: MessageLogEntry[] };
};

export const operatorMatch = async (operatorUserId: string, targetUserId: string): Promise<{ conversation: { id: string } }> => {
  const res = await adminFetch("/api/operator/match", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operatorUserId, targetUserId })
  });
  if (!res.ok) throw new Error(`operator match failed: ${res.status}`);
  return (await res.json()) as { conversation: { id: string } };
};

export const createOperatorSession = async (displayName: string): Promise<{ operatorUserId: string; displayName: string }> => {
  const res = await adminFetch("/api/operator/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName })
  });
  if (!res.ok) throw new Error(`operator login failed: ${res.status}`);
  return (await res.json()) as { operatorUserId: string; displayName: string };
};

export const setShadowBan = async (targetUserId: string, banned: boolean): Promise<void> => {
  const res = await adminFetch("/api/user/shadow-ban", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: targetUserId, banned })
  });
  if (!res.ok) throw new Error(`shadow ban update failed: ${res.status}`);
};

export const setModerator = async (targetUserId: string, granted: boolean): Promise<{ token?: string }> => {
  const res = await adminFetch("/api/moderators/grant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: targetUserId, granted })
  });
  if (!res.ok) throw new Error(`moderator update failed: ${res.status}`);
  return await res.json() as { token?: string };
};

export interface ReportedUserSummary { reportedUserId: string; reports: number; latestReportAt: string }
export const fetchReportedUsers = async (): Promise<{ users: ReportedUserSummary[] }> => {
  const res = await adminFetch("/api/reported-users");
  if (!res.ok) throw new Error(`reported users failed: ${res.status}`);
  return (await res.json()) as { users: ReportedUserSummary[] };
};

export interface ModerationEventSummary { id: string; userId: string; reason: string; createdAt: string; messageLength: number; score: number }
export const fetchModerationEvents = async (): Promise<{ events: ModerationEventSummary[] }> => {
  const res = await adminFetch("/api/moderation-events");
  if (!res.ok) throw new Error(`moderation events failed: ${res.status}`);
  return (await res.json()) as { events: ModerationEventSummary[] };
};
