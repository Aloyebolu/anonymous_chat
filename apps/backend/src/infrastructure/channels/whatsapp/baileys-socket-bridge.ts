import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
  type WAMessage
} from "baileys";
import qrcode from "qrcode-terminal";
import type { BaileysSocketBridge, BridgeMedia } from "./whatsapp-channel-driver.js";
import type { MediaPayload } from "../../../ports/channels.js";

export interface BaileysBridgeOptions {
  readonly authDir: string;
}

export class BaileysSocketBridgeImpl implements BaileysSocketBridge {
  private sock?: WASocket;
  private messageHandler?: (raw: unknown) => void;
  private closing = false;
  private connecting = false;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private lastOutboundAt = 0;
  private outboundPending = 0;
  private outboundTail: Promise<void> = Promise.resolve();
  private readonly inboundMessages = new Map<string, WAMessage>();
  private static readonly MIN_SEND_INTERVAL_MS = 1_000;
  private static readonly MAX_PENDING_SENDS = 100;

  constructor(private readonly options: BaileysBridgeOptions) {}

  onMessage(handler: (raw: unknown) => void): void {
    this.messageHandler = handler;
  }

  async connect(): Promise<void> {
    if (this.closing || this.connecting || this.sock) return;
    this.connecting = true;
    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.options.authDir);
      const { version } = await fetchLatestBaileysVersion();
      if (this.closing) return;
      const sock = makeWASocket({
        version,
        auth: state,
        browser: ["Anonymous Adult Chat", "Chrome", "1.0"]
      });
      this.sock = sock;

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          console.log("QR code available. Scan the QR code with WhatsApp:");
          qrcode.generate(qr, { small: true });
        }
        if (connection === "open") {
          this.reconnectAttempt = 0;
          console.log("Connected to WhatsApp.");
        }
        if (connection === "close") {
          const statusCode = (
            lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
          )?.output?.statusCode;
          this.sock = undefined;
          const requiresReauthentication = statusCode === DisconnectReason.loggedOut ||
            statusCode === DisconnectReason.connectionReplaced;
          if (!this.closing && !requiresReauthentication) this.scheduleReconnect();
          else if (requiresReauthentication) {
            console.error("[baileys] Session logged out or replaced. Re-link the account before reconnecting.");
          }
        }
      });

      sock.ev.on("messages.upsert", ({ messages, type }) => {
        if (type !== "notify") return;
        const handler = this.messageHandler;
        if (!handler) return;
        for (const message of messages) {
          try {
            if (message.key.id) {
              this.inboundMessages.set(message.key.id, message);
              if (this.inboundMessages.size > 500) {
                const oldest = this.inboundMessages.keys().next().value;
                if (oldest) this.inboundMessages.delete(oldest);
              }
            }
            handler(message);
          } catch (error) {
            console.error("Failed to handle inbound WhatsApp message.", error);
          }
        }
      });

      sock.ev.on("messages.update", (updates) => {
        if (this.closing) return;
        const handler = this.messageHandler;
        if (!handler) return;
        for (const entry of updates) {
          const editedMessage = entry.update.message?.editedMessage?.message;
          if (!entry.key.remoteJid || !entry.key.id || !editedMessage) continue;
          handler({
            key: entry.key,
            message: {
              protocolMessage: {
                key: { id: entry.key.id },
                editedMessage
              }
            },
            messageTimestamp: entry.update.messageTimestamp
          });
        }
      });
    } finally {
      this.connecting = false;
    }
  }

  async sendText(jid: string, text: string, replyToMessageId?: string): Promise<string | undefined> {
    return this.enqueueOutbound(async () => {
      if (!this.sock) throw new Error("Baileys socket is not connected.");
      const quoted = replyToMessageId ? this.inboundMessages.get(replyToMessageId) : undefined;
      if (replyToMessageId && !quoted) throw new Error("[baileys] The message to reply to is no longer available.");
      const sent = await this.sock.sendMessage(jid, { text }, quoted ? { quoted } : undefined);
      return sent?.key.id ?? undefined;
    });
  }

  async sendMedia(jid: string, media: BridgeMedia, replyToMessageId?: string): Promise<string | undefined> {
    return this.enqueueOutbound(async () => {
      if (!this.sock) throw new Error("Baileys socket is not connected.");

      // Both variants (`url` and `data`) are accepted by Baileys directly.
      const source =
        "url" in media ? { url: media.url } : Buffer.from(media.data);
      const quoted = replyToMessageId ? this.inboundMessages.get(replyToMessageId) : undefined;
      if (replyToMessageId && !quoted) throw new Error("[baileys] The message to reply to is no longer available.");
      const options = quoted ? { quoted } : undefined;

      switch (media.type) {
        case "image":
          return (await this.sock.sendMessage(jid, {
            image: source,
            caption: media.caption,
            mimetype: media.mimeType
          }, options))?.key.id ?? undefined;

        case "video":
          return (await this.sock.sendMessage(jid, {
            video: source,
            caption: media.caption,
            mimetype: media.mimeType,
            gifPlayback: media.gifPlayback
          }, options))?.key.id ?? undefined;

        case "audio":
          return (await this.sock.sendMessage(jid, {
            audio: source,
            mimetype: media.mimeType ?? "audio/mp4",
            ptt: media.ptt ?? false
          }, options))?.key.id ?? undefined;

        case "document":
          return (await this.sock.sendMessage(jid, {
            document: source,
            mimetype: media.mimeType ?? "application/octet-stream",
            fileName: media.filename ?? "file",
            caption: media.caption
          }, options))?.key.id ?? undefined;

        case "sticker":
          return (await this.sock.sendMessage(jid, { sticker: source }, options))?.key.id ?? undefined;
      }
    });
  }

  async deleteMessage(jid: string, messageId: string): Promise<void> {
    if (!this.sock) throw new Error("Baileys socket is not connected.");
    await this.sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: true, id: messageId } });
  }

  async editMessage(jid: string, messageId: string, text: string): Promise<void> {
    await this.enqueueOutbound(async () => {
      if (!this.sock) throw new Error("Baileys socket is not connected.");
      await this.sock.sendMessage(jid, {
        text,
        edit: { remoteJid: jid, fromMe: true, id: messageId }
      });
    });
  }

  async reactMessage(jid: string, messageId: string, emoji: string): Promise<void> {
    await this.enqueueOutbound(async () => {
      if (!this.sock) throw new Error("Baileys socket is not connected.");
      await this.sock.sendMessage(jid, {
        react: {
          text: emoji,
          key: { remoteJid: jid, fromMe: false, id: messageId }
        }
      });
    });
  }

  async resolveMedia(media: MediaPayload): Promise<MediaPayload> {
    if (media.url || media.bytes || !media.channelRef) return media;
    const message = this.inboundMessages.get(media.channelRef);
    if (!message) return media;
    const bytes = await downloadMediaMessage(message, "buffer", {});
    this.inboundMessages.delete(media.channelRef);
    return { ...media, channelRef: undefined, bytes, sizeBytes: bytes.byteLength };
  }

  async sendTyping(jid: string): Promise<void> {
    if (!this.sock) return;
    try {
      await this.sock.sendPresenceUpdate("composing", jid);
    } catch (error) {
      console.warn("[baileys] sendTyping failed.", error);
    }

  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (this.sock) await this.sock.end(undefined);
    this.sock = undefined;
  }

  private enqueueOutbound<T>(send: () => Promise<T>): Promise<T> {
    if (this.outboundPending >= BaileysSocketBridgeImpl.MAX_PENDING_SENDS) {
      throw new Error("[baileys] Outbound queue is full; refusing to send another message.");
    }
    this.outboundPending += 1;
    const result = this.outboundTail.then(async () => {
      const waitMs = BaileysSocketBridgeImpl.MIN_SEND_INTERVAL_MS - (Date.now() - this.lastOutboundAt);
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.lastOutboundAt = Date.now();
      return send();
    });
    this.outboundTail = result.then(() => undefined, () => undefined);
    return result.finally(() => { this.outboundPending -= 1; });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closing) return;
    const exponentialDelay = Math.min(30_000 * 2 ** this.reconnectAttempt, 5 * 60_000);
    const jitteredDelay = Math.round(exponentialDelay * (0.8 + Math.random() * 0.4));
    this.reconnectAttempt += 1;
    console.warn(`[baileys] Connection closed. Retrying in ${Math.ceil(jitteredDelay / 1000)} seconds.`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch((error) => {
        console.error("[baileys] Reconnect attempt failed.", error);
        this.scheduleReconnect();
      });
    }, jitteredDelay);
  }
}

const hasMediaContent = (message: WAMessage): boolean => {
  const content = message.message;
  return Boolean(content?.imageMessage || content?.videoMessage || content?.audioMessage || content?.documentMessage || content?.stickerMessage);
};
