import { describe, expect, it } from "vitest";
import { mapBaileysInbound } from "../src/infrastructure/channels/whatsapp/baileys-mapper.js";

describe("Baileys inbound mapper", () => {
  it("maps a plain text message to a generic inbound message event", () => {
    const event = mapBaileysInbound({
      key: { remoteJid: "1234@s.whatsapp.net", fromMe: false, id: "abc" },
      message: { conversation: "hello" },
      messageTimestamp: 1700000000
    });
    expect(event?.kind).toBe("message");
    if (event?.kind === "message") {
      expect(event.identity.externalId).toBe("1234@s.whatsapp.net");
      expect(event.externalMessageId).toBe("abc");
      expect(event.content.text).toBe("hello");
    }
  });

  it("maps extended text messages", () => {
    const event = mapBaileysInbound({
      key: { remoteJid: "1234@s.whatsapp.net", fromMe: false, id: "abc" },
      message: { extendedTextMessage: { text: "hi there" } },
      messageTimestamp: 1700000000
    });
    expect(event?.kind).toBe("message");
  });

  it("maps an incoming WhatsApp image for later media resolution", () => {
    const event = mapBaileysInbound({
      key: { remoteJid: "1234@s.whatsapp.net", fromMe: false, id: "image-message" },
      message: { imageMessage: { mimetype: "image/jpeg", fileLength: 512n } },
      messageTimestamp: 1700000000
    });
    expect(event?.kind).toBe("message");
    if (event?.kind === "message" && event.content.kind === "media") {
      expect(event.content.media).toMatchObject({
        kind: "image",
        channelRef: "image-message",
        mimeType: "image/jpeg",
        sizeBytes: 512
      });
    } else {
      throw new Error("Expected inbound image media.");
    }
  });

  it("maps slash commands", () => {
    const event = mapBaileysInbound({
      key: { remoteJid: "1234@s.whatsapp.net", fromMe: false, id: "abc" },
      message: { conversation: "/find" },
      messageTimestamp: 1700000000
    });
    expect(event?.kind).toBe("command");
    if (event?.kind === "command") expect(event.command).toBe("find");
  });

  it("maps button responses to action events", () => {
    const event = mapBaileysInbound({
      key: { remoteJid: "1234@s.whatsapp.net", fromMe: false, id: "abc" },
      message: { buttonsResponseMessage: { selectedButtonId: "confirm-adult" } },
      messageTimestamp: 1700000000
    });
    expect(event?.kind).toBe("action");
    if (event?.kind === "action") expect(event.actionId).toBe("confirm-adult");
  });

  it("maps list responses to action events", () => {
    const event = mapBaileysInbound({
      key: { remoteJid: "1234@s.whatsapp.net", fromMe: false, id: "abc" },
      message: { listResponseMessage: { singleSelectReply: { selectedRowId: "gender:male" } } },
      messageTimestamp: 1700000000
    });
    expect(event?.kind).toBe("action");
    if (event?.kind === "action") expect(event.actionId).toBe("gender:male");
  });

  it("ignores our own outbound messages", () => {
    const event = mapBaileysInbound({
      key: { remoteJid: "1234@s.whatsapp.net", fromMe: true, id: "abc" },
      message: { conversation: "hello" },
      messageTimestamp: 1700000000
    });
    expect(event).toBeUndefined();
  });

  it("ignores messages with no extractable content", () => {
    const event = mapBaileysInbound({
      key: { remoteJid: "1234@s.whatsapp.net", fromMe: false, id: "abc" },
      message: {},
      messageTimestamp: 1700000000
    });
    expect(event).toBeUndefined();
  });
});