import { describe, expect, it } from "vitest";
import { ChatApplication } from "../src/application/chat-application.js";
import { MatchmakingService } from "../src/application/matchmaking.js";
import { type CommunicationIdentity } from "../src/domain/types.js";
import { FakeChannelDriver } from "../src/infrastructure/channels/fake-channel-driver.js";
import { InMemoryConversationRepository, InMemoryMatchQueueRepository, InMemoryUserRepository } from "../src/infrastructure/persistence/in-memory-repositories.js";
import { ChannelRegistry } from "../src/ports/channels.js";

describe("channel-independent vertical slice", () => {
  it("matches compatible internal users and relays a generic inbound message through a fake driver", async () => {
    const users = new InMemoryUserRepository(); const queue = new InMemoryMatchQueueRepository(); const conversations = new InMemoryConversationRepository();
    const registry = new ChannelRegistry(); const channel = new FakeChannelDriver(); registry.register(channel);
    const matching = new MatchmakingService(users, queue, conversations); const app = new ChatApplication(users, conversations, registry, matching);
    await channel.start((event) => app.receive(event));
    const a = await users.findOrCreate({ channel: "fake", externalId: "a" }); const b = await users.findOrCreate({ channel: "fake", externalId: "b" });
    for (const identity of [a, b]) { await app.receive({ kind: "command", channel: "fake", identity, command: "confirm-adult", timestamp: new Date() }); }
    await app.setProfile(a, { gender: "male", country: "NG", preferredGender: "female" }); await app.setProfile(b, { gender: "female", country: "NG", preferredGender: "male" });
    await app.receive({ kind: "command", channel: "fake", identity: a, command: "find", timestamp: new Date() }); await app.receive({ kind: "command", channel: "fake", identity: b, command: "find", timestamp: new Date() });
    await channel.emit({ kind: "message", channel: "fake", identity: a, externalMessageId: "m1", content: { kind: "text", text: "hello" }, timestamp: new Date() });
    expect(channel.sent.some((sent) => sent.recipient.externalId === "b" && sent.message.kind === "text" && sent.message.text === "hello")).toBe(true);
  });

  it("does not allow an unverified user into the matching pool", async () => {
    const users = new InMemoryUserRepository(); const service = new MatchmakingService(users, new InMemoryMatchQueueRepository(), new InMemoryConversationRepository()); const identity = await users.findOrCreate({ channel: "fake", externalId: "minor" });
    await users.saveProfile({ userId: identity.userId, gender: "male", country: "NG", preferredGender: "any" });
    await expect(service.join(identity.userId)).rejects.toThrow("Adult eligibility");
  });
});
