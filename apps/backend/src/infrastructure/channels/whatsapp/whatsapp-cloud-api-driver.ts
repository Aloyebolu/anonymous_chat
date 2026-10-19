import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { userId, type CommunicationIdentity } from "../../../domain/types.js";
import type {
  ChannelCapabilities,
  ChannelDriver,
  ChannelRecipient,
  Command,
  InboundEvent,
  MediaPayload,
  OutboundMessage
} from "../../../ports/channels.js";
import { htmlToPlainText } from "../html-text.js";
import { API_PATHS } from "@anonymous-chat/shared/api";
import type { UserRepository } from "../../../ports/repositories.js";

const GRAPH_ORIGIN = "https://graph.facebook.com";
const WEBHOOK_MAX_BYTES = 5 * 1024 * 1024;
const MEDIA_MAX_BYTES = 16 * 1024 * 1024;
const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

type CloudApiOptions = {
  readonly accessToken: string;
  readonly appSecret: string;
  readonly verifyToken: string;
  readonly phoneNumberId: string;
  readonly apiVersion: string;
};

type CloudWebhookMessage = {
  readonly id?: string;
  readonly from?: string;
  readonly timestamp?: string;
  readonly type?: string;
  readonly text?: { readonly body?: string };
  readonly interactive?: {
    readonly button_reply?: { readonly id?: string };
    readonly list_reply?: { readonly id?: string };
  };
  readonly reaction?: { readonly message_id?: string; readonly emoji?: string };
  readonly image?: CloudMediaRef;
  readonly video?: CloudMediaRef;
  readonly audio?: CloudMediaRef;
  readonly document?: CloudMediaRef;
  readonly sticker?: CloudMediaRef;
};

type CloudMediaRef = {
  readonly id?: string;
  readonly mime_type?: string;
  readonly filename?: string;
  readonly caption?: string;
  readonly file_size?: number;
};

type CloudWebhookBody = {
  readonly entry?: readonly {
    readonly changes?: readonly {
      readonly value?: { readonly messages?: readonly CloudWebhookMessage[] };
    }[];
  }[];
};

type GraphMessageResponse = { readonly messages?: readonly { readonly id?: string }[] };

export class WhatsAppCloudApiDriver implements ChannelDriver {
  readonly type = "whatsapp";
  readonly capabilities: ChannelCapabilities = {
    text: true,
    buttons: true,
    menus: false,
    menuLayouts: [],
    messageEditing: false,
    messageDeletion: false,
    messageReactions: true,
    messageReplies: true,
    typingIndicator: false,
    media: ["image", "video", "audio", "voice", "document", "sticker"],
    payments: [],
    deepLinks: false
  };

  private receiver?: (event: InboundEvent) => Promise<void>;
  private readonly lastInboundAt = new Map<string, number>();
  private readonly seenMessageIds = new Set<string>();
  private readonly inFlightMessages = new Map<string, Promise<void>>();
  private readonly pendingActions = new Map<string, readonly { id: string; label: string }[]>();
  private readonly graphBase: string;

  constructor(
    private readonly options: CloudApiOptions,
    private readonly fetcher: typeof fetch = fetch,
    private readonly users?: UserRepository
  ) {
    if (!options.accessToken || !options.appSecret || !options.verifyToken || !options.phoneNumberId) {
      throw new Error("WhatsApp Cloud API requires an access token, app secret, verify token, and phone number ID.");
    }
    if (!/^\d+$/.test(options.phoneNumberId)) {
      throw new Error("WHATSAPP_CLOUD_PHONE_NUMBER_ID must be a numeric Meta phone number ID.");
    }
    if (!/^v\d+\.\d+$/.test(options.apiVersion)) {
      throw new Error("WHATSAPP_CLOUD_API_VERSION must use a Graph API version such as vXX.0.");
    }
    this.graphBase = `${GRAPH_ORIGIN}/${options.apiVersion}`;
  }

  async start(receiver: (event: InboundEvent) => Promise<void>): Promise<void> {
    this.receiver = receiver;
  }

