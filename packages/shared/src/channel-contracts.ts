import type { ChannelType, CommunicationIdentity } from "./domain.js";

export type Currency = "XTR" | "USD" | "EUR" | "GBP" | "NGN";
export type MenuLayout = "rows" | "grid" | "list";
export type MediaKind = "image" | "video" | "audio" | "voice" | "document" | "sticker" | "location";

export interface ChannelCapabilities {
  readonly text: boolean;
  readonly buttons: boolean;
  readonly menus: boolean;
  readonly menuLayouts: readonly MenuLayout[];
  readonly messageEditing: boolean;
  readonly messageDeletion: boolean;
  readonly typingIndicator: boolean;
  readonly media: readonly MediaKind[];
  readonly payments: readonly Currency[];
  readonly deepLinks: boolean;
}

export interface ChannelRecipient {
  readonly channel: ChannelType;
  readonly externalId: string;
}

export interface MediaPayload {
  readonly kind: MediaKind;
  readonly channelRef?: string;
  readonly url?: string;
  readonly bytes?: Uint8Array;
  readonly mimeType?: string;
  readonly filename?: string;
  readonly durationSec?: number;
  readonly sizeBytes?: number;
}

export type MessageContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "media"; readonly media: MediaPayload; readonly caption?: string };

export interface OutboundAction {
  readonly id: string;
  readonly label: string;
  readonly url?: string;
}

export interface OutboundText {
  readonly kind: "text";
  readonly text: string;
  readonly format?: "html";
  readonly silent?: boolean;
}

export interface OutboundInteraction {
  readonly kind: "interaction";
  readonly text: string;
  readonly actions: readonly OutboundAction[];
  readonly format?: "html";
  readonly layout?: MenuLayout;
  readonly silent?: boolean;
}

export interface OutboundMedia {
  readonly kind: "media";
  readonly media: MediaPayload;
  readonly caption?: string;
  readonly silent?: boolean;
}

export interface OutboundInvoice {
  readonly kind: "invoice";
  readonly title: string;
  readonly description: string;
  readonly payload: string;
  readonly currency: Currency;
  readonly prices: readonly { readonly label: string; readonly amount: number }[];
  readonly providerToken?: string;
}

export type OutboundMessage = OutboundText | OutboundInteraction | OutboundMedia | OutboundInvoice;

export interface PaymentReceipt {
  readonly provider: "telegram_stars" | "stripe" | "external";
  readonly payload: string;
  readonly amount: number;
  readonly currency: Currency;
  readonly externalChargeId: string;
  readonly raw?: unknown;
}

export type Command =
  | "start"
  | "confirm-adult"
  | "find"
  | "next"
  | "leave"
  | "report"
  | "block"
  | "help"
  | "points"
  | "vip"
  | "end"
  | "app";

export type InboundEvent =
  | {
      readonly kind: "message";
      readonly channel: ChannelType;
      readonly identity: CommunicationIdentity;
      readonly externalMessageId: string;
      readonly content: MessageContent;
      readonly timestamp: Date;
    }
  | {
      readonly kind: "command";
      readonly channel: ChannelType;
      readonly identity: CommunicationIdentity;
      readonly command: Command;
      readonly timestamp: Date;
    }
  | {
      readonly kind: "action";
      readonly channel: ChannelType;
      readonly identity: CommunicationIdentity;
      readonly actionId: string;
      readonly timestamp: Date;
    }
  | {
      readonly kind: "payment";
      readonly channel: ChannelType;
      readonly identity: CommunicationIdentity;
      readonly receipt: PaymentReceipt;
      readonly timestamp: Date;
    };
