import { describe, expect, it } from "vitest";
import { TelegramChannelDriver, type TelegramBotBridge } from "../src/infrastructure/channels/telegram/telegram-channel-driver.js";

class FakeTelegramBridge implements TelegramBotBridge {
  readonly sent: { text: string; format?: "html" }[] = [];
  async connect(): Promise<void> {}
  onMessage(): void {}
  async sendText(_chatId: string, text: string, format?: "html"): Promise<void> {
    this.sent.push({ text, format });
  }
  async sendButtons(_chatId: string, text: string, _actions: readonly { id: string; label: string }[], format?: "html"): Promise<void> {
    this.sent.push({ text, format });
  }
  async close(): Promise<void> {}
}

describe("Telegram rich text", () => {
  it("sends HTML text with Telegram HTML formatting enabled", async () => {
    const bridge = new FakeTelegramBridge();
    const driver = new TelegramChannelDriver(bridge, () => undefined);

    await driver.sendMessage(
      { channel: "telegram", externalId: "123" },
      { kind: "text", text: "<b>Hello</b>", format: "html" }
    );

    expect(bridge.sent).toEqual([{ text: "<b>Hello</b>", format: "html" }]);
  });

  it("preserves HTML formatting for interaction prompts", async () => {
    const bridge = new FakeTelegramBridge();
    const driver = new TelegramChannelDriver(bridge, () => undefined);

    await driver.sendMessage(
      { channel: "telegram", externalId: "123" },
      { kind: "interaction", text: "<b>Choose</b>", format: "html", actions: [{ id: "one", label: "One" }] }
    );

    expect(bridge.sent[0]).toEqual({ text: "<b>Choose</b>", format: "html" });
  });
});
