import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { userId, type UserId, type UserProfile } from "../../../domain/types.js";
import type { ChannelCapabilities, ChannelDriver, ChannelRecipient, InboundEvent, OutboundMessage } from "../../../ports/channels.js";
import type { UserRepository } from "../../../ports/repositories.js";
import { applyCors, handlePreflight } from "../../http/cors.js";
import { API_PATHS } from "@anonymous-chat/shared/api";
import type { MediaPayload } from "@anonymous-chat/shared/channel-contracts";

const COMMANDS = new Set(["start", "find", "next", "leave", "report", "block", "help", "points", "vip", "end", "app", "settings"]);
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 7 * 1024 * 1024;
const WEB_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const WEB_SESSION_LIMIT = 10;

export interface WebChannelOptions {
  readonly port: number;
  readonly host?: string;
}

interface Client {
  readonly res: ServerResponse;
}

export class WebChannelDriver implements ChannelDriver {
  readonly type = "web";
  readonly capabilities: ChannelCapabilities = {
    text: true, buttons: true, menus: false, menuLayouts: [], messageEditing: true, messageDeletion: true, messageReactions: true, messageReplies: true,
    typingIndicator: false, media: ["image", "video", "audio", "voice", "document", "sticker"], payments: [], deepLinks: false
  };

  private server?: Server;
  private boundPort?: number;
  private receiver?: (event: InboundEvent) => Promise<void>;
  private fallbackHandler?: RequestListener;
  private readonly clients = new Map<string, Set<Client>>();
  private messageActions?: {
    edit: (user: string, messageId: string, text: string) => Promise<void>;
    react: (user: string, messageId: string, emoji: string) => Promise<void>;
  };

  constructor(private readonly options: WebChannelOptions, private readonly users?: UserRepository) {}

  get port(): number | undefined { return this.boundPort; }
  get httpServer(): Server {
    if (!this.server) throw new Error("Web channel server has not started.");
    return this.server;
  }

