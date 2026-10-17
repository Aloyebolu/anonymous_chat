import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AI_CHANNEL, conversationId as brandConversationId, userId as brandUserId } from "../../domain/types.js";
import type { MatchmakingConfig } from "../../application/matchmaking.js";
import type { MatchmakingService } from "../../application/matchmaking.js";
import type { ConversationRepository, MatchQueueRepository, UserRepository } from "../../ports/repositories.js";
import type { MessageLogRepository, ReportRepository } from "../../ports/reports.js";
import type { ModerationEventRepository } from "../../ports/moderation-events.js";
import { applyCors, handlePreflight } from "../http/cors.js";

export interface AdminServerOptions {
  readonly port: number;
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
  private server?: Server;
  private boundPort?: number;

  constructor(private readonly deps: AdminDeps, private readonly options: AdminServerOptions) {}

  get port(): number | undefined { return this.boundPort; }

  async start(): Promise<void> {
    if (process.env.NODE_ENV === "production" && !this.options.authToken) {
      throw new Error("ADMIN_TOKEN is required to run the admin API in production.");
    }
    if (!this.options.authToken) console.warn("[admin] ADMIN_TOKEN is unset; admin API is open to local requests.");
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(this.options.port, resolve));
    const address = this.server!.address();
    this.boundPort = typeof address === "object" && address ? address.port : this.options.port;
    console.log(`Admin API listening on http://localhost:${this.boundPort}/`);
  }

  async stop(): Promise<void> {
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "OPTIONS") return handlePreflight(res);
    applyCors(res);
    const url = new URL(req.url ?? "/", `http://localhost:${this.boundPort}`);

    if (url.pathname.startsWith("/api/") && this.options.authToken) {
      const authorization = req.headers.authorization ?? "";
      if (authorization !== `Bearer ${this.options.authToken}`) {
        res.statusCode = 401;
        res.setHeader("www-authenticate", "Bearer");
        res.end("Unauthorized");
        return;
      }
    }

    try {
      if (req.method === "GET" && url.pathname === "/api/state") return this.json(res, await this.buildSnapshot());
      if (req.method === "GET" && url.pathname === "/api/reports") return this.json(res, { reports: await this.deps.reports.all() });
      if (req.method === "GET" && url.pathname === "/api/moderation-events") {
        return this.json(res, { events: await this.deps.moderationEvents?.all() ?? [] });
      }

      if (req.method === "POST" && url.pathname === "/api/user/shadow-ban") {
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

      if (req.method === "GET" && url.pathname === "/api/reported-users") {
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
        return this.json(res, { users: [...grouped.values()].sort((a, b) => b.reports - a.reports) });
      }

      if (req.method === "POST" && url.pathname === "/api/operator/login") {
        const body = await readJson(req);
        const displayName = typeof body?.displayName === "string" ? body.displayName.trim().slice(0, 32) : "";
        if (!displayName) { res.statusCode = 400; res.end("displayName required"); return; }
        const identity = await this.deps.users.findOrCreate({
          channel: "operator",
          externalId: `${displayName}:${crypto.randomUUID()}`
        });
        return this.json(res, { operatorUserId: identity.userId, displayName });
      }

      if (req.method === "POST" && url.pathname === "/api/watch") {
        const body = await readJson(req);
        const id = typeof body?.conversationId === "string" ? body.conversationId : undefined;
        if (!id) { res.statusCode = 400; res.end("conversationId required"); return; }
        this.deps.log.watch(brandConversationId(id));
        return this.json(res, { ok: true });
      }
      if (req.method === "DELETE" && url.pathname === "/api/watch") {
        const id = url.searchParams.get("conversationId");
        if (!id) { res.statusCode = 400; res.end("conversationId required"); return; }
        this.deps.log.unwatch(brandConversationId(id));
        return this.json(res, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/watch") {
        const id = url.searchParams.get("conversationId");
        if (!id) { res.statusCode = 400; res.end("conversationId required"); return; }
        return this.json(res, { entries: this.deps.log.entriesFor(brandConversationId(id)) });
      }

      if (req.method === "POST" && url.pathname === "/api/operator/match") {
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

  private async buildSnapshot() {
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
        profile: profile ?? null,
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
        createdAt: conversation.createdAt,
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
}

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown> | undefined> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; }
  catch { return undefined; }
};
