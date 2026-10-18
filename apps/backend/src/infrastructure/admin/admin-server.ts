import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  AdminReport,
  AdminState,
  MessageLogEntryDto,
  ModerationEventSummary,
  ReportedUserSummary
} from "@anonymous-chat/shared/contracts";
import { API_PATHS, API_PREFIX } from "@anonymous-chat/shared/api";
import { AI_CHANNEL, conversationId as brandConversationId, userId as brandUserId } from "../../domain/types.js";
import type { MatchmakingConfig } from "../../application/matchmaking.js";
import type { MatchmakingService } from "../../application/matchmaking.js";
import type { ConversationRepository, MatchQueueRepository, UserRepository } from "../../ports/repositories.js";
import type { MessageLogRepository, ReportRepository } from "../../ports/reports.js";
import type { ModerationEventRepository } from "../../ports/moderation-events.js";
import { applyCors, handlePreflight } from "../http/cors.js";

export interface AdminServerOptions {
  readonly matchmaking: MatchmakingConfig;
  readonly authToken?: string;
}

interface AdminDeps {
  readonly users: UserRepository;
  readonly queue: MatchQueueRepository;
  readonly conversations: ConversationRepository;
  readonly reports: ReportRepository;
  readonly log: MessageLogRepository;
  readonly matching: MatchmakingService;
  readonly moderationEvents?: ModerationEventRepository;
}

export class AdminServer {
  constructor(private readonly deps: AdminDeps, private readonly options: AdminServerOptions) {}

  validateConfiguration(): void {
    if (process.env.NODE_ENV === "production" && !this.options.authToken) {
      throw new Error("ADMIN_TOKEN is required to run the admin API in production.");
    }
    if (!this.options.authToken) console.warn("[admin] ADMIN_TOKEN is unset; admin API is open to local requests.");
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.handle(req, res);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "OPTIONS") return handlePreflight(res);
    applyCors(res);
    const url = new URL(req.url ?? "/", "http://localhost");

    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const moderatorId = bearer ? await this.moderatorForToken(bearer) : undefined;
    const isAdmin = bearer === this.options.authToken || (!this.options.authToken && !moderatorId);
    if (url.pathname.startsWith(`${API_PREFIX}/`) && !isAdmin) {
      const moderatorPaths = new Set<string>([
        API_PATHS.moderator.me,
        API_PATHS.moderator.settings,
        API_PATHS.moderator.linkCode,
        API_PATHS.moderator.shadowBan
      ]);
      const allowedForModerator = Boolean(moderatorId) && moderatorPaths.has(url.pathname);
      if (!allowedForModerator) {
        res.statusCode = 401;
        res.setHeader("www-authenticate", "Bearer");
        res.end("Unauthorized");
        return;
      }
    }

