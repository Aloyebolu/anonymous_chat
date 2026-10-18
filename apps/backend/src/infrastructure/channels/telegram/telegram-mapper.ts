import { userId, type ChannelType, type CommunicationIdentity } from "../../../domain/types.js";
import type { InboundEvent } from "../../../ports/channels.js";
import { extractMedia } from "../../../utils/extractMedia.js";

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

export interface TelegramUpdateShape {
  readonly message?: {
    readonly message_id?: number;
    readonly from?: { readonly id?: number; readonly is_bot?: boolean };
    readonly chat?: { readonly id?: number };
    readonly date?: number;
    readonly text?: string;
    // ─── media ───
    readonly photo?: readonly { readonly file_id: string; readonly file_size?: number }[];
    readonly video?: { readonly file_id: string; readonly mime_type?: string; readonly file_size?: number; readonly duration?: number };
    readonly voice?: { readonly file_id: string; readonly mime_type?: string; readonly file_size?: number; readonly duration?: number };
    readonly audio?: { readonly file_id: string; readonly mime_type?: string; readonly file_size?: number; readonly duration?: number; readonly file_name?: string };
    readonly document?: { readonly file_id: string; readonly mime_type?: string; readonly file_size?: number; readonly file_name?: string };
    readonly sticker?: { readonly file_id: string; readonly is_animated?: boolean; readonly is_video?: boolean };
    readonly animation?: { readonly file_id: string; readonly mime_type?: string; readonly file_size?: number; readonly duration?: number; readonly file_name?: string };
  };
  readonly callback_query?: {
    readonly id?: string;
    readonly data?: string;
    readonly from?: { readonly id?: number; readonly is_bot?: boolean };
    readonly message?: { readonly chat?: { readonly id?: number }; readonly date?: number };
  };
}

const identityFor = (externalId: string): CommunicationIdentity => ({
  userId: userId(""),
  channel: "telegram",
  externalId
});

const seconds = (value: number | undefined): number =>
  typeof value === "number" ? value : Math.floor(Date.now() / 1000);

/**
 * Telegram commands may be sent as `/start` or `/start@MyBotName`.
 * Only the first token is the command; anything after is arguments.
 */
const parseCommand = (text: string): Command | undefined => {
  const firstToken = text.trim().toLowerCase().split(/\s+/)[0] ?? "";
  const withoutMention = firstToken.replace(/@[a-z0-9_]+$/i, "");
  return COMMANDS[withoutMention];
};

export const mapTelegramInbound = (raw: unknown): InboundEvent | undefined => {
  const update = raw as TelegramUpdateShape;
  const channel: ChannelType = "telegram";

  const callback = update.callback_query;
  if (callback?.data && callback.message?.chat?.id && !callback.from?.is_bot) {
    return {
      kind: "action", channel,
      identity: identityFor(String(callback.message.chat.id)),
      actionId: callback.data,
      timestamp: new Date(seconds(callback.message.date) * 1000)
    };
  }

  const message = update.message;
  if (!message?.chat?.id) return undefined;
  if (message.from?.is_bot) return undefined;

  const identity = identityFor(String(message.chat.id));
  const timestamp = new Date(seconds(message.date) * 1000);
  const externalMessageId = message.message_id !== undefined ? String(message.message_id) : "";

  // Text first (commands and plain text).
  if (message.text !== undefined) {
    const command = parseCommand(message.text);
    if (command) return { kind: "command", channel, identity, command, timestamp };
    return {
      kind: "message",
      channel,
      identity,
      externalMessageId,
      content: { kind: "text", text: message.text },
      timestamp
    };
  }

  // Then media.
  const media = extractMedia(message);
  if (media) {
    return {
      kind: "message",
      channel,
      identity,
      externalMessageId,
      content: { kind: "media", media },
      timestamp
    };
  }

  return undefined; // stickers without file_id, polls, etc.
};
