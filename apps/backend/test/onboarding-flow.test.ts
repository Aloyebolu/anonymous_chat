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

  it("lets a completed user update profile settings while in chat", async () => {
    const { channel, users } = await setup();
    const identity = await users.findOrCreate({ channel: "fake", externalId: "alice" });
    await users.saveEligibility({
      userId: identity.userId,
      status: "eligible",
      method: "self-declared-18-plus",
      verifiedAt: new Date()
    });
    await users.saveProfile({
      userId: identity.userId,
      gender: "female",
      country: "Nigeria",
      preferredGender: "any"
    });

    await channel.emit({ kind: "command", channel: "fake", identity, command: "settings", timestamp: new Date() });
    expect(channel.sent.at(-1)?.message.kind).toBe("interaction");
    await channel.emit({ kind: "action", channel: "fake", identity, actionId: "settings:displayName", timestamp: new Date() });
    await channel.emit({ kind: "message", channel: "fake", identity, externalMessageId: "m1", content: { kind: "text", text: "A & B" }, timestamp: new Date() });
    await channel.emit({ kind: "action", channel: "fake", identity, actionId: "settings:age", timestamp: new Date() });
    await channel.emit({ kind: "message", channel: "fake", identity, externalMessageId: "m2", content: { kind: "text", text: "27" }, timestamp: new Date() });

    expect(await users.profileFor(identity.userId)).toMatchObject({
      displayName: "A & B",
      age: 27,
      country: "Nigeria"
    });
  });

  it("requires VIP to change gender in chat settings", async () => {
    const { channel, users } = await setup();
    const identity = await users.findOrCreate({ channel: "fake", externalId: "alice" });
    await users.saveEligibility({
      userId: identity.userId,
      status: "eligible",
      method: "self-declared-18-plus",
      verifiedAt: new Date()
    });
    await users.saveProfile({
      userId: identity.userId,
      gender: "female",
      country: "Nigeria",
      preferredGender: "any"
    });

    await channel.emit({ kind: "command", channel: "fake", identity, command: "settings", timestamp: new Date() });
    await channel.emit({ kind: "action", channel: "fake", identity, actionId: "settings:gender", timestamp: new Date() });

    expect(await users.profileFor(identity.userId)).toMatchObject({ gender: "female" });
    expect(channel.sent.at(-1)?.message).toMatchObject({ kind: "text", text: expect.stringContaining("VIP feature") });
  });
});