    try {
      if (req.method === "GET" && url.pathname === API_PATHS.admin.state) return this.json(res, await this.buildSnapshot());
      if (req.method === "GET" && url.pathname === API_PATHS.admin.reports) {
        const reports: AdminReport[] = (await this.deps.reports.all()).map((report) => ({
          ...report,
          createdAt: report.createdAt.toISOString()
        }));
        return this.json(res, { reports });
      }
      if (req.method === "GET" && url.pathname === API_PATHS.admin.moderationEvents) {
        const events: ModerationEventSummary[] = (await this.deps.moderationEvents?.all() ?? []).map((event) => ({
          ...event,
          createdAt: event.createdAt.toISOString()
        }));
        return this.json(res, { events });
      }

      if (req.method === "POST" && url.pathname === API_PATHS.admin.shadowBanUser) {
        if (!isAdmin) { res.statusCode = 403; res.end("Admin permission required"); return; }
        const body = await readJson(req);
        const id = typeof body?.userId === "string" ? brandUserId(body.userId) : undefined;
        const banned = typeof body?.banned === "boolean" ? body.banned : undefined;
        if (!id || banned === undefined) { res.statusCode = 400; res.end("userId and banned required"); return; }
        const profile = await this.deps.users.profileFor(id);
        if (!profile) { res.statusCode = 404; res.end("Profile not found"); return; }
        await this.deps.users.saveProfile({ ...profile, shadowBanned: banned });
        if (banned) {
          await this.deps.queue.remove(id);
          const conversation = await this.deps.conversations.activeFor(id);
          if (conversation) await this.deps.conversations.save({ ...conversation, status: "ended" });
        }
        return this.json(res, { ok: true, userId: id, shadowBanned: banned });
      }

      if (req.method === "POST" && url.pathname === API_PATHS.admin.grantModerator) {
        if (!isAdmin) { res.statusCode = 403; res.end("Admin permission required"); return; }
        const body = await readJson(req);
        const id = typeof body?.userId === "string" ? brandUserId(body.userId) : undefined;
        const granted = typeof body?.granted === "boolean" ? body.granted : undefined;
        if (!id || granted === undefined) { res.statusCode = 400; res.end("userId and granted required"); return; }
        const profile = await this.deps.users.profileFor(id);
        if (!profile) { res.statusCode = 404; res.end("Profile not found"); return; }
        await this.deps.queue.remove(id);
        if (!granted) {
          await this.deps.users.saveProfile({ ...profile, moderator: false, moderatorAvailable: false, moderatorAccessHash: undefined, moderatorLinkCodeHash: undefined, moderatorLinkCodeExpiresAt: undefined });
          const active = await this.deps.conversations.activeFor(id);
          if (active) await this.deps.conversations.save({ ...active, status: "ended" });
          return this.json(res, { ok: true, granted: false });
        }
        const token = randomBytes(32).toString("base64url");
        await this.deps.users.saveProfile({ ...profile, moderator: true, moderatorAvailable: false, moderatorChannels: profile.moderatorChannels ?? [], moderatorAccessHash: hashToken(token) });
        return this.json(res, { ok: true, granted: true, token });
      }

      if (req.method === "GET" && url.pathname === API_PATHS.moderator.me) {
        if (!moderatorId) { res.statusCode = 401; res.end("Moderator token required"); return; }
        const profile = await this.deps.users.profileFor(moderatorId);
        const identities = (await this.deps.users.allIdentities()).filter((identity) => identity.userId === moderatorId && ["telegram", "whatsapp"].includes(identity.channel));
        const conversation = await this.deps.conversations.activeFor(moderatorId);
        return this.json(res, { userId: moderatorId, available: profile?.moderatorAvailable ?? false, channels: profile?.moderatorChannels ?? [], connectedChannels: [...new Set(identities.map((identity) => identity.channel))], activeConversationId: conversation?.id ?? null });
      }

      if (req.method === "PATCH" && url.pathname === API_PATHS.moderator.settings) {
        console.info(`[admin] PATCH ${API_PATHS.moderator.settings}`, { authenticated: Boolean(moderatorId) });
        if (!moderatorId) { console.warn("[admin] moderator settings rejected: missing moderator token"); res.statusCode = 401; res.end("Moderator token required"); return; }
        const body = await readJson(req);
        const available = typeof body?.available === "boolean" ? body.available : undefined;
        const channels = Array.isArray(body?.channels) && body.channels.every((channel) => channel === "telegram" || channel === "whatsapp" || channel === "web") ? [...new Set(body.channels as string[])] : undefined;
        const profile = await this.deps.users.profileFor(moderatorId);
        const connected = (await this.deps.users.allIdentities()).filter((identity) => identity.userId === moderatorId).map((identity) => identity.channel);
        if (!profile?.moderator || available === undefined || !channels || channels.some((channel) => !connected.includes(channel)) || (available && channels.length === 0)) {
          console.warn("[admin] moderator settings rejected", {
            moderator: Boolean(profile?.moderator),
            availableProvided: available !== undefined,
            channelsValid: Boolean(channels),
            requestedChannels: channels,
            connectedChannels: connected,
            availableRequiresChannel: Boolean(available && channels?.length === 0)
          });
          res.statusCode = 400; res.end("Choose at least one connected channel before going available"); return;
        }
        await this.deps.users.saveProfile({ ...profile, moderatorAvailable: available, moderatorChannels: channels });
        console.info("[admin] moderator settings updated", { available, channels });
        return this.json(res, { ok: true, available, channels });
      }

      if (req.method === "POST" && url.pathname === API_PATHS.moderator.linkCode) {
        if (!moderatorId) { res.statusCode = 401; res.end("Moderator token required"); return; }
        const profile = await this.deps.users.profileFor(moderatorId);
        if (!profile?.moderator) { res.statusCode = 403; res.end("Moderator permission required"); return; }
        const code = randomBytes(6).toString("hex");
        await this.deps.users.saveProfile({ ...profile, moderatorLinkCodeHash: hashToken(code), moderatorLinkCodeExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
        return this.json(res, { code, expiresInSeconds: 600 });
      }

      if (req.method === "POST" && url.pathname === API_PATHS.moderator.shadowBan) {
        if (!moderatorId) { res.statusCode = 401; res.end("Moderator token required"); return; }
        const body = await readJson(req);
        const id = typeof body?.userId === "string" ? brandUserId(body.userId) : undefined;
        const banned = typeof body?.banned === "boolean" ? body.banned : undefined;
        if (!id || banned === undefined || id === moderatorId) { res.statusCode = 400; res.end("A different user and banned status are required"); return; }
        const profile = await this.deps.users.profileFor(id);
        if (!profile) { res.statusCode = 404; res.end("Profile not found"); return; }
        await this.deps.users.saveProfile({ ...profile, shadowBanned: banned });
        if (banned) {
          await this.deps.queue.remove(id);
          const conversation = await this.deps.conversations.activeFor(id);
          if (conversation) await this.deps.conversations.save({ ...conversation, status: "ended" });
        }
        return this.json(res, { ok: true, userId: id, shadowBanned: banned });
      }

      if (req.method === "GET" && url.pathname === API_PATHS.admin.reportedUsers) {
        const reports = await this.deps.reports.all();
        const grouped = new Map<string, { reportedUserId: string; reports: number; latestReportAt: Date }>();
        for (const report of reports) {
          const key = report.reportedId;
          const existing = grouped.get(key);
          grouped.set(key, {
            reportedUserId: key,
            reports: (existing?.reports ?? 0) + 1,
            latestReportAt: !existing || report.createdAt > existing.latestReportAt ? report.createdAt : existing.latestReportAt
          });
        }
        const users: ReportedUserSummary[] = [...grouped.values()]
          .sort((a, b) => b.reports - a.reports)
          .map((summary) => ({ ...summary, latestReportAt: summary.latestReportAt.toISOString() }));
        return this.json(res, { users });
      }

      if (req.method === "POST" && url.pathname === API_PATHS.admin.operatorLogin) {
        const body = await readJson(req);
        const displayName = typeof body?.displayName === "string" ? body.displayName.trim().slice(0, 32) : "";
        if (!displayName) { res.statusCode = 400; res.end("displayName required"); return; }
        const identity = await this.deps.users.findOrCreate({
          channel: "operator",
          externalId: `${displayName}:${crypto.randomUUID()}`
        });
        return this.json(res, { operatorUserId: identity.userId, displayName });
      }

      if (req.method === "POST" && url.pathname === API_PATHS.admin.watch) {
        const body = await readJson(req);
        const id = typeof body?.conversationId === "string" ? body.conversationId : undefined;
        if (!id) { res.statusCode = 400; res.end("conversationId required"); return; }
        this.deps.log.watch(brandConversationId(id));
        return this.json(res, { ok: true });
      }
      if (req.method === "DELETE" && url.pathname === API_PATHS.admin.watch) {
        const id = url.searchParams.get("conversationId");
        if (!id) { res.statusCode = 400; res.end("conversationId required"); return; }
        this.deps.log.unwatch(brandConversationId(id));
        return this.json(res, { ok: true });
      }
      if (req.method === "GET" && url.pathname === API_PATHS.admin.watch) {
        const id = url.searchParams.get("conversationId");
        if (!id) { res.statusCode = 400; res.end("conversationId required"); return; }
        const entries: MessageLogEntryDto[] = this.deps.log.entriesFor(brandConversationId(id)).map((entry) => ({
          ...entry,
          timestamp: entry.timestamp.toISOString()
        }));
        return this.json(res, { entries });
      }

      if (req.method === "POST" && url.pathname === API_PATHS.admin.operatorMatch) {
        const body = await readJson(req);
        const operatorUserId = typeof body?.operatorUserId === "string" ? body.operatorUserId : undefined;
        const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId : undefined;
        if (!operatorUserId || !targetUserId) { res.statusCode = 400; res.end("operatorUserId and targetUserId required"); return; }
        const conversation = await this.deps.matching.forceOperatorMatch(
          operatorUserId as never,
          targetUserId as never
        );
        if (!conversation) { res.statusCode = 409; res.end("Match not possible"); return; }
        return this.json(res, { conversation });
      }

      res.statusCode = 404;
      res.end("Not found");
    } catch (error) {
      console.error("[admin] request failed", error);
      res.statusCode = 500;
      res.end("Failed");
    }
  }

  private json(res: ServerResponse, payload: unknown): void {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(payload));
  }

