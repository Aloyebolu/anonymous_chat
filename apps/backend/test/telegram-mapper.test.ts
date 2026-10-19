import { describe, expect, it } from "vitest";
import { mapTelegramInbound } from "../src/infrastructure/channels/telegram/telegram-mapper.js";

describe("Telegram inbound mapping", () => {
  it("maps native text edits", () => {
    expect(mapTelegramInbound({
      edited_message: {
        message_id: 11,
        chat: { id: 42 },
        date: 1,
        text: "updated"
      }
    })).toMatchObject({ kind: "edit", targetMessageId: "11", text: "updated" });
  });

  it("maps message replies and reaction updates", () => {
    const reply = mapTelegramInbound({
      message: {
        message_id: 8,
        chat: { id: 42 },
        date: 1,
        text: "reply",
        reply_to_message: { message_id: 7 }
      }
    });
    expect(reply?.kind).toBe("message");
    if (reply?.kind === "message") expect(reply.content.replyToMessageId).toBe("7");

    const reaction = mapTelegramInbound({
      message_reaction: {
        chat: { id: 42 },
        message_id: 7,
        date: 1,
        new_reaction: [{ type: "emoji", emoji: "👍" }]
      }
    });
    expect(reaction).toMatchObject({ kind: "reaction", targetMessageId: "7", emoji: "👍" });
  });

  it("maps static stickers as WebP images", () => {
    const event = mapTelegramInbound({
      message: {
        message_id: 1,
        chat: { id: 42 },
        date: 1,
        sticker: { file_id: "sticker-id" }
      }
    });
    expect(event?.kind).toBe("message");
    if (event?.kind === "message" && event.content.kind === "media") {
      expect(event.content.media).toMatchObject({ kind: "sticker", mimeType: "image/webp" });
    } else {
      throw new Error("Expected a sticker media message.");
    }
  });

  it("does not mislabel animated TGS stickers as WebP images", () => {
    const event = mapTelegramInbound({
      message: {
        message_id: 2,
        chat: { id: 42 },
        date: 1,
        sticker: { file_id: "animated-id", is_animated: true }
      }
    });
    expect(event?.kind).toBe("message");
    if (event?.kind === "message" && event.content.kind === "media") {
      expect(event.content.media.mimeType).not.toBe("image/webp");
    } else {
      throw new Error("Expected an animated sticker media message.");
    }
  });

  it("maps video stickers as WebM video", () => {
    const event = mapTelegramInbound({
      message: {
        message_id: 3,
        chat: { id: 42 },
        date: 1,
        sticker: { file_id: "video-id", is_video: true }
      }
    });
    expect(event?.kind).toBe("message");
    if (event?.kind === "message" && event.content.kind === "media") {
      expect(event.content.media).toMatchObject({ kind: "video", mimeType: "video/webm" });
    } else {
      throw new Error("Expected a video sticker media message.");
    }
  });
});
