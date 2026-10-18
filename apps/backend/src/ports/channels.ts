import type { ChannelType } from "../domain/types.js";
import type {
  ChannelCapabilities,
  ChannelRecipient,
  InboundEvent,
  MediaPayload,
  OutboundMessage
} from "@anonymous-chat/shared/channel-contracts";

export type {
  ChannelCapabilities,
  ChannelRecipient,
  Command,
  Currency,
  InboundEvent,
  MediaKind,
  MediaPayload,
  MenuLayout,
  MessageContent,
  OutboundAction,
  OutboundMessage,
  PaymentReceipt
} from "@anonymous-chat/shared/channel-contracts";
export type { OutboundInvoice, OutboundInteraction, OutboundMedia, OutboundText } from "@anonymous-chat/shared/channel-contracts";

export interface ChannelDriver {
  readonly type: ChannelType;
  readonly capabilities: ChannelCapabilities;

  start(onEvent: (event: InboundEvent) => Promise<void>): Promise<void>;
  stop(): Promise<void>;

  sendMessage(recipient: ChannelRecipient, message: OutboundMessage): Promise<void>;
  sendTyping?(recipient: ChannelRecipient): Promise<void>;
  editMessage?(recipient: ChannelRecipient, externalMessageId: string, message: OutboundMessage): Promise<void>;
  deleteMessage?(recipient: ChannelRecipient, externalMessageId: string): Promise<void>;
  buildDeepLink?(payload: string): string;
  resolveMedia?(media: MediaPayload): Promise<MediaPayload>;
}

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
