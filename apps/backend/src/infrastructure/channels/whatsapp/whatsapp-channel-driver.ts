import type {
  ChannelCapabilities,
  ChannelDriver,
  ChannelRecipient,
  InboundEvent,
  MediaPayload,
  OutboundMessage
} from "../../../ports/channels.js";
import { htmlToPlainText } from "../html-text.js";

/** Media payload the bridge can send, discriminated by `type`. */
export type BridgeMedia =
  | { type: "image"; url: string; caption?: string; mimeType?: string }
  | { type: "image"; data: Uint8Array; caption?: string; mimeType?: string }
  | { type: "video"; url: string; caption?: string; mimeType?: string; gifPlayback?: boolean }
  | { type: "video"; data: Uint8Array; caption?: string; mimeType?: string; gifPlayback?: boolean }
  | { type: "audio"; url: string; mimeType?: string; ptt?: boolean }
  | { type: "audio"; data: Uint8Array; mimeType?: string; ptt?: boolean }
  | { type: "document"; url: string; filename?: string; mimeType?: string; caption?: string }
  | { type: "document"; data: Uint8Array; filename?: string; mimeType?: string; caption?: string }
  | { type: "sticker"; url: string }
  | { type: "sticker"; data: Uint8Array };

export interface BaileysSocketBridge {
  connect(): Promise<void>;
  onMessage(handler: (raw: unknown) => void): void;
  sendText(jid: string, text: string): Promise<string | undefined>;
  /** Media is passed already normalized to `BridgeMedia`. */
  sendMedia?(jid: string, media: BridgeMedia): Promise<string | undefined>;
  sendTyping?(jid: string): Promise<void>;
  sendButtons?(jid: string, text: string, actions: readonly { id: string; label: string }[]): Promise<string | undefined>;
  deleteMessage?(jid: string, messageId: string): Promise<void>;
  /** Optional — used for cross-channel forwards. Returns url/bytes or the input unchanged. */
  resolveMedia?(media: MediaPayload): Promise<MediaPayload>;
  close(): Promise<void>;
}

export class WhatsAppChannelDriver implements ChannelDriver {
  readonly type = "whatsapp";
  readonly capabilities: ChannelCapabilities;

  private readonly pendingActions = new Map<string, readonly { id: string; label: string }[]>();

  constructor(
    private readonly socket: BaileysSocketBridge,
    private readonly mapInbound: (raw: unknown) => InboundEvent | undefined
  ) {
    this.capabilities = {
      text: true,
      buttons: false,
      menus: false,
      menuLayouts: [],
      messageEditing: false,
      messageDeletion: true,
      typingIndicator: true,
      media: ["image", "video", "audio", "document", "voice" , "sticker"],
      payments: [],
      deepLinks: false
    };
  }

  async start(receiver: (event: InboundEvent) => Promise<void>): Promise<void> {
    this.socket.onMessage((raw) => {
      const event = this.mapInbound(raw);
      if (!event) return;
      void receiver(this.resolvePendingAction(event)).catch((error) => {
        console.error("[whatsapp] receiver failed for inbound event.", error);
      });
    });
    await this.socket.connect();
  }

  async stop(): Promise<void> {
    await this.socket.close();
  }

  async sendTyping(recipient: ChannelRecipient): Promise<void> {
    if (!this.socket.sendTyping) return;
    await this.socket.sendTyping(recipient.externalId);
  }

  async deleteMessage(recipient: ChannelRecipient, externalMessageId: string): Promise<void> {
    if (!this.socket.deleteMessage) throw new Error("WhatsApp bridge does not implement message deletion.");
    await this.socket.deleteMessage(recipient.externalId, externalMessageId);
  }

  /**
   * Cross-channel forwarding hook. WhatsApp inbound media arrives from Baileys
   * as a downloadable message object, not a URL — resolving it properly requires
   * `downloadMediaMessage`. For now we return the input unchanged so that
   * forwards *into* WhatsApp work (the origin channel resolves the URL) and
   * forwards *out of* WhatsApp fail gracefully with a user-facing message.
   */
  async resolveMedia(media: MediaPayload): Promise<MediaPayload> {
    if (media.url || media.bytes) return media;
    if (!this.socket.resolveMedia) return media;
    return this.socket.resolveMedia(media);
  }

