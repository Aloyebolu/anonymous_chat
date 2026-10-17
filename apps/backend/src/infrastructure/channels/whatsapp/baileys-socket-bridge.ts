import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket
} from "baileys";
import qrcode from "qrcode-terminal";
import type { BaileysSocketBridge, BridgeMedia } from "./whatsapp-channel-driver.js";

export interface BaileysBridgeOptions {
  readonly authDir: string;
}

export class BaileysSocketBridgeImpl implements BaileysSocketBridge {
  private sock?: WASocket;
  private messageHandler?: (raw: unknown) => void;
  private closing = false;

  constructor(private readonly options: BaileysBridgeOptions) {}

  onMessage(handler: (raw: unknown) => void): void {
    this.messageHandler = handler;
  }

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.options.authDir);
    const { version } = await fetchLatestBaileysVersion();
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
        console.log("Connected to WhatsApp.");
      }
      if (connection === "close") {
        const statusCode = (
          lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
        )?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        if (!this.closing && !loggedOut) {
          console.log("WhatsApp connection closed. Reconnecting…");
          void this.connect();
        }
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      const handler = this.messageHandler;
      if (!handler) return;
      for (const message of messages) {
        try {
          handler(message);
        } catch (error) {
          console.error("Failed to handle inbound WhatsApp message.", error);
        }
      }
    });
  }

  async sendText(jid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error("Baileys socket is not connected.");
    await this.sock.sendMessage(jid, { text });
  }

  async sendMedia(jid: string, media: BridgeMedia): Promise<void> {
    if (!this.sock) throw new Error("Baileys socket is not connected.");

    // Both variants (`url` and `data`) are accepted by Baileys directly.
    const source =
      "url" in media ? { url: media.url } : Buffer.from(media.data);

    switch (media.type) {
      case "image":
        return void (await this.sock.sendMessage(jid, {
          image: source,
          caption: media.caption,
          mimetype: media.mimeType
        }));

      case "video":
        return void (await this.sock.sendMessage(jid, {
          video: source,
          caption: media.caption,
          mimetype: media.mimeType,
          gifPlayback: media.gifPlayback
        }));

      case "audio":
        return void (await this.sock.sendMessage(jid, {
          audio: source,
          mimetype: media.mimeType ?? "audio/mp4",
          ptt: media.ptt ?? false
        }));

      case "document":
        return void (await this.sock.sendMessage(jid, {
          document: source,
          mimetype: media.mimeType ?? "application/octet-stream",
          fileName: media.filename ?? "file",
          caption: media.caption
        }));
    }
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
    if (this.sock) await this.sock.end(undefined);
  }
}
