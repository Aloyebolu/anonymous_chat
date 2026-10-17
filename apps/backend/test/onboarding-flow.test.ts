import { describe, expect, it } from "vitest";
import { ChatApplication } from "../src/application/chat-application.js";
import { MatchmakingService } from "../src/application/matchmaking.js";
import { FakeChannelDriver } from "../src/infrastructure/channels/fake-channel-driver.js";
import { InMemoryConversationRepository, InMemoryMatchQueueRepository, InMemoryUserRepository } from "../src/infrastructure/persistence/in-memory-repositories.js";
import { ChannelRegistry } from "../src/ports/channels.js";

const setup = async () => {
  const users = new InMemoryUserRepository();
  const conversations = new InMemoryConversationRepository();
  const queue = new InMemoryMatchQueueRepository();
  const registry = new ChannelRegistry();
  const channel = new FakeChannelDriver();
  registry.register(channel);
  const matching = new MatchmakingService(users, queue, conversations);
  const app = new ChatApplication(users, conversations, registry, matching);
  await channel.start((event) => app.receive(event));
  return { users, conversations, queue, channel, app };
};

describe("onboarding is triggered automatically", () => {
  it("starts the adult confirmation on a plain first message", async () => {
    const { channel, users } = await setup();
    const identity = await users.findOrCreate({ channel: "fake", externalId: "alice" });
    await channel.emit({ kind: "message", channel: "fake", identity, externalMessageId: "m1", content: { kind: "text", text: "hi" }, timestamp: new Date() });
    const last = channel.sent.at(-1)!;
    expect(last.message.kind).toBe("interaction");
    if (last.message.kind === "interaction") {
      expect(last.message.actions[0].id).toBe("confirm-adult");
    }
  });

  it("does not reject /find before eligibility — it prompts to onboard", async () => {
    const { channel, users } = await setup();
    const identity = await users.findOrCreate({ channel: "fake", externalId: "alice" });
    await channel.emit({ kind: "command", channel: "fake", identity, command: "find", timestamp: new Date() });
    const last = channel.sent.at(-1)!;
    expect(last.message.kind).toBe("interaction");
    if (last.message.kind === "interaction") {
      expect(last.message.actions[0].id).toBe("confirm-adult");
    }
  });

  it("walks a new user from a plain hello to a complete profile", async () => {
    const { channel, users, app } = await setup();
    const identity = await users.findOrCreate({ channel: "fake", externalId: "alice" });

    await channel.emit({ kind: "message", channel: "fake", identity, externalMessageId: "m1", content: { kind: "text", text: "hello" }, timestamp: new Date() });
    await channel.emit({ kind: "action", channel: "fake", identity, actionId: "confirm-adult", timestamp: new Date() });
    await channel.emit({ kind: "action", channel: "fake", identity, actionId: "gender:female", timestamp: new Date() });
    await channel.emit({ kind: "message", channel: "fake", identity, externalMessageId: "m2", content: { kind: "text", text: "Nigeria" }, timestamp: new Date() });
    await channel.emit({ kind: "action", channel: "fake", identity, actionId: "preference:any", timestamp: new Date() });

    const profile = await users.profileFor(identity.userId);
    expect(profile).toBeDefined();
    expect(profile?.gender).toBe("female");
    expect(profile?.country).toBe("Nigeria");
    expect(profile?.preferredGender).toBe("any");
    void app;
  });
});