  private async buildSnapshot(): Promise<AdminState> {
    const now = Date.now();
    const identities = await this.deps.users.allIdentities();
    const queue = await this.deps.queue.entries();
    const conversations = await this.deps.conversations.all();

    const waitingByUser = new Map<string, number>();
    for (const entry of queue) waitingByUser.set(entry.userId, now - entry.enqueuedAt.getTime());

    const activeByUser = new Map<string, string>();
    for (const conversation of conversations) {
      if (conversation.status !== "active") continue;
      for (const participant of conversation.participants) activeByUser.set(participant.userId, conversation.id);
    }

    const users = [];
    for (const identity of identities) {
      if (identity.channel === AI_CHANNEL) continue;
      const eligibility = await this.deps.users.eligibilityFor(identity.userId);
      const profile = await this.deps.users.profileFor(identity.userId);
      users.push({
        userId: identity.userId,
        channel: identity.channel,
        externalId: identity.externalId,
        eligibility: eligibility?.status ?? "none",
        profile: profile ? {
          gender: profile.gender,
          country: profile.country,
          preferredGender: profile.preferredGender,
          preferredCountry: profile.preferredCountry,
          priorityTier: profile.priorityTier,
          shadowBanned: profile.shadowBanned,
          moderator: profile.moderator,
          moderatorAvailable: profile.moderatorAvailable
        } : null,
        waitingMs: waitingByUser.get(identity.userId) ?? null,
        conversationId: activeByUser.get(identity.userId) ?? null
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      matchmaking: this.options.matchmaking,
      aiThresholdMs: this.deps.matching.aiThresholdMs(queue.length),
      queueSize: queue.length,
      users,
      watchedConversationIds: this.deps.log.watchedConversations(),
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        status: conversation.status,
        kind: conversation.kind ?? "human",
        createdAt: conversation.createdAt.toISOString(),
        participants: conversation.participants
          .filter((p) => p.identity.channel !== AI_CHANNEL)
          .map((participant) => ({
            userId: participant.userId,
            channel: participant.identity.channel,
            externalId: participant.identity.externalId
          }))
      }))
    };
  }

  private async moderatorForToken(token: string): Promise<import("../../domain/types.js").UserId | undefined> {
    if (!token) return undefined;
    const candidate = Buffer.from(hashToken(token), "hex");
    const identities = await this.deps.users.allIdentities();
    for (const id of new Set(identities.map((identity) => identity.userId))) {
      const profile = await this.deps.users.profileFor(id);
      if (!profile?.moderator || !profile.moderatorAccessHash) continue;
      const expected = Buffer.from(profile.moderatorAccessHash, "hex");
      if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return id;
    }
    return undefined;
  }
}

const hashToken = (value: string): string => createHash("sha256").update(value).digest("hex");

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown> | undefined> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; }
  catch { return undefined; }
};
