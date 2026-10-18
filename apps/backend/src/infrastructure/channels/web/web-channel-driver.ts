import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import { userId } from "../../../domain/types.js";
import type { ChannelCapabilities, ChannelDriver, ChannelRecipient, InboundEvent, OutboundMessage } from "../../../ports/channels.js";
import { applyCors, handlePreflight } from "../../http/cors.js";
import { API_PATHS } from "@anonymous-chat/shared/api";
import type { MediaPayload } from "@anonymous-chat/shared/channel-contracts";

const COMMANDS = new Set(["start", "find", "next", "leave", "report", "block", "help", "points", "vip", "end", "app", "settings"]);
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 7 * 1024 * 1024;

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
    text: true, buttons: true, menus: false, menuLayouts: [], messageEditing: false, messageDeletion: true,
    typingIndicator: false, media: ["image", "video", "audio", "voice", "document", "sticker"], payments: [], deepLinks: false
  };

  private server?: Server;
  private boundPort?: number;
  private receiver?: (event: InboundEvent) => Promise<void>;
  private fallbackHandler?: RequestListener;
  private readonly clients = new Map<string, Set<Client>>();

  constructor(private readonly options: WebChannelOptions) {}

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
    const messageId = crypto.randomUUID();
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
    const clients = this.clients.get(recipient.externalId);
    if (!clients) return;
    const payload = JSON.stringify({ kind: "delete", messageId: externalMessageId });
    for (const client of clients) client.res.write(`data: ${payload}\n\n`);
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
    if (req.method === "GET" && url.pathname === API_PATHS.stream) return this.serveStream(url, res);
    if (req.method === "POST" && url.pathname === API_PATHS.send) return this.acceptSend(req, res);
    if (this.fallbackHandler) {
      this.fallbackHandler(req, res);
      return;
    }
    res.statusCode = 404;
    res.end("Not found");
  }

  private serveStream(url: URL, res: ServerResponse): void {
    const user = url.searchParams.get("user");
    if (!user) { res.statusCode = 400; res.end("Missing user"); return; }
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
    const media = parseMedia(body?.media);
    if (body?.media !== undefined && !media) { res.statusCode = 400; res.end("Invalid media payload"); return; }
    if (!user || (!text && !actionId && !media)) { res.statusCode = 400; res.end("Missing user or text/actionId/media"); return; }
    const timestamp = new Date();
    const identity = { userId: userId(""), channel: this.type, externalId: user };
    const event: InboundEvent = actionId
      ? { kind: "action", channel: this.type, identity, actionId, timestamp }
      : media
        ? {
            kind: "message",
            channel: this.type,
            identity,
            externalMessageId: `web-${crypto.randomUUID()}`,
            content: { kind: "media", media },
            timestamp
          }
        : this.textEvent(identity, text!, timestamp);
    try {
      await this.receiver?.(event);
      res.statusCode = 204;
      res.end();
    } catch (error) {
      console.error("[web] Failed to handle inbound message.", error);
      res.statusCode = 500;
      res.end("Failed");
    }
  }

  private textEvent(identity: InboundEvent["identity"], text: string, timestamp: Date): InboundEvent {
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
      externalMessageId: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: { kind: "text", text },
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
