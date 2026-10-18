import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type {
  AdminLiveUpdate,
  AdminReport,
  AdminState,
  MessageLogEntryDto,
  ModerationEventSummary,
  ModeratorLiveState,
  OperatorLiveState,
  ReportedUserSummary
} from "@anonymous-chat/shared/contracts";
import { API_PATHS, API_PREFIX } from "@anonymous-chat/shared/api";
import { AI_CHANNEL, conversationId as brandConversationId, userId as brandUserId, type CommunicationIdentity, type UserId, type UserProfile } from "../../domain/types.js";
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
  readonly sendModeratorNotice?: (identity: CommunicationIdentity, text: string) => Promise<void>;
  readonly sendStaffMessage?: (staffId: UserId, conversationId: string, text: string) => Promise<boolean>;
  readonly endStaffSession?: (staffId: UserId, conversationId: string) => Promise<boolean>;
}

type LiveSocket = {
  readonly socket: WebSocket;
  readonly role:
    | { readonly type: "admin" }
    | { readonly type: "moderator"; readonly userId: UserId }
    | { readonly type: "operator"; readonly userId: UserId };
};

export class AdminServer {
  private webSocketServer?: WebSocketServer;
  private readonly liveSockets = new Set<LiveSocket>();

  constructor(private readonly deps: AdminDeps, private readonly options: AdminServerOptions) {}

