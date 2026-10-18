import type { ChannelCapabilities, ChannelDriver, ChannelRecipient, InboundEvent, OutboundMessage } from "../../ports/channels.js";

export class FakeChannelDriver implements ChannelDriver {
  readonly capabilities: ChannelCapabilities = { text: true, buttons: true, menus: true, menuLayouts: ["rows", "grid"], messageEditing: false, messageDeletion: true, typingIndicator: false, media: [], payments: [], deepLinks: false };
  readonly sent: { recipient: ChannelRecipient; message: OutboundMessage }[] = [];
  readonly deleted: { recipient: ChannelRecipient; messageId: string }[] = [];
  private receiver?: (event: InboundEvent) => Promise<void>;
  constructor(readonly type = "fake") {}
  async start(receiver: (event: InboundEvent) => Promise<void>) { this.receiver = receiver; }
  async stop() { this.receiver = undefined; }
  async sendMessage(recipient: ChannelRecipient, message: OutboundMessage): Promise<string> {
    this.sent.push({ recipient, message });
    return `fake-message-${this.sent.length}`;
  }
  async deleteMessage(recipient: ChannelRecipient, messageId: string): Promise<void> { this.deleted.push({ recipient, messageId }); }
  async emit(event: InboundEvent) { if (!this.receiver) throw new Error("Driver was not started"); await this.receiver(event); }
}
