import { userId, type ChannelType, type CommunicationIdentity } from "../../../domain/types.js";
import type { InboundEvent } from "../../../ports/channels.js";
import type { MediaPayload } from "../../../ports/channels.js";

type Command = "start" | "find" | "next" | "leave" | "report" | "block" | "help" | "points" | "vip" | "end" | "app" | "settings";

const COMMANDS: Record<string, Command> = {
  "/start": "start",
  "/find": "find",
  "/next": "next",
  "/leave": "leave",
  "/report": "report",
  "/block": "block",
  "/help": "help",
  "/points": "points",
  "/vip": "vip",
  "/end": "end",
  "/app": "app",
  "/settings": "settings"
};

interface BaileysMessageShape {
  readonly key?: {
    readonly remoteJid?: string;
    readonly fromMe?: boolean;
    readonly id?: string;
  };
  readonly message?: {
    readonly conversation?: string;
    readonly extendedTextMessage?: { readonly text?: string };
    readonly imageMessage?: { readonly mimetype?: string; readonly fileLength?: number | bigint; readonly caption?: string };
    readonly videoMessage?: { readonly mimetype?: string; readonly fileLength?: number | bigint; readonly seconds?: number };
    readonly audioMessage?: { readonly mimetype?: string; readonly fileLength?: number | bigint; readonly seconds?: number; readonly ptt?: boolean };
    readonly documentMessage?: { readonly mimetype?: string; readonly fileLength?: number | bigint; readonly fileName?: string };
    readonly stickerMessage?: { readonly mimetype?: string; readonly fileLength?: number | bigint };
    readonly buttonsResponseMessage?: { readonly selectedButtonId?: string };
    readonly listResponseMessage?: { readonly singleSelectReply?: { readonly selectedRowId?: string } };
    readonly templateButtonReplyMessage?: { readonly selectedId?: string };
  };
  readonly messageTimestamp?: number | bigint | { toNumber(): number };
}

const identityFor = (externalId: string): CommunicationIdentity => ({
  userId: userId(""),
  channel: "whatsapp",
  externalId
});

const seconds = (value: BaileysMessageShape["messageTimestamp"]): number => {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value.toNumber === "function") return value.toNumber();
  return Math.floor(Date.now() / 1000);
};

const extractText = (message: BaileysMessageShape["message"]): string | undefined => {
  if (!message) return undefined;
  if (typeof message.conversation === "string") return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  return undefined;
};

const extractActionId = (message: BaileysMessageShape["message"]): string | undefined => {
  if (!message) return undefined;
  if (message.buttonsResponseMessage?.selectedButtonId) return message.buttonsResponseMessage.selectedButtonId;
  if (message.listResponseMessage?.singleSelectReply?.selectedRowId) return message.listResponseMessage.singleSelectReply.selectedRowId;
  if (message.templateButtonReplyMessage?.selectedId) return message.templateButtonReplyMessage.selectedId;
  return undefined;
};

const asSize = (value: number | bigint | undefined): number | undefined =>
  value === undefined ? undefined : Number(value);

const extractMedia = (message: BaileysMessageShape): MediaPayload | undefined => {
  const payload = message.message;
  const channelRef = message.key?.id;
  if (!payload || !channelRef) return undefined;
  if (payload.imageMessage) {
    return { kind: "image", channelRef, mimeType: payload.imageMessage.mimetype, sizeBytes: asSize(payload.imageMessage.fileLength) };
  }
  if (payload.videoMessage) {
    return { kind: "video", channelRef, mimeType: payload.videoMessage.mimetype, durationSec: payload.videoMessage.seconds, sizeBytes: asSize(payload.videoMessage.fileLength) };
  }
  if (payload.audioMessage) {
    const kind = payload.audioMessage.ptt ? "voice" : "audio";
    return { kind, channelRef, mimeType: payload.audioMessage.mimetype, durationSec: payload.audioMessage.seconds, sizeBytes: asSize(payload.audioMessage.fileLength) };
  }
  if (payload.documentMessage) {
    return { kind: "document", channelRef, mimeType: payload.documentMessage.mimetype, filename: payload.documentMessage.fileName, sizeBytes: asSize(payload.documentMessage.fileLength) };
  }
  if (payload.stickerMessage) {
    return { kind: "sticker", channelRef, mimeType: "image/webp", sizeBytes: asSize(payload.stickerMessage.fileLength) };
  }
  return undefined;
};

export const mapBaileysInbound = (raw: unknown): InboundEvent | undefined => {
  const message = raw as BaileysMessageShape;
  if (!message?.key?.remoteJid || !message.key.id) return undefined;
  if (message.key.remoteJid.endsWith("@g.us") || message.key.remoteJid === "status@broadcast") return undefined;
  if (message.key.fromMe) return undefined;

  const channel: ChannelType = "whatsapp";
  const identity = identityFor(message.key.remoteJid);
  const timestamp = new Date(seconds(message.messageTimestamp) * 1000);

  const actionId = extractActionId(message.message);
  if (actionId) return { kind: "action", channel, identity, actionId, timestamp };

  const media = extractMedia(message);
  if (media) {
    return {
      kind: "message",
      channel,
      identity,
      externalMessageId: message.key.id,
      content: { kind: "media", media },
      timestamp
    };
  }

  const text = extractText(message.message);
  if (text === undefined) return undefined;

  const command = COMMANDS[text.trim().toLowerCase()];
  if (command) return { kind: "command", channel, identity, command, timestamp };

  return { kind: "message", channel, identity, externalMessageId: message.key.id, content: { kind: "text", text }, timestamp };
};