  async sendMessage(recipient: ChannelRecipient, message: OutboundMessage): Promise<string | undefined> {
    if (message.kind === "text") {
      const text = message.format === "html" ? htmlToPlainText(message.text) : message.text;
      return this.socket.sendText(recipient.externalId, text);
    }

    if (message.kind === "media") {
      return this.sendMedia(recipient, message);
    }

    if (message.kind === "interaction") {
      if (this.socket.sendButtons && this.capabilities.buttons) {
        const text = message.format === "html" ? htmlToPlainText(message.text) : message.text;
        return this.socket.sendButtons(recipient.externalId, text, message.actions);
      }
      this.pendingActions.set(recipient.externalId, message.actions);
      const text = message.format === "html" ? htmlToPlainText(message.text) : message.text;
      const numbered = message.actions.map((a, i) => `${i + 1}. ${a.label}`).join("\n");
      return this.socket.sendText(recipient.externalId, `${text}\n\nReply with:\n${numbered}`);
    }

    console.warn(`[whatsapp] Dropping unsupported outbound kind: ${message.kind}`);
    return undefined;
  }

  private async sendMedia(
    recipient: ChannelRecipient,
    message: Extract<OutboundMessage, { kind: "media" }>
  ): Promise<string | undefined> {
    if (!this.socket.sendMedia) {
      console.warn("[whatsapp] Bridge does not implement sendMedia; dropping media message");
      return undefined;
    }

    if (!this.capabilities.media.includes(message.media.kind)) {
      console.warn(`[whatsapp] Unsupported media type: ${message.media.kind}`);
      return undefined;
    }

    // Cross-channel media that never got resolved will have only `channelRef`.
    // Don't throw — the app-side gate should have caught this, but if it slips
    // through, log and drop rather than crash the bot.
    if (!message.media.url && !message.media.bytes) {
      console.warn(
        `[whatsapp] Dropping media with no url/bytes (kind: ${message.media.kind}, channelRef: ${message.media.channelRef ?? "none"})`
      );
      return undefined;
    }

    const bridgeMedia = this.toBridgeMedia(message);
    return this.socket.sendMedia(recipient.externalId, bridgeMedia);
  }

  private toBridgeMedia(
    message: Extract<OutboundMessage, { kind: "media" }>
  ): BridgeMedia {
    const payload = message.media;

    const source =
      payload.url !== undefined
        ? { url: payload.url }
        : payload.bytes !== undefined
          ? { data: payload.bytes }
          : undefined;

    if (!source) {
      // Defensive — sendMedia above already gated on this.
      throw new Error(
        `[whatsapp] toBridgeMedia called without url/bytes (kind: ${payload.kind})`
      );
    }

    switch (payload.kind) {
      case "image":
        return { type: "image", ...source, caption: message.caption, mimeType: payload.mimeType };

      case "video":
        return { type: "video", ...source, caption: message.caption, mimeType: payload.mimeType };

      case "audio":
        return { type: "audio", ...source, mimeType: payload.mimeType, ptt: false };

      case "voice":
        // `voice` maps to a WhatsApp push-to-talk note.
        return { type: "audio", ...source, mimeType: payload.mimeType ?? "audio/ogg", ptt: true };

      case "document":
        return {
          type: "document",
          ...source,
          filename: payload.filename,
          mimeType: payload.mimeType,
          caption: message.caption
        };

      case "sticker":
        return { type: "sticker", ...source };

      case "location":
        throw new Error("[whatsapp] Location is not a BridgeMedia — handle separately.");
    }

    throw new Error(`[whatsapp] Unsupported media type: ${payload.kind}`);
  }

  private resolvePendingAction(event: InboundEvent): InboundEvent {
    if (event.kind !== "message") return event;
    if (event.content.kind !== "text") return event;

    const pending = this.pendingActions.get(event.identity.externalId);
    if (!pending || pending.length === 0) return event;
    const text = event.content.text.trim();

    if (/^[1-9]\d*$/.test(text)) {
      const index = Number.parseInt(text, 10);
      if (index >= 1 && index <= pending.length) {
        const action = pending[index - 1];
        this.pendingActions.delete(event.identity.externalId);
        return {
          kind: "action",
          channel: event.channel,
          identity: event.identity,
          actionId: action.id,
          timestamp: event.timestamp
        };
      }
    }

    const labelMatch = pending.find((a) => a.label.toLowerCase() === text.toLowerCase());
    if (labelMatch) {
      this.pendingActions.delete(event.identity.externalId);
      return {
        kind: "action",
        channel: event.channel,
        identity: event.identity,
        actionId: labelMatch.id,
        timestamp: event.timestamp
      };
    }

    return event;
  }
}