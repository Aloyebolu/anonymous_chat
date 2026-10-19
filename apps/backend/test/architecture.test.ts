import { describe, expect, it } from "vitest";
import { ChatApplication } from "../src/application/chat-application.js";
import { MatchmakingService } from "../src/application/matchmaking.js";
import { type CommunicationIdentity } from "../src/domain/types.js";
import { FakeChannelDriver } from "../src/infrastructure/channels/fake-channel-driver.js";
import { InMemoryConversationRepository, InMemoryMatchQueueRepository, InMemoryUserRepository } from "../src/infrastructure/persistence/in-memory-repositories.js";
import { InMemoryMessageLogRepository } from "../src/infrastructure/persistence/in-memory-message-log.js";
import { ChannelRegistry } from "../src/ports/channels.js";

describe("channel-independent vertical slice", () => {
  it("matches compatible internal users and relays a generic inbound message through a fake driver", async () => {
    const users = new InMemoryUserRepository(); const queue = new InMemoryMatchQueueRepository(); const conversations = new InMemoryConversationRepository();
    const registry = new ChannelRegistry(); const channel = new FakeChannelDriver(); registry.register(channel);
    const matching = new MatchmakingService(users, queue, conversations);
    const app = new ChatApplication(
      users,
      conversations,
      registry,
      matching,
      { inspect: () => ({ blocked: false }) },
      { reply: async () => "" },
      { save: async () => undefined, all: async () => [] },
      new InMemoryMessageLogRepository()
    );
    await channel.start((event) => app.receive(event));
    const a = await users.findOrCreate({ channel: "fake", externalId: "a" }); const b = await users.findOrCreate({ channel: "fake", externalId: "b" });
    for (const identity of [a, b]) { await app.receive({ kind: "command", channel: "fake", identity, command: "confirm-adult", timestamp: new Date() }); }
    await app.setProfile(a, { gender: "male", country: "NG", preferredGender: "female" }); await app.setProfile(b, { gender: "female", country: "NG", preferredGender: "male" });
    await app.receive({ kind: "command", channel: "fake", identity: a, command: "find", timestamp: new Date() }); await app.receive({ kind: "command", channel: "fake", identity: b, command: "find", timestamp: new Date() });
    await channel.emit({ kind: "message", channel: "fake", identity: a, externalMessageId: "m1", content: { kind: "text", text: "hello" }, timestamp: new Date() });
    expect(channel.sent.some((sent) => sent.recipient.externalId === "b" && sent.message.kind === "text" && sent.message.text === "hello")).toBe(true);

    const forwarded = channel.sent.find((sent) =>
      sent.recipient.externalId === "b" && sent.message.kind === "text" && sent.message.sourceMessageId === "m1"
    );
    expect(forwarded).toBeDefined();
    const forwardedId = `fake-message-${channel.sent.indexOf(forwarded!) + 1}`;

    await channel.emit({
      kind: "edit",
      channel: "fake",
      identity: a,
      targetMessageId: "m1",
      text: "<b>updated</b>",
      timestamp: new Date()
    });
    expect(channel.edited.at(-1)).toMatchObject({
      recipient: { externalId: "b" },
      messageId: forwardedId,
      message: { kind: "text", text: "&lt;b&gt;updated&lt;/b&gt;" }
    });

    await channel.emit({
      kind: "message",
      channel: "fake",
      identity: b,
      externalMessageId: "reply-1",
      content: { kind: "text", text: "reply", replyToMessageId: forwardedId },
      timestamp: new Date()
    });
    const reply = channel.sent.find((sent) =>
      sent.recipient.externalId === "a" && sent.message.kind === "text" && sent.message.sourceMessageId === "reply-1"
    );
    expect(reply?.message.kind === "text" && reply.message.replyToMessageId).toBe("m1");

    await channel.emit({
      kind: "reaction",
      channel: "fake",
      identity: b,
      targetMessageId: forwardedId,
      emoji: "👍",
      timestamp: new Date()
    });
    expect(channel.reacted.at(-1)).toMatchObject({
      recipient: { channel: "fake", externalId: "a" },
      messageId: "m1",
      emoji: "👍"
    });
  });

  it("does not allow an unverified user into the matching pool", async () => {
    const users = new InMemoryUserRepository(); const service = new MatchmakingService(users, new InMemoryMatchQueueRepository(), new InMemoryConversationRepository()); const identity = await users.findOrCreate({ channel: "fake", externalId: "minor" });
    await users.saveProfile({ userId: identity.userId, gender: "male", country: "NG", preferredGender: "any" });
    await expect(service.join(identity.userId)).rejects.toThrow("Adult eligibility");
  });

  it("routes web replies, edits, and reactions to the correct channel message", async () => {
    const users = new InMemoryUserRepository();
    const conversations = new InMemoryConversationRepository();
    const queue = new InMemoryMatchQueueRepository();
    const registry = new ChannelRegistry();
    const web = new FakeChannelDriver("web");
    const telegram = new FakeChannelDriver("telegram");
    registry.register(web);
    registry.register(telegram);
    const app = new ChatApplication(
      users,
      conversations,
      registry,
      new MatchmakingService(users, queue, conversations),
      { inspect: () => ({ blocked: false }) },
      { reply: async () => "" },
      { save: async () => undefined, all: async () => [] },
      new InMemoryMessageLogRepository()
    );
    const first = await users.findOrCreate({ channel: "web", externalId: "webuser" });
    const second = await users.findOrCreate({ channel: "telegram", externalId: "telegramuser" });
    for (const identity of [first, second]) {
      await app.receive({ kind: "command", channel: identity.channel, identity, command: "confirm-adult", timestamp: new Date() });
    }
    await app.setProfile(first, { gender: "male", country: "NG", preferredGender: "female" });
    await app.setProfile(second, { gender: "female", country: "NG", preferredGender: "male" });
    await app.receive({ kind: "command", channel: first.channel, identity: first, command: "find", timestamp: new Date() });
    await app.receive({ kind: "command", channel: second.channel, identity: second, command: "find", timestamp: new Date() });

    await app.receive({
      kind: "message",
      channel: "web",
      identity: first,
      externalMessageId: "web-message",
      content: { kind: "text", text: "hello" },
      timestamp: new Date()
    });
    const forwarded = telegram.sent.find((sent) =>
      sent.recipient.externalId === "telegramuser" && sent.message.kind === "text" && sent.message.sourceMessageId === "web-message"
    );
    expect(forwarded).toBeDefined();
    const forwardedId = `fake-message-${telegram.sent.indexOf(forwarded!) + 1}`;
    await app.receive({
      kind: "message",
      channel: "telegram",
      identity: second,
      externalMessageId: "telegram-reply",
      content: { kind: "text", text: "reply", replyToMessageId: forwardedId },
      timestamp: new Date()
    });
    const reply = web.sent.find((sent) =>
      sent.recipient.externalId === "webuser" && sent.message.kind === "text" && sent.message.sourceMessageId === "telegram-reply"
    );
    expect(reply?.message.kind === "text" && reply.message.replyToMessageId).toBe("web-message");

    await app.editWebMessage("webuser", "web-message", "<b>updated</b>");
    const edited = telegram.edited.at(-1);
    expect(edited?.messageId).toBe(forwardedId);
    expect(edited?.message.kind === "text" && edited.message.text).toBe("&lt;b&gt;updated&lt;/b&gt;");

    const telegramMessage = web.sent.find((sent) =>
      sent.recipient.externalId === "webuser" && sent.message.kind === "text" && sent.message.sourceMessageId === "telegram-reply"
    );
    expect(telegramMessage).toBeDefined();
    const webMessageId = `fake-message-${web.sent.indexOf(telegramMessage!) + 1}`;
    await app.reactWebMessage("webuser", webMessageId, "👍");
    expect(telegram.reacted.at(-1)).toMatchObject({ messageId: "telegram-reply", emoji: "👍" });
  });
});
