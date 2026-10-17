import { userId, type ChannelType, type CommunicationIdentity } from "../../../domain/types.js";
import type { InboundEvent } from "../../../ports/channels.js";

type Command = "start" | "find" | "next" | "leave" | "report" | "block" | "help" | "points" | "vip" | "end" | "app";

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
  "/app": "app"
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

export const mapBaileysInbound = (raw: unknown): InboundEvent | undefined => {
  const message = raw as BaileysMessageShape;
  if (!message?.key?.remoteJid || !message.key.id) return undefined;
  if (message.key.fromMe) return undefined;

  const channel: ChannelType = "whatsapp";
  const identity = identityFor(message.key.remoteJid);
  const timestamp = new Date(seconds(message.messageTimestamp) * 1000);

  const actionId = extractActionId(message.message);
  if (actionId) return { kind: "action", channel, identity, actionId, timestamp };

  const text = extractText(message.message);
  if (text === undefined) return undefined;

  const command = COMMANDS[text.trim().toLowerCase()];
  if (command) return { kind: "command", channel, identity, command, timestamp };

  return { kind: "message", channel, identity, externalMessageId: message.key.id, content: { kind: "text", text }, timestamp };
};