  attachWebSocket(server: Server): void {
    if (this.webSocketServer) throw new Error("Admin WebSocket server is already attached.");
    const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    this.webSocketServer = webSocketServer;
    server.on("upgrade", (request, socket, head) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path !== API_PATHS.admin.live) return;
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        webSocketServer.emit("connection", webSocket, request);
      });
    });
    webSocketServer.on("connection", (socket, request) => {
      void this.authenticateLiveSocket(socket, request);
    });
  }

  async publishLiveUpdates(): Promise<void> {
    const admins = [...this.liveSockets].filter((client) => client.role.type === "admin");
    if (admins.length) {
      const update = await this.buildLiveUpdate();
      for (const client of admins) this.sendSocket(client.socket, update);
    }
    const moderators = [...this.liveSockets].filter((client) => client.role.type === "moderator");
    await Promise.all(moderators.map(async (client) => {
      if (client.role.type !== "moderator") return;
      const state = await this.buildModeratorState(client.role.userId);
      this.sendSocket(client.socket, { type: "moderator-update", userId: client.role.userId, state });
    }));
    const operators = [...this.liveSockets].filter((client) => client.role.type === "operator");
    await Promise.all(operators.map(async (client) => {
      if (client.role.type !== "operator") return;
      const state = await this.buildOperatorState(client.role.userId);
      this.sendSocket(client.socket, { type: "operator-update", state });
    }));
  }

  async close(): Promise<void> {
    for (const client of this.liveSockets) client.socket.close(1001, "Server shutting down");
    this.liveSockets.clear();
    if (this.webSocketServer) {
      await new Promise<void>((resolve) => this.webSocketServer!.close(() => resolve()));
      this.webSocketServer = undefined;
    }
  }

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
    const operatorId = bearer ? await this.operatorForToken(bearer) : undefined;
    const isAdmin = bearer === this.options.authToken || (!this.options.authToken && !moderatorId && !operatorId);
    if (url.pathname.startsWith(`${API_PREFIX}/`) && !isAdmin) {
      const moderatorPaths = new Set<string>([
        API_PATHS.moderator.me,
        API_PATHS.moderator.settings,
        API_PATHS.moderator.linkCode,
        API_PATHS.moderator.shadowBan,
        API_PATHS.moderator.participantProfile,
        API_PATHS.moderator.notice,
        API_PATHS.moderator.message,
        API_PATHS.moderator.sessionCommand,
        API_PATHS.operator.me,
        API_PATHS.operator.settings,
        API_PATHS.operator.message,
        API_PATHS.operator.sessionCommand
      ]);
      const allowedForStaff = (Boolean(moderatorId) || Boolean(operatorId)) && moderatorPaths.has(url.pathname) &&
        (moderatorId ? !url.pathname.startsWith(`${API_PREFIX}/operator/`) : url.pathname.startsWith(`${API_PREFIX}/operator/`));
      if (!allowedForStaff) {
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
        return this.json(res, { userId: moderatorId, ...await this.buildModeratorState(moderatorId) });
      }

      if (req.method === "POST" && url.pathname === API_PATHS.moderator.message) {
        if (!moderatorId) { res.statusCode = 401; res.end("Moderator token required"); return; }
        const body = await readJson(req);
        const conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;
        const text = typeof body?.text === "string" ? body.text : undefined;
        if (!conversationId || !text || !this.deps.sendStaffMessage) {
          res.statusCode = 400; res.end("conversationId and text required"); return;
        }
        const sent = await this.deps.sendStaffMessage(moderatorId, conversationId, text);
        if (!sent) { res.statusCode = 403; res.end("Message could not be sent to that active support session"); return; }
        await this.publishLiveUpdates();
        return this.json(res, { ok: true });
      }

      if (req.method === "POST" && url.pathname === API_PATHS.moderator.sessionCommand) {
        if (!moderatorId) { res.statusCode = 401; res.end("Moderator token required"); return; }
        const body = await readJson(req);
        const conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;
        if (!conversationId || body?.command !== "end" || !this.deps.endStaffSession) {
          res.statusCode = 400; res.end("conversationId and a supported command are required"); return;
        }
        const ended = await this.deps.endStaffSession(moderatorId, conversationId);
        if (!ended) { res.statusCode = 403; res.end("Command could not be applied to that active support session"); return; }
        await this.publishLiveUpdates();
        return this.json(res, { ok: true });
      }

      if (req.method === "GET" && url.pathname === API_PATHS.operator.me) {
        if (!operatorId) { res.statusCode = 401; res.end("Operator token required"); return; }
        return this.json(res, await this.buildOperatorState(operatorId));
      }

      if (req.method === "PATCH" && url.pathname === API_PATHS.operator.settings) {
        if (!operatorId) { res.statusCode = 401; res.end("Operator token required"); return; }
        const body = await readJson(req);
        const available = typeof body?.available === "boolean" ? body.available : undefined;
        const sessionLimit = typeof body?.sessionLimit === "number" ? body.sessionLimit : undefined;
        const profile = await this.deps.users.profileFor(operatorId);
        if (!profile?.operator || available === undefined || sessionLimit === undefined ||
          !Number.isInteger(sessionLimit) || sessionLimit < 1 || sessionLimit > 10) {
          res.statusCode = 400; res.end("available and a sessionLimit from 1 to 10 are required"); return;
        }
        await this.deps.users.saveProfile({ ...profile, operatorAvailable: available, operatorSessionLimit: sessionLimit });
        await this.publishLiveUpdates();
        return this.json(res, { ok: true, available, sessionLimit });
      }

      if (req.method === "POST" && url.pathname === API_PATHS.operator.message) {
        if (!operatorId) { res.statusCode = 401; res.end("Operator token required"); return; }
        const body = await readJson(req);
        const conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;
        const text = typeof body?.text === "string" ? body.text : undefined;
        if (!conversationId || !text || !this.deps.sendStaffMessage) {
          res.statusCode = 400; res.end("conversationId and text required"); return;
        }
        const sent = await this.deps.sendStaffMessage(operatorId, conversationId, text);
        if (!sent) { res.statusCode = 403; res.end("Message could not be sent to that active operator session"); return; }
        await this.publishLiveUpdates();
        return this.json(res, { ok: true });
      }

      if (req.method === "POST" && url.pathname === API_PATHS.operator.sessionCommand) {
        if (!operatorId) { res.statusCode = 401; res.end("Operator token required"); return; }
        const body = await readJson(req);
        const conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;
        if (!conversationId || body?.command !== "end" || !this.deps.endStaffSession) {
          res.statusCode = 400; res.end("conversationId and a supported command are required"); return;
        }
        const ended = await this.deps.endStaffSession(operatorId, conversationId);
        if (!ended) { res.statusCode = 403; res.end("Command could not be applied to that active support session"); return; }
        await this.publishLiveUpdates();
        return this.json(res, { ok: true });
      }

      if (req.method === "PATCH" && url.pathname === API_PATHS.moderator.participantProfile) {
        if (!moderatorId) { res.statusCode = 401; res.end("Moderator token required"); return; }
        const body = await readJson(req) ?? {};
        const targetId = typeof body.userId === "string" ? brandUserId(body.userId) : undefined;
        if (!targetId || !await this.isAssignedModerator(moderatorId, targetId)) {
          res.statusCode = 403; res.end("You can only update the user in your active support chat"); return;
        }
        const profile = await this.deps.users.profileFor(targetId);
        if (!profile) { res.statusCode = 404; res.end("User profile not found"); return; }
        const update: Record<string, unknown> = {};
        if (body.displayName !== undefined) {
          if (typeof body.displayName !== "string" || body.displayName.trim().length > 28) { res.statusCode = 400; res.end("Display name must be 28 characters or fewer"); return; }
          update.displayName = body.displayName.trim() || undefined;
        }
        if (body.age !== undefined) {
          if (!Number.isInteger(body.age) || Number(body.age) < 18 || Number(body.age) > 99) { res.statusCode = 400; res.end("Age must be between 18 and 99"); return; }
          update.age = Number(body.age);
        }
        if (body.gender !== undefined) {
          if (!["male", "female", "nonbinary"].includes(String(body.gender))) { res.statusCode = 400; res.end("Invalid gender"); return; }
          update.gender = body.gender as UserProfile["gender"];
        }
        if (body.country !== undefined) {
          if (typeof body.country !== "string" || body.country.trim().length < 2 || body.country.trim().length > 56) { res.statusCode = 400; res.end("Country must be 2–56 characters"); return; }
          update.country = body.country.trim();
        }
        if (body.preferredGender !== undefined) {
          if (!["male", "female", "nonbinary", "any"].includes(String(body.preferredGender))) { res.statusCode = 400; res.end("Invalid preferred gender"); return; }
          update.preferredGender = body.preferredGender as UserProfile["preferredGender"];
        }
        if (body.preferredCountry !== undefined) {
          if (typeof body.preferredCountry !== "string" || body.preferredCountry.trim().length > 56) { res.statusCode = 400; res.end("Preferred country must be 56 characters or fewer"); return; }
          update.preferredCountry = body.preferredCountry.trim() || undefined;
        }
        if (!Object.keys(update).length) { res.statusCode = 400; res.end("At least one editable profile field is required"); return; }
        await this.deps.users.saveProfile({ ...profile, ...update } as UserProfile);
        return this.json(res, { ok: true, participant: await this.buildModeratorState(moderatorId).then((state) => state.participant) });
      }

      if (req.method === "POST" && url.pathname === API_PATHS.moderator.notice) {
        if (!moderatorId) { res.statusCode = 401; res.end("Moderator token required"); return; }
        const body = await readJson(req);
        const targetId = typeof body?.userId === "string" ? brandUserId(body.userId) : undefined;
        const template = typeof body?.template === "string" ? body.template : undefined;
        if (!targetId || !await this.isAssignedModerator(moderatorId, targetId)) {
          res.statusCode = 403; res.end("You can only send notices in your active support chat"); return;
        }
        const notices: Record<string, string> = {
          welcome: "<b>✨ Welcome to your support chat</b>\n\nA moderator is here to listen and help. Take your time—there's no pressure to share anything you're not comfortable sharing.",
          kindness: "<blockquote>💛 A little kindness goes a long way.</blockquote>\n\nWe're glad you're here. Let your moderator know what would make this chat more helpful for you.",
          safety: "<b>🛡️ Your safety comes first</b>\n\nYou can end this conversation at any time. If anything feels uncomfortable, tell your moderator or use <code>/report</code>."
        };
        const text = template ? notices[template] : undefined;
        const identity = await this.deps.users.identityFor(targetId);
        if (!text || !identity) { res.statusCode = 400; res.end("Choose a valid notice and active participant"); return; }
        if (!this.deps.sendModeratorNotice) { res.statusCode = 503; res.end("Moderator notices are unavailable"); return; }
        await this.deps.sendModeratorNotice(identity, text);
        return this.json(res, { ok: true });
      }

      if (req.method === "PATCH" && url.pathname === API_PATHS.moderator.settings) {
        console.info(`[admin] PATCH ${API_PATHS.moderator.settings}`, { authenticated: Boolean(moderatorId) });
        if (!moderatorId) { console.warn("[admin] moderator settings rejected: missing moderator token"); res.statusCode = 401; res.end("Moderator token required"); return; }
        const body = await readJson(req);
        const available = typeof body?.available === "boolean" ? body.available : undefined;
        const channels = Array.isArray(body?.channels) && body.channels.every((channel) => channel === "telegram" || channel === "whatsapp" || channel === "web") ? [...new Set(body.channels as string[])] : undefined;
        const sessionLimit = typeof body?.sessionLimit === "number" ? body.sessionLimit : undefined;
        const profile = await this.deps.users.profileFor(moderatorId);
        const connected = (await this.deps.users.allIdentities()).filter((identity) => identity.userId === moderatorId).map((identity) => identity.channel);
        if (!profile?.moderator || available === undefined || !channels ||
          channels.some((channel) => !connected.includes(channel)) || (available && channels.length === 0) ||
          sessionLimit === undefined || !Number.isInteger(sessionLimit) || sessionLimit < 1 || sessionLimit > 10) {
          console.warn("[admin] moderator settings rejected", {
            moderator: Boolean(profile?.moderator),
            availableProvided: available !== undefined,
            channelsValid: Boolean(channels),
            requestedChannels: channels,
            connectedChannels: connected,
            availableRequiresChannel: Boolean(available && channels?.length === 0),
            sessionLimit
          });
          res.statusCode = 400; res.end("Choose connected channels, a session limit from 1 to 10, and availability"); return;
        }
        await this.deps.users.saveProfile({ ...profile, moderatorAvailable: available, moderatorChannels: channels, moderatorSessionLimit: sessionLimit });
        console.info("[admin] moderator settings updated", { available, channels, sessionLimit });
        await this.publishLiveUpdates();
        return this.json(res, { ok: true, available, channels, sessionLimit });
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
        const token = randomBytes(32).toString("base64url");
        await this.deps.users.saveProfile({
          userId: identity.userId,
          gender: "nonbinary",
          country: "Not provided",
          preferredGender: "any",
          operator: true,
          operatorAvailable: false,
          operatorSessionLimit: 1,
          operatorAccessHash: hashToken(token)
        });
        return this.json(res, { operatorUserId: identity.userId, displayName, token });
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

  private async authenticateLiveSocket(socket: WebSocket, request: IncomingMessage): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token") ?? undefined;
    const moderatorId = token ? await this.moderatorForToken(token) : undefined;
    const operatorId = token ? await this.operatorForToken(token) : undefined;
    const isAdmin = token === this.options.authToken || (!this.options.authToken && !token);
    if (!isAdmin && !moderatorId && !operatorId) {
      socket.close(1008, "Unauthorized");
      return;
    }

    const client: LiveSocket = moderatorId
      ? { socket, role: { type: "moderator", userId: moderatorId } }
      : operatorId
        ? { socket, role: { type: "operator", userId: operatorId } }
        : { socket, role: { type: "admin" } };

    this.liveSockets.add(client);
    socket.on("close", () => this.liveSockets.delete(client));
    socket.on("error", () => this.liveSockets.delete(client));
    this.sendSocket(socket, { type: "connected", role: client.role.type });
    if (client.role.type === "moderator") {
      this.sendSocket(socket, {
        type: "moderator-update",
        userId: client.role.userId,
        state: await this.buildModeratorState(client.role.userId)
      });
    } else if (client.role.type === "operator") {
      this.sendSocket(socket, {
        type: "operator-update",
        state: await this.buildOperatorState(client.role.userId)
      });
    } else {
      this.sendSocket(socket, await this.buildLiveUpdate());
    }
  }

  private async buildLiveUpdate(): Promise<AdminLiveUpdate> {
    const state = await this.buildSnapshot();
    const reports = await this.deps.reports.all();
    const reportedUsers = Array.from(new Map(
      reports.map((report) => [report.reportedId, {
        reportedUserId: report.reportedId,
        reports: 0,
        latestReportAt: report.createdAt
      }])
    ).values()).map((value) => ({
      reportedUserId: value.reportedUserId,
      reports: reports.filter((report) => report.reportedId === value.reportedUserId).length,
      latestReportAt: value.latestReportAt.toISOString()
    }));

    const moderationEvents = (await this.deps.moderationEvents?.all() ?? []).map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString()
    }));

    const watchLogs: Record<string, readonly MessageLogEntryDto[]> = {};
    for (const conversationId of state.watchedConversationIds) {
      watchLogs[conversationId] = this.deps.log.entriesFor(brandConversationId(conversationId)).map((entry) => ({
        ...entry,
        timestamp: entry.timestamp.toISOString()
      }));
    }

    return {
      type: "admin-update",
      state,
      reports: reports.map((report) => ({ ...report, createdAt: report.createdAt.toISOString() })),
      reportedUsers,
      moderationEvents,
      watchLogs
    };
  }

  private sendSocket(socket: WebSocket, payload: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }

  private async buildModeratorState(moderatorId: UserId): Promise<ModeratorLiveState> {
    const profile = await this.deps.users.profileFor(moderatorId);
    const identities = await this.deps.users.allIdentities();
    const connectedChannels = Array.from(new Set(identities
      .filter((identity) => identity.userId === moderatorId)
      .map((identity) => identity.channel)));
    const sessions = await this.buildStaffSessions(moderatorId);
    const participant = sessions[0]?.participant;

    return {
      available: Boolean(profile?.moderatorAvailable),
      sessionLimit: profile?.moderatorSessionLimit ?? 1,
      channels: profile?.moderatorChannels ?? [],
      connectedChannels,
      activeConversationId: sessions[0]?.conversationId ?? null,
      sessions,
      participant
    };
  }

  private async buildOperatorState(operatorId: UserId): Promise<OperatorLiveState> {
    const profile = await this.deps.users.profileFor(operatorId);
    return {
      userId: operatorId,
      available: Boolean(profile?.operatorAvailable),
      sessionLimit: profile?.operatorSessionLimit ?? 1,
      sessions: await this.buildStaffSessions(operatorId)
    };
  }

  private async buildStaffSessions(staffId: UserId): Promise<ModeratorLiveState["sessions"]> {
    const conversations = await this.deps.conversations.all();
    const sessions: ModeratorLiveState["sessions"][number][] = [];
    for (const conversation of conversations) {
      if (conversation.status !== "active" || conversation.kind !== "operator" ||
        !conversation.participants.some((participant) => participant.userId === staffId)) continue;
      this.deps.log.watch(conversation.id);
      const participant = conversation.participants.find((entry) => entry.userId !== staffId);
      if (!participant) continue;
      const [profile, identity] = await Promise.all([
        this.deps.users.profileFor(participant.userId),
        this.deps.users.identityFor(participant.userId)
      ]);
      if (!profile || !identity) continue;
      sessions.push({
        conversationId: conversation.id,
        participant: {
          userId: participant.userId,
          channel: identity.channel,
          displayName: profile.displayName,
          age: profile.age,
          gender: profile.gender,
          country: profile.country,
          preferredGender: profile.preferredGender,
          preferredCountry: profile.preferredCountry
        },
        messages: this.deps.log.entriesFor(conversation.id).map((entry) => ({
          ...entry,
          timestamp: entry.timestamp.toISOString()
        }))
      });
    }
    return sessions;
  }

  private async isAssignedModerator(moderatorId: UserId, targetId: UserId): Promise<boolean> {
    const conversations = await this.deps.conversations.all();
    return conversations.some((conversation) => conversation.status === "active"
      && conversation.kind === "operator"
      && conversation.participants.some((participant) => participant.userId === moderatorId)
      && conversation.participants.some((participant) => participant.userId === targetId));
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

  private async operatorForToken(token: string): Promise<UserId | undefined> {
    if (!token) return undefined;
    const candidate = Buffer.from(hashToken(token), "hex");
    const identities = await this.deps.users.allIdentities();
    for (const id of new Set(identities.map((identity) => identity.userId))) {
      const profile = await this.deps.users.profileFor(id);
      if (!profile?.operator || !profile.operatorAccessHash) continue;
      const expected = Buffer.from(profile.operatorAccessHash, "hex");
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