  async start(receiver: (event: InboundEvent) => Promise<void>, fallbackHandler?: RequestListener): Promise<void> {
    this.receiver = receiver;
    this.fallbackHandler = fallbackHandler;
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(this.options.port, this.options.host, resolve));
    const address = this.server!.address();
    this.boundPort = typeof address === "object" && address ? address.port : this.options.port;
    console.log(`Web channel API listening on http://localhost:${this.boundPort}/`);
  }

  setMessageActions(actions: NonNullable<WebChannelDriver["messageActions"]>): void {
    this.messageActions = actions;
  }

  async stop(): Promise<void> {
    for (const clients of this.clients.values()) for (const client of clients) client.res.end();
    this.clients.clear();
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
    this.fallbackHandler = undefined;
  }

  async sendMessage(recipient: ChannelRecipient, message: OutboundMessage): Promise<string | undefined> {
    const clients = this.clients.get(recipient.externalId);
    if (!clients) return undefined;
    const messageId = ("sourceMessageId" in message ? message.sourceMessageId : undefined) ?? crypto.randomUUID();
    const payload = message.kind === "media" && message.media.bytes
      ? {
          ...message,
          messageId,
          media: {
            ...message.media,
            bytes: undefined,
            url: `data:${safeMimeType(message.media.mimeType)};base64,${Buffer.from(message.media.bytes).toString("base64")}`
          }
        }
      : { ...message, messageId };
    const serialized = JSON.stringify(payload);
    for (const client of clients) client.res.write(`data: ${serialized}\n\n`);
    return messageId;
  }

  async deleteMessage(recipient: ChannelRecipient, externalMessageId: string): Promise<void> {
    if (!this.publish(recipient.externalId, { kind: "delete", messageId: externalMessageId })) {
      throw new Error("Web recipient is not connected.");
    }
  }

  async editMessage(recipient: ChannelRecipient, externalMessageId: string, message: OutboundMessage): Promise<void> {
    if (message.kind !== "text") throw new Error("Web messages can only edit text.");
    if (!this.publish(recipient.externalId, {
      kind: "edit",
      messageId: externalMessageId,
      text: message.text,
      format: message.format
    })) throw new Error("Web recipient is not connected.");
  }

  async reactMessage(recipient: ChannelRecipient, externalMessageId: string, emoji: string): Promise<void> {
    if (!this.publish(recipient.externalId, { kind: "reaction", messageId: externalMessageId, emoji })) {
      throw new Error("Web recipient is not connected.");
    }
  }

  async notifyReaction(recipient: ChannelRecipient, externalMessageId: string, emoji: string, userId?: string): Promise<void> {
    if (!this.publish(recipient.externalId, { kind: "reaction", messageId: externalMessageId, emoji, userId })) {
      throw new Error("Web recipient is not connected.");
    }
  }

  private publish(user: string, payload: unknown): boolean {
    const clients = this.clients.get(user);
    if (!clients) return false;
    const serialized = JSON.stringify(payload);
    for (const client of clients) client.res.write(`data: ${serialized}\n\n`);
    return true;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "OPTIONS") return handlePreflight(res);
    applyCors(res);
    const url = new URL(req.url ?? "/", `http://localhost:${this.options.port}`);
    if (req.method === "GET" && url.pathname === "/health") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, clients: this.clients.size }));
      return;
    }
    if (this.users && req.method === "POST" && url.pathname === API_PATHS.web.register) return this.register(req, res);
    if (this.users && req.method === "POST" && url.pathname === API_PATHS.web.login) return this.login(req, res);
    if (req.method === "POST" && url.pathname === API_PATHS.web.editMessage) return this.editWebMessage(req, res);
    if (req.method === "POST" && url.pathname === API_PATHS.web.reactMessage) return this.reactWebMessage(req, res);
    if (req.method === "GET" && url.pathname === API_PATHS.stream) return this.serveStream(req, url, res);
    if (req.method === "POST" && url.pathname === API_PATHS.send) return this.acceptSend(req, res);
    if (this.fallbackHandler) {
      this.fallbackHandler(req, res);
      return;
    }
    res.statusCode = 404;
    res.end("Not found");
  }

  private async editWebMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readAuthBody(req, res);
    if (!body) return;
    const user = await this.authenticatedRequestUser(req, body, res);
    if (!user) return;
    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    const text = typeof body.text === "string" ? body.text : "";
    if (!messageId || !text.trim() || text.length > 4000) {
      this.json(res, 400, { error: "A message ID and text (up to 4000 characters) are required." });
      return;
    }
    if (!this.messageActions) {
      this.json(res, 503, { error: "Message editing is unavailable." });
      return;
    }
    try {
      await this.messageActions.edit(user, messageId, text);
      this.json(res, 200, { ok: true });
    } catch (error) {
      console.warn("[web] Message edit rejected.", error);
      this.json(res, 400, { error: error instanceof Error ? error.message : "Could not edit the message." });
    }
  }

  private async reactWebMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readAuthBody(req, res);
    if (!body) return;
    const user = await this.authenticatedRequestUser(req, body, res);
    if (!user) return;
    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    const emoji = typeof body.emoji === "string" ? body.emoji : "";
    if (!messageId || !/^(?:👍|❤️|😂|😮|😢|🙏)$/.test(emoji)) {
      this.json(res, 400, { error: "Choose a message and a supported reaction." });
      return;
    }
    if (!this.messageActions) {
      this.json(res, 503, { error: "Message reactions are unavailable." });
      return;
    }
    try {
      await this.messageActions.react(user, messageId, emoji);
      this.json(res, 200, { ok: true });
    } catch (error) {
      console.warn("[web] Message reaction rejected.", error);
      this.json(res, 400, { error: error instanceof Error ? error.message : "Could not react to the message." });
    }
  }

  private async authenticatedRequestUser(
    req: IncomingMessage,
    body: Record<string, unknown>,
    res: ServerResponse
  ): Promise<string | undefined> {
    const user = typeof body.user === "string" ? body.user.trim() : "";
    if (!user) {
      this.json(res, 400, { error: "User is required." });
      return undefined;
    }
    if (this.users) {
      const authenticatedUser = await this.authenticate(this.bearer(req));
      if (!authenticatedUser || authenticatedUser !== user) {
        this.json(res, 401, { error: "Unauthorized." });
        return undefined;
      }
    }
    return user;
  }

  private async serveStream(req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
    const user = url.searchParams.get("user");
    if (!user) { res.statusCode = 400; res.end("Missing user"); return; }
    if (this.users) {
      const authenticatedUser = await this.authenticate(this.bearer(req) ?? url.searchParams.get("token") ?? undefined);
      if (!authenticatedUser || authenticatedUser !== user) { res.statusCode = 401; res.end("Unauthorized"); return; }
    }
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.write(": connected\n\n");
    const clients = this.clients.get(user) ?? new Set<Client>();
    const client: Client = { res };
    clients.add(client);
    this.clients.set(user, clients);
    res.on("close", () => {
      clients.delete(client);
      if (clients.size === 0) this.clients.delete(user);
    });
  }

  private async acceptSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: Record<string, unknown> | undefined;
    try {
      body = await readJson(req, MAX_REQUEST_BYTES);
    } catch (error) {
      console.warn("[web] Rejected oversized request body.", error);
      res.statusCode = 413;
      res.end("Request body too large");
      return;
    }
    const user = typeof body?.user === "string" ? body.user.trim() : undefined;
    const text = typeof body?.text === "string" ? body.text : undefined;
    const actionId = typeof body?.actionId === "string" ? body.actionId : undefined;
    const replyToMessageId = typeof body?.replyToMessageId === "string" ? body.replyToMessageId : undefined;
    const requestedMessageId = typeof body?.externalMessageId === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(body.externalMessageId)
      ? body.externalMessageId
      : undefined;
    const media = parseMedia(body?.media);
    if (body?.media !== undefined && !media) { res.statusCode = 400; res.end("Invalid media payload"); return; }
    if (!user || (!text && !actionId && !media)) { res.statusCode = 400; res.end("Missing user or text/actionId/media"); return; }
    if (this.users) {
      const authenticatedUser = await this.authenticate(this.bearer(req));
      if (!authenticatedUser || authenticatedUser !== user) { res.statusCode = 401; res.end("Unauthorized"); return; }
    }
    const timestamp = new Date();
    const identity = { userId: userId(""), channel: this.type, externalId: user };
    const event: InboundEvent = actionId
      ? { kind: "action", channel: this.type, identity, actionId, timestamp }
      : media
        ? {
            kind: "message",
            channel: this.type,
            identity,
            externalMessageId: requestedMessageId ?? `web-${crypto.randomUUID()}`,
            content: { kind: "media", media, replyToMessageId },
            timestamp
          }
        : this.textEvent(identity, text!, timestamp, replyToMessageId, requestedMessageId);
    try {
      await this.receiver?.(event);
      res.statusCode = 202;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ messageId: event.kind === "message" ? event.externalMessageId : undefined }));
    } catch (error) {
      console.error("[web] Failed to handle inbound message.", error);
      res.statusCode = 500;
      res.end("Failed");
    }
  }

  private async register(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readAuthBody(req, res);
    if (!body) return;
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[a-z0-9_]{3,20}$/.test(username) || password.length < 5 || password.length > 128) {
      this.json(res, 400, { error: "Use a 3–20 character username and a password of at least 5 characters." });
      return;
    }
    const identity = await this.users!.findOrCreate({ channel: this.type, externalId: username });
    const existing = await this.users!.profileFor(identity.userId);
    if (existing?.webPasswordHash || existing?.moderator || existing?.operator) {
      this.json(res, 409, { error: "That username is already registered." });
      return;
    }
    const salt = randomBytes(16).toString("hex");
    const profile: UserProfile = {
      ...(existing ?? {
        userId: identity.userId,
        gender: "nonbinary",
        country: "Not provided",
        preferredGender: "any"
      }),
      displayName: username,
      webPasswordSalt: salt,
      webPasswordHash: scryptSync(password, salt, 64).toString("hex")
    };
    await this.users!.saveProfile(profile);
    const token = await this.issueSession(identity.userId, profile);
    this.json(res, 201, { username, token });
  }

  private async login(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readAuthBody(req, res);
    if (!body) return;
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const identity = await this.users!.identityForChannelExternalId(this.type, username);
    const profile = identity ? await this.users!.profileFor(identity.userId) : undefined;
    const suppliedHash = profile?.webPasswordSalt && profile.webPasswordHash
      ? scryptSync(password, profile.webPasswordSalt, 64)
      : scryptSync(password || "invalid-password", "invalid-web-login-salt", 64);
    const expectedHash = profile?.webPasswordHash ? Buffer.from(profile.webPasswordHash, "hex") : Buffer.alloc(64);
    const valid = Boolean(identity && profile?.webPasswordSalt && profile.webPasswordHash &&
      expectedHash.length === suppliedHash.length && timingSafeEqual(expectedHash, suppliedHash));
    if (!valid || !identity || !profile) {
      this.json(res, 401, { error: "Invalid username or password." });
      return;
    }
    const token = await this.issueSession(identity.userId, profile);
    this.json(res, 200, { username, token });
  }

  private async issueSession(userIdValue: UserId, profile: UserProfile): Promise<string> {
    const identity = await this.users!.identityFor(userIdValue, this.type);
    if (!identity) throw new Error("Web account identity is missing.");
    const token = `${identity.externalId}.${randomBytes(32).toString("base64url")}`;
    const now = Date.now();
    const sessions = (profile.webSessions ?? []).filter((session) => Date.parse(session.expiresAt) > now);
    sessions.push({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(now + WEB_SESSION_MS).toISOString()
    });
    await this.users!.saveProfile({ ...profile, userId: userIdValue, webSessions: sessions.slice(-WEB_SESSION_LIMIT) });
    return token;
  }

  private async authenticate(token: string | undefined): Promise<string | undefined> {
    if (!token || !this.users) return undefined;
    const separator = token.indexOf(".");
    if (separator < 1) return undefined;
    const username = token.slice(0, separator);
    const identity = await this.users.identityForChannelExternalId(this.type, username);
    if (!identity) return undefined;
    const candidate = Buffer.from(createHash("sha256").update(token).digest("hex"), "hex");
    const now = Date.now();
    const profile = await this.users.profileFor(identity.userId);
    for (const session of profile?.webSessions ?? []) {
      if (Date.parse(session.expiresAt) <= now) continue;
      const expected = Buffer.from(session.tokenHash, "hex");
      if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) return identity.externalId;
    }
    return undefined;
  }

  private bearer(req: IncomingMessage): string | undefined {
    const match = req.headers.authorization?.match(/^Bearer\s+(.+)$/i);
    return match?.[1];
  }

  private async readAuthBody(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | undefined> {
    try {
      const body = await readJson(req);
      if (!body) this.json(res, 400, { error: "A JSON request body is required." });
      return body;
    } catch (error) {
      console.warn("[web] Rejected oversized authentication request.", error);
      this.json(res, 413, { error: "Request body too large." });
      return undefined;
    }
  }

  private json(res: ServerResponse, status: number, value: unknown): void {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(value));
  }

  private textEvent(
    identity: InboundEvent["identity"],
    text: string,
    timestamp: Date,
    replyToMessageId?: string,
    externalMessageId?: string
  ): InboundEvent {
    const trimmed = text.trim().toLowerCase();
    if (trimmed.startsWith("/") && COMMANDS.has(trimmed.slice(1))) {
      return {
        kind: "command", channel: this.type, identity,
        command: trimmed.slice(1) as "start" | "find" | "next" | "leave" | "report" | "block" | "help" | "points" | "vip" | "end" | "app" | "settings",
        timestamp
      };
    }
    return {
      kind: "message", channel: this.type, identity,
      externalMessageId: externalMessageId ?? `web-${crypto.randomUUID()}`,
      content: { kind: "text", text, replyToMessageId },
      timestamp
    };
  }
}

const readJson = async (req: IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, unknown> | undefined> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) throw new Error("Request body exceeds the size limit.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; }
  catch { return undefined; }
};

const safeMimeType = (mimeType?: string): string =>
  mimeType && /^[\w.+-]+\/[\w.+-]+$/.test(mimeType) ? mimeType : "application/octet-stream";

const parseMedia = (value: unknown): MediaPayload | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const media = value as Record<string, unknown>;
  const kind = media.kind;
  const base64 = media.base64;
  if (
    !["image", "video", "audio", "voice", "document", "sticker"].includes(String(kind)) ||
    typeof base64 !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) return undefined;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_MEDIA_BYTES) return undefined;
  return {
    kind: kind as MediaPayload["kind"],
    bytes,
    mimeType: typeof media.mimeType === "string" ? safeMimeType(media.mimeType) : undefined,
    filename: typeof media.filename === "string" ? media.filename.slice(0, 200) : undefined,
    sizeBytes: bytes.length
  };
};
