import { TelegramUpdateShape } from "../infrastructure/channels/telegram/telegram-mapper.js";
import { MediaPayload } from "../ports/channels.js";

/**
 * Telegram returns photos as an array of sizes; pick the largest.
 * Everything else is a single object with a file_id.
 */
export const extractMedia = (message: NonNullable<TelegramUpdateShape["message"]>): MediaPayload | undefined => {
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    return { kind: "image", channelRef: largest.file_id, sizeBytes: largest.file_size };
  }
  if (message.video) {
    return {
      kind: "video",
      channelRef: message.video.file_id,
      mimeType: message.video.mime_type,
      durationSec: message.video.duration,
      sizeBytes: message.video.file_size
    };
  }
  if (message.voice) {
    return {
      kind: "voice",
      channelRef: message.voice.file_id,
      mimeType: message.voice.mime_type,
      durationSec: message.voice.duration,
      sizeBytes: message.voice.file_size
    };
  }
  if (message.audio) {
    return {
      kind: "audio",
      channelRef: message.audio.file_id,
      mimeType: message.audio.mime_type,
      filename: message.audio.file_name,
      durationSec: message.audio.duration,
      sizeBytes: message.audio.file_size
    };
  }
  if (message.document) {
    return {
      kind: "document",
      channelRef: message.document.file_id,
      mimeType: message.document.mime_type,
      filename: message.document.file_name,
      sizeBytes: message.document.file_size
    };
  }
  if (message.sticker) {
    return { kind: "sticker", channelRef: message.sticker.file_id };
  }
  if (message.animation) {
    return {
      kind: "video",
      channelRef: message.animation.file_id,
      mimeType: message.animation.mime_type,
      durationSec: message.animation.duration,
      sizeBytes: message.animation.file_size
    };
  }
  return undefined;
};