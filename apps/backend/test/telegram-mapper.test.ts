import { describe, expect, it } from "vitest";
import { mapTelegramInbound } from "../src/infrastructure/channels/telegram/telegram-mapper.js";

describe("Telegram media mapping", () => {
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
