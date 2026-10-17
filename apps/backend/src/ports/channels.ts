import type { ChannelType, CommunicationIdentity } from "../domain/types.js";

// ─── Currencies ──────────────────────────────────────────────────────────────

/**
 * "XTR" is Telegram Stars. Any ISO-4217 code (USD, EUR, …) is routed through
 * the channel's external payment provider (e.g. Stripe via providerToken).
 */
export type Currency = "XTR" | "USD" | "EUR" | "GBP" | "NGN";

// ─── Capabilities ────────────────────────────────────────────────────────────

export type MenuLayout = "rows" | "grid" | "list";
export type MediaKind =
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "document"
  | "sticker"
  | "location";

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

// ─── Recipients ──────────────────────────────────────────────────────────────

export interface ChannelRecipient {
  readonly channel: ChannelType;
  readonly externalId: string;
}

// ─── Content ─────────────────────────────────────────────────────────────────

export interface MediaPayload {
  readonly kind: MediaKind;
  /** Remote URL, if the media is already hosted. */
  readonly url?: string;
  /** Raw bytes, if the caller has them in memory. */
  readonly bytes?: Uint8Array;
  readonly mimeType?: string;
  readonly filename?: string;
  readonly durationSec?: number;
}

export type MessageContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "media"; readonly media: MediaPayload; readonly caption?: string };

// ─── Outbound ────────────────────────────────────────────────────────────────

/**
 * A single button / menu entry. If `url` is set, the channel renders an
 * external link button; otherwise it renders a callback button whose `id`
 * will come back as an "action" inbound event.
 */
export interface OutboundAction {
  readonly id: string;
  readonly label: string;
  readonly url?: string;
}

export interface OutboundText {
  readonly kind: "text";
  readonly text: string;
  readonly silent?: boolean;
}

export interface OutboundInteraction {
  readonly kind: "interaction";
  readonly text: string;
  readonly actions: readonly OutboundAction[];
  /** Layout hint — channel falls back to the first layout it supports. */
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
  /** Opaque identifier echoed back on payment — your internal SKU / order id. */
  readonly payload: string;
  readonly currency: Currency;
  readonly prices: readonly { readonly label: string; readonly amount: number }[];
  /** Required for non-XTR currencies. Ignored for Telegram Stars. */
  readonly providerToken?: string;
}

export type OutboundMessage =
  | OutboundText
  | OutboundInteraction
  | OutboundMedia
  | OutboundInvoice;

// ─── Inbound ─────────────────────────────────────────────────────────────────

export interface PaymentReceipt {
  readonly provider: "telegram_stars" | "stripe" | "external";
  readonly payload: string;
  readonly amount: number;
  readonly currency: Currency;
  readonly externalChargeId: string;
  /** Channel-specific raw payload, kept for auditing / debugging. */
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

// ─── Driver ──────────────────────────────────────────────────────────────────

export interface ChannelDriver {
  readonly type: ChannelType;
  readonly capabilities: ChannelCapabilities;

  start(onEvent: (event: InboundEvent) => Promise<void>): Promise<void>;
  stop(): Promise<void>;

  sendMessage(recipient: ChannelRecipient, message: OutboundMessage): Promise<void>;

  /** Optional — implementations advertise via `capabilities.typingIndicator`. */
  sendTyping?(recipient: ChannelRecipient): Promise<void>;

  /** Optional — implementations advertise via `capabilities.messageEditing`. */
  editMessage?(
    recipient: ChannelRecipient,
    externalMessageId: string,
    message: OutboundMessage
  ): Promise<void>;

  /** Optional — implementations advertise via `capabilities.messageDeletion`. */
  deleteMessage?(recipient: ChannelRecipient, externalMessageId: string): Promise<void>;

  /** Optional — implementations advertise via `capabilities.deepLinks`. */
  buildDeepLink?(payload: string): string;

   /**
   * Convert a channel-specific media reference (e.g. a Telegram file_id)
   * into a portable payload with `url` or `bytes` set. Called by the app
   * before forwarding media to a driver on a different channel.
   *
   * If the driver can't resolve, return the input unchanged — the app will
   * then fail the send gracefully with a user-facing message.
   */
  resolveMedia?(media: MediaPayload): Promise<MediaPayload>;
}

// ─── Registry ────────────────────────────────────────────────────────────────

export class ChannelRegistry {
  private readonly drivers = new Map<ChannelType, ChannelDriver>();

  register(driver: ChannelDriver): void {
    if (this.drivers.has(driver.type)) {
      throw new Error(`Channel already registered: ${driver.type}`);
    }
    this.drivers.set(driver.type, driver);
  }

  driverFor(channel: ChannelType): ChannelDriver {
    const driver = this.drivers.get(channel);
    if (!driver) throw new Error(`No driver registered for channel: ${channel}`);
    return driver;
  }

  all(): readonly ChannelDriver[] {
    return [...this.drivers.values()];
  }
}


export interface MediaPayload {
  readonly kind: MediaKind;
  /** Opaque, channel-specific handle (Telegram file_id, WhatsApp mediaKey, …). */
  readonly channelRef?: string;
  /** Remote URL, if the media is already hosted. */
  readonly url?: string;
  /** Raw bytes, if the caller has them in memory. */
  readonly bytes?: Uint8Array;
  readonly mimeType?: string;
  readonly filename?: string;
  readonly durationSec?: number;
  /** Telegram only — file size in bytes, useful for quota checks. */
  readonly sizeBytes?: number;
}
