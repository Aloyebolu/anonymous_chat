import { describe, expect, it } from "vitest";
import { WhatsAppChannelDriver, type BaileysSocketBridge } from "../src/infrastructure/channels/whatsapp/whatsapp-channel-driver.js";
import { mapBaileysInbound } from "../src/infrastructure/channels/whatsapp/baileys-mapper.js";
import type { InboundEvent } from "../src/ports/channels.js";

class FakeSocket implements BaileysSocketBridge {
  readonly sent: { jid: string; text: string }[] = [];
  private handler?: (raw: unknown) => void;
  async connect(): Promise<void> {}
  onMessage(handler: (raw: unknown) => void): void { this.handler = handler; }
  async sendText(jid: string, text: string): Promise<void> { this.sent.push({ jid, text }); }
  async close(): Promise<void> {}
  emit(raw: unknown): void { this.handler?.(raw); }
}

describe("WhatsApp channel driver", () => {
  it("sends plain text outbound", async () => {
    const socket = new FakeSocket();
    const driver = new WhatsAppChannelDriver(socket, mapBaileysInbound);
    await driver.start(async () => {});
    await driver.sendMessage({ channel: "whatsapp", externalId: "a@s.whatsapp.net" }, { kind: "text", text: "hi" });
    expect(socket.sent).toEqual([{ jid: "a@s.whatsapp.net", text: "hi" }]);
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