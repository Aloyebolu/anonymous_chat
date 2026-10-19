import { describe, expect, it } from "vitest";
import { WhatsAppChannelDriver, type BaileysSocketBridge, type BridgeMedia } from "../src/infrastructure/channels/whatsapp/whatsapp-channel-driver.js";
import { mapBaileysInbound } from "../src/infrastructure/channels/whatsapp/baileys-mapper.js";
import type { InboundEvent } from "../src/ports/channels.js";

class FakeSocket implements BaileysSocketBridge {
  readonly sent: { jid: string; text: string }[] = [];
  deleted: { jid: string; messageId: string } | undefined;
  mediaSent: { jid: string; media: BridgeMedia } | undefined;
  private handler?: (raw: unknown) => void;
  async connect(): Promise<void> {}
  onMessage(handler: (raw: unknown) => void): void { this.handler = handler; }
  async sendText(jid: string, text: string): Promise<string | undefined> { this.sent.push({ jid, text }); return "wa-message-id"; }
  async sendMedia(jid: string, media: BridgeMedia): Promise<string | undefined> { this.mediaSent = { jid, media }; return "wa-media-id"; }
  async deleteMessage(jid: string, messageId: string): Promise<void> { this.deleted = { jid, messageId }; }
  async close(): Promise<void> {}
  emit(raw: unknown): void { this.handler?.(raw); }
}

const validWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe("WhatsApp channel driver", () => {
  it("sends plain text outbound", async () => {
    const socket = new FakeSocket();
    const driver = new WhatsAppChannelDriver(socket, mapBaileysInbound);
    await driver.start(async () => {});
    await driver.sendMessage({ channel: "whatsapp", externalId: "a@s.whatsapp.net" }, { kind: "text", text: "hi" });
    expect(socket.sent).toEqual([{ jid: "a@s.whatsapp.net", text: "hi" }]);
  });

  it("refuses outbound messages to WhatsApp groups", async () => {
    const socket = new FakeSocket();
    const driver = new WhatsAppChannelDriver(socket, mapBaileysInbound);
    await expect(driver.sendMessage(
      { channel: "whatsapp", externalId: "12345@g.us" },
      { kind: "text", text: "not for a group" }
    )).rejects.toThrow(/Group and status sends are disabled/);
    expect(socket.sent).toHaveLength(0);
  });

  it("deletes a previously sent message through Baileys", async () => {
    const socket = new FakeSocket();
    const driver = new WhatsAppChannelDriver(socket, mapBaileysInbound);
    await driver.deleteMessage({ channel: "whatsapp", externalId: "a@s.whatsapp.net" }, "wa-message-id");
    expect(socket.deleted).toEqual({ jid: "a@s.whatsapp.net", messageId: "wa-message-id" });
  });

  it("sends stickers without throwing through the WhatsApp bridge", async () => {
    const socket = new FakeSocket();
    const driver = new WhatsAppChannelDriver(socket, mapBaileysInbound);
    const messageId = await driver.sendMessage(
      { channel: "whatsapp", externalId: "a@s.whatsapp.net" },
      { kind: "media", media: { kind: "sticker", bytes: validWebp, mimeType: "image/webp" } }
    );
    expect(messageId).toBe("wa-media-id");
    expect(socket.mediaSent).toMatchObject({
      jid: "a@s.whatsapp.net",
      media: { type: "sticker", data: validWebp }
    });
  });

  it("rejects malformed WebP sticker bytes instead of forwarding a damaged sticker", async () => {
    const socket = new FakeSocket();
    const driver = new WhatsAppChannelDriver(socket, mapBaileysInbound);
    const messageId = await driver.sendMessage(
      { channel: "whatsapp", externalId: "a@s.whatsapp.net" },
      { kind: "media", media: { kind: "sticker", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/webp" } }
    );
    expect(messageId).toBeUndefined();
    expect(socket.mediaSent).toBeUndefined();
  });

  it("converts HTML-formatted text to readable plain text", async () => {
    const socket = new FakeSocket();
    const driver = new WhatsAppChannelDriver(socket, mapBaileysInbound);
    await driver.start(async () => {});
    await driver.sendMessage(
      { channel: "whatsapp", externalId: "a@s.whatsapp.net" },
      { kind: "text", text: "<b>Hello</b><br>Tom &amp; Jo", format: "html" }
    );
    expect(socket.sent[0].text).toBe("Hello\nTom & Jo");
  });

  it("renders interactions as a numbered text fallback", async () => {
    const socket = new FakeSocket();
    const driver = new WhatsAppChannelDriver(socket, mapBaileysInbound);
    await driver.start(async () => {});
    await driver.sendMessage(
      { channel: "whatsapp", externalId: "a@s.whatsapp.net" },
      { kind: "interaction", text: "Pick one", actions: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] }
    );
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0].text).toContain("Pick one");
    expect(socket.sent[0].text).toContain("1. X");
    expect(socket.sent[0].text).toContain("2. Y");
  });

  it("converts formatted interaction text before adding numbered actions", async () => {
    const socket = new FakeSocket();
    const driver = new WhatsAppChannelDriver(socket, mapBaileysInbound);
    await driver.start(async () => {});
    await driver.sendMessage(
      { channel: "whatsapp", externalId: "a@s.whatsapp.net" },
      { kind: "interaction", text: "<b>Choose one</b>", format: "html", actions: [{ id: "x", label: "X" }] }
    );
    expect(socket.sent[0].text).toBe("Choose one\n\nReply with:\n1. X");
  });

  it("resolves numeric replies into action events", async () => {
    const socket = new FakeSocket();
    const driver = new WhatsAppChannelDriver(socket, mapBaileysInbound);
    const received: InboundEvent[] = [];
    await driver.start(async (event) => { received.push(event); });
    await driver.sendMessage(
      { channel: "whatsapp", externalId: "a@s.whatsapp.net" },
      { kind: "interaction", text: "Pick", actions: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] }
    );
    socket.emit({ key: { remoteJid: "a@s.whatsapp.net", fromMe: false, id: "m" }, message: { conversation: "2" }, messageTimestamp: 1 });
    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe("action");
    if (received[0].kind === "action") expect(received[0].actionId).toBe("y");
  });

  it("resolves label replies into action events", async () => {
    const socket = new FakeSocket();
    const driver = new WhatsAppChannelDriver(socket, mapBaileysInbound);
    const received: InboundEvent[] = [];
    await driver.start(async (event) => { received.push(event); });
    await driver.sendMessage(
      { channel: "whatsapp", externalId: "a@s.whatsapp.net" },
      { kind: "interaction", text: "Pick", actions: [{ id: "x", label: "I am 18+" }] }
    );
    socket.emit({ key: { remoteJid: "a@s.whatsapp.net", fromMe: false, id: "m" }, message: { conversation: "I am 18+" }, messageTimestamp: 1 });
    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe("action");
    if (received[0].kind === "action") expect(received[0].actionId).toBe("x");
  });
});