  async stop(): Promise<void> {
    this.receiver = undefined;
    this.lastInboundAt.clear();
    this.seenMessageIds.clear();
    this.inFlightMessages.clear();
    this.pendingActions.clear();
  }

  async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== API_PATHS.whatsappWebhook) return false;

    if (req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode !== "subscribe" || !challenge || !this.secureEqual(token ?? "", this.options.verifyToken)) {
        res.statusCode = 403;
        res.end("Webhook verification failed.");
        return true;
      }
      res.statusCode = 200;
      res.end(challenge);
      return true;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("allow", "GET, POST");
      res.end("Method not allowed.");
      return true;
    }

    let raw: Buffer;
    try {
      raw = await readRawBody(req, WEBHOOK_MAX_BYTES);
    } catch (error) {
      console.warn("[whatsapp-cloud] Rejected oversized webhook.", error);
      res.statusCode = 413;
      res.end("Webhook payload too large.");
      return true;
    }

    if (!this.verifySignature(raw, req.headers["x-hub-signature-256"])) {
      res.statusCode = 401;
      res.end("Invalid webhook signature.");
      return true;
    }

    let body: CloudWebhookBody;
    try {
      body = JSON.parse(raw.toString("utf8")) as CloudWebhookBody;
    } catch (error) {
      console.warn("[whatsapp-cloud] Rejected malformed webhook JSON.", error);
      res.statusCode = 400;
      res.end("Invalid webhook JSON.");
      return true;
    }

    try {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          for (const message of change.value?.messages ?? []) {
            await this.processWebhookMessage(message);
          }
        }
      }
      res.statusCode = 200;
      res.end("EVENT_RECEIVED");
    } catch (error) {
      console.error("[whatsapp-cloud] Failed to handle a verified webhook.", error);
      res.statusCode = 500;
      res.end("Webhook processing failed.");
    }
    return true;
  }

  async sendMessage(recipient: ChannelRecipient, message: OutboundMessage): Promise<string | undefined> {
    if (!/^\d+$/.test(recipient.externalId)) {
      throw new Error("[whatsapp-cloud] Recipient must be a WhatsApp phone number in international digits-only format.");
    }
    await this.assertCustomerServiceWindow(recipient.externalId);
    if (message.kind === "text") {
      return this.sendGraphMessage(recipient.externalId, {
        type: "text",
        text: { preview_url: false, body: message.format === "html" ? htmlToPlainText(message.text) : message.text },
        ...(message.replyToMessageId ? { context: { message_id: message.replyToMessageId } } : {})
      });
    }
    if (message.kind === "interaction") return this.sendInteraction(recipient.externalId, message);
    if (message.kind === "media") return this.sendMedia(recipient.externalId, message);
    throw new Error("[whatsapp-cloud] Invoices are not supported by the Cloud API adapter.");
  }

  async reactMessage(recipient: ChannelRecipient, externalMessageId: string, emoji: string): Promise<void> {
    if (!/^(?:👍|❤️|😂|😮|😢|🙏)$/.test(emoji)) throw new Error("Unsupported reaction emoji.");
    await this.assertCustomerServiceWindow(recipient.externalId);
    await this.sendGraphMessage(recipient.externalId, {
      type: "reaction",
      reaction: { message_id: externalMessageId, emoji }
    });
  }

  async resolveMedia(media: MediaPayload): Promise<MediaPayload> {
    if (media.bytes || media.url || !media.channelRef) return media;
    const metadata = await this.graphRequest<{ url?: string; mime_type?: string; file_size?: number }>(
      `/${encodeURIComponent(media.channelRef)}`
    );
    if (!metadata.url) throw new Error("[whatsapp-cloud] Media metadata response did not include a download URL.");
    if (metadata.file_size !== undefined && metadata.file_size > MEDIA_MAX_BYTES) {
      throw new Error("[whatsapp-cloud] Media exceeds the download size limit.");
    }
    const mediaUrl = new URL(metadata.url);
    if (mediaUrl.protocol !== "https:" ||
      !(mediaUrl.hostname === "lookaside.fbsbx.com" || mediaUrl.hostname.endsWith(".fbcdn.net"))) {
      throw new Error("[whatsapp-cloud] Refusing to download media from an untrusted host.");
    }
    const response = await this.fetcher(mediaUrl, {
      headers: { authorization: `Bearer ${this.options.accessToken}` }
    });
    if (!response.ok) throw new Error(`[whatsapp-cloud] Media download failed: HTTP ${response.status}.`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MEDIA_MAX_BYTES) throw new Error("[whatsapp-cloud] Media exceeds the download size limit.");
    const bytes = await readResponseBytes(response, MEDIA_MAX_BYTES);
    return {
      ...media,
      channelRef: undefined,
      url: undefined,
      bytes,
      mimeType: metadata.mime_type ?? media.mimeType,
      sizeBytes: metadata.file_size ?? bytes.byteLength
    };
  }

  private async sendInteraction(
    recipient: string,
    message: Extract<OutboundMessage, { kind: "interaction" }>
  ): Promise<string | undefined> {
    const text = message.format === "html" ? htmlToPlainText(message.text) : message.text;
    if (message.actions.length > 0 && message.actions.length <= 3) {
      return this.sendGraphMessage(recipient, {
        type: "interactive",
        ...(message.replyToMessageId ? { context: { message_id: message.replyToMessageId } } : {}),
        interactive: {
          type: "button",
          body: { text },
          action: {
            buttons: message.actions.map((action) => ({
              type: "reply",
              reply: { id: action.id, title: action.label.slice(0, 20) }
            }))
          }
        }
      });
    }

    this.pendingActions.set(recipient, message.actions);
    const options = message.actions.map((action, index) => `${index + 1}. ${action.label}`).join("\n");
    return this.sendGraphMessage(recipient, {
      type: "text",
      text: { preview_url: false, body: `${text}\n\nReply with:\n${options}` },
      ...(message.replyToMessageId ? { context: { message_id: message.replyToMessageId } } : {})
    });
  }

  private async sendMedia(
    recipient: string,
    message: Extract<OutboundMessage, { kind: "media" }>
  ): Promise<string | undefined> {
    const media = message.media;
    if (!this.capabilities.media.includes(media.kind)) {
      throw new Error(`[whatsapp-cloud] Unsupported media kind: ${media.kind}.`);
    }
    if (media.kind === "sticker" &&
      (media.mimeType !== "image/webp" || (media.bytes !== undefined && !isWebp(media.bytes)))) {
      throw new Error("[whatsapp-cloud] Stickers must contain valid WebP image data.");
    }
    if (media.bytes && media.bytes.byteLength > MEDIA_MAX_BYTES) {
      throw new Error("[whatsapp-cloud] Media exceeds the upload size limit.");
    }
    const mimeType = media.mimeType ?? "application/octet-stream";
    const mediaId = media.bytes ? await this.uploadMedia(media.bytes, mimeType) : undefined;
    const link = media.url ? new URL(media.url) : undefined;
    if (link && link.protocol !== "https:") {
      throw new Error("[whatsapp-cloud] Media links must use HTTPS.");
    }
    const source = mediaId ? { id: mediaId } : link ? { link: link.href } : undefined;
    if (!source) throw new Error(`[whatsapp-cloud] Media ${media.kind} has no bytes or URL.`);

    const body: Record<string, unknown> = { ...source };
    if (media.kind === "document") body.filename = media.filename ?? "file";
    if (message.caption && ["image", "video", "document"].includes(media.kind)) body.caption = message.caption;
    return this.sendGraphMessage(recipient, {
      type: media.kind === "voice" ? "audio" : media.kind,
      [media.kind === "voice" ? "audio" : media.kind]: body,
      ...(message.replyToMessageId ? { context: { message_id: message.replyToMessageId } } : {})
    });
  }

  private async uploadMedia(bytes: Uint8Array, mimeType: string): Promise<string> {
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", mimeType);
    form.set("file", new Blob([Buffer.from(bytes)], { type: mimeType }), "upload");
    const response = await this.fetcher(`${this.graphBase}/${this.options.phoneNumberId}/media`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.accessToken}` },
      body: form
    });
    const payload = await this.readGraphResponse<{ id?: string }>(response);
    if (!payload.id) throw new Error("[whatsapp-cloud] Media upload response did not include an ID.");
    return payload.id;
  }

  private async sendGraphMessage(recipient: string, content: Record<string, unknown>): Promise<string | undefined> {
    const response = await this.fetcher(`${this.graphBase}/${this.options.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, ...content })
    });
    const payload = await this.readGraphResponse<GraphMessageResponse>(response);
    return payload.messages?.[0]?.id;
  }

  private async graphRequest<T>(path: string): Promise<T> {
    const response = await this.fetcher(`${this.graphBase}${path}`, {
      headers: { authorization: `Bearer ${this.options.accessToken}` }
    });
    return this.readGraphResponse<T>(response);
  }

  private async readGraphResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) as unknown : {};
    } catch {
      throw new Error(`[whatsapp-cloud] Graph API returned invalid JSON (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const graphError = (payload as { error?: { message?: string; code?: number } }).error;
      throw new Error(`[whatsapp-cloud] Graph API error ${graphError?.code ?? response.status}: ${graphError?.message ?? "request failed"}.`);
    }
    return payload as T;
  }

  private mapInbound(message: CloudWebhookMessage): InboundEvent | undefined {
    if (!message.from || !message.id) return undefined;
    const externalId = message.from.replace(/\D/g, "");
    if (!externalId) return undefined;
    const identity: CommunicationIdentity = {
      userId: userId(""),
      channel: "whatsapp",
      externalId
    };
    const timestampSeconds = Number(message.timestamp);
    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) return undefined;
    const timestamp = new Date(timestampSeconds * 1000);
    this.lastInboundAt.delete(externalId);
    this.lastInboundAt.set(externalId, timestamp.getTime());
    if (this.lastInboundAt.size > 10_000) {
      const oldest = this.lastInboundAt.keys().next().value;
      if (oldest) this.lastInboundAt.delete(oldest);
    }

    const actionId = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
    if (actionId) return { kind: "action", channel: "whatsapp", identity, actionId, timestamp };
    if (message.reaction?.message_id && message.reaction.emoji) {
      return {
        kind: "reaction",
        channel: "whatsapp",
        identity,
        targetMessageId: message.reaction.message_id,
        emoji: message.reaction.emoji,
        timestamp
      };
    }

    const media = this.mapMedia(message);
    if (media) {
      return {
        kind: "message",
        channel: "whatsapp",
        identity,
        externalMessageId: message.id,
        content: { kind: "media", media, caption: media.caption },
        timestamp
      };
    }

    if (typeof message.text?.body !== "string") return undefined;

    const text = message.text.body;
    const pending = this.pendingActions.get(externalId);
    if (pending) {
      const trimmed = text.trim();
      const index = /^\d+$/.test(trimmed) ? Number(trimmed) - 1 : -1;
      const action = index >= 0
        ? pending[index]
        : pending.find((candidate) => candidate.label.toLowerCase() === trimmed.toLowerCase());
      if (action) {
        this.pendingActions.delete(externalId);
        return { kind: "action", channel: "whatsapp", identity, actionId: action.id, timestamp };
      }
    }

    const command = parseCommand(text);
    if (command) return { kind: "command", channel: "whatsapp", identity, command, timestamp };
    return {
      kind: "message",
      channel: "whatsapp",
      identity,
      externalMessageId: message.id,
      content: { kind: "text", text },
      timestamp
    };
  }

  private async processWebhookMessage(message: CloudWebhookMessage): Promise<void> {
    const messageId = message.id;
    if (messageId && this.seenMessageIds.has(messageId)) return;
    const inFlight = messageId ? this.inFlightMessages.get(messageId) : undefined;
    if (inFlight) return inFlight;

    const processing = (async () => {
      const event = this.mapInbound(message);
      if (event) {
        await this.persistCustomerWindow(event.identity.externalId);
        await this.receiver?.(event);
      }
    })();
    if (messageId) this.inFlightMessages.set(messageId, processing);
    try {
      await processing;
      if (messageId) this.rememberMessageId(messageId);
    } finally {
      if (messageId) this.inFlightMessages.delete(messageId);
    }
  }

  private mapMedia(message: CloudWebhookMessage): (MediaPayload & { caption?: string }) | undefined {
    const mappings: Partial<Record<NonNullable<CloudWebhookMessage["type"]>, {
      ref?: CloudMediaRef;
      kind: MediaPayload["kind"];
    }>> = {
      image: { ref: message.image, kind: "image" },
      video: { ref: message.video, kind: "video" },
      audio: { ref: message.audio, kind: "audio" },
      document: { ref: message.document, kind: "document" },
      sticker: { ref: message.sticker, kind: "sticker" }
    };
    const mapping = message.type ? mappings[message.type] : undefined;
    if (!mapping?.ref?.id) return undefined;
    return {
      kind: mapping.kind,
      channelRef: mapping.ref.id,
      mimeType: mapping.ref.mime_type ?? (mapping.kind === "sticker" ? "image/webp" : undefined),
      filename: mapping.ref.filename,
      sizeBytes: mapping.ref.file_size,
      caption: mapping.ref.caption
    };
  }

  private async assertCustomerServiceWindow(recipient: string): Promise<void> {
    let lastInbound = this.lastInboundAt.get(recipient);
    if (lastInbound === undefined && this.users) {
      const identity = await this.users.identityForChannelExternalId("whatsapp", recipient);
      const profile = identity ? await this.users.profileFor(identity.userId) : undefined;
      if (profile?.whatsappCloudLastInboundAt) {
        lastInbound = Date.parse(profile.whatsappCloudLastInboundAt);
        if (Number.isFinite(lastInbound)) this.lastInboundAt.set(recipient, lastInbound);
      }
    }
    const now = Date.now();
    if (lastInbound === undefined || !Number.isFinite(lastInbound) ||
      lastInbound > now + 30_000 || now - lastInbound >= CUSTOMER_SERVICE_WINDOW_MS) {
      throw new Error("[whatsapp-cloud] Free-form messages require a customer message within the past 24 hours.");
    }
  }

  private async persistCustomerWindow(externalId: string): Promise<void> {
    if (!this.users) return;
    const identity = await this.users.identityForChannelExternalId("whatsapp", externalId);
    const profile = identity ? await this.users.profileFor(identity.userId) : undefined;
    const lastInbound = this.lastInboundAt.get(externalId);
    if (!identity || !profile || lastInbound === undefined) return;
    await this.users.saveProfile({
      ...profile,
      whatsappCloudLastInboundAt: new Date(lastInbound).toISOString()
    });
  }

  private verifySignature(body: Buffer, signature: string | string[] | undefined): boolean {
    if (typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = createHmac("sha256", this.options.appSecret).update(body).digest();
    const supplied = Buffer.from(signature.slice("sha256=".length), "hex");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  private secureEqual(left: string, right: string): boolean {
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
  }

  private rememberMessageId(id: string): void {
    this.seenMessageIds.add(id);
    if (this.seenMessageIds.size > 10_000) {
      const oldest = this.seenMessageIds.values().next().value;
      if (oldest) this.seenMessageIds.delete(oldest);
    }
  }
}

const COMMANDS = new Set(["start", "find", "next", "leave", "report", "block", "help", "points", "vip", "end", "app", "settings"]);

const parseCommand = (text: string): Command | undefined => {
  const token = text.trim().toLowerCase().split(/\s+/, 1)[0] ?? "";
  const name = token.startsWith("/") ? token.slice(1).split("@", 1)[0] : "";
  return COMMANDS.has(name) ? name as Command : undefined;
};

const readRawBody = async (req: IncomingMessage, maxBytes: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer);
    length += buffer.length;
    if (length > maxBytes) throw new Error("Request body exceeds size limit.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

const readResponseBytes = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error("[whatsapp-cloud] Media exceeds the download size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const isWebp = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 12 &&
  String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
  String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
