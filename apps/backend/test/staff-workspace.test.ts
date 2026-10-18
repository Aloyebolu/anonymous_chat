import { describe, expect, it } from "vitest";
import { ChatApplication } from "../src/application/chat-application.js";
import { MatchmakingService } from "../src/application/matchmaking.js";
import { conversationId } from "../src/domain/types.js";
import { FakeChannelDriver } from "../src/infrastructure/channels/fake-channel-driver.js";
import {
  InMemoryConversationRepository,
  InMemoryMatchQueueRepository,
  InMemoryUserRepository
} from "../src/infrastructure/persistence/in-memory-repositories.js";
import { ChannelRegistry } from "../src/ports/channels.js";

describe("staff multi-session routing", () => {
  it("directs channel replies to the web workspace when multiple sessions are active", async () => {
    const users = new InMemoryUserRepository();
    const conversations = new InMemoryConversationRepository();
    const staff = await users.findOrCreate({ channel: "fake", externalId: "moderator" });
    const first = await users.findOrCreate({ channel: "fake", externalId: "participant-1" });
    const second = await users.findOrCreate({ channel: "fake", externalId: "participant-2" });
    await users.saveProfile({
      userId: staff.userId,
      gender: "nonbinary",
      country: "NG",
      preferredGender: "any",
      moderator: true
    });

    for (const [index, participant] of [first, second].entries()) {
      await conversations.save({
        id: conversationId(`support-${index}`),
        participants: [
          { userId: staff.userId, identity: staff },
          { userId: participant.userId, identity: participant }
        ],
        status: "active",
        createdAt: new Date(),
        kind: "operator"
      });
    }

    const channels = new ChannelRegistry();
    const fakeChannel = new FakeChannelDriver();
    channels.register(fakeChannel);
    const app = new ChatApplication(
      users,
      conversations,
      channels,
      new MatchmakingService(users, new InMemoryMatchQueueRepository(), conversations),
      { inspect: () => ({ blocked: false }) },
      { reply: async () => "" },
      { all: async () => [] },
      { append: () => undefined, entriesFor: () => [], watch: () => undefined, unwatch: () => undefined },
      undefined,
      undefined,
      undefined,
      "https://chat.example.com/moderator"
    );

    await app.receive({
      kind: "message",
      channel: "fake",
      identity: staff,
      externalMessageId: "staff-reply",
      content: { kind: "text", text: "Hello" },
      timestamp: new Date()
    });

    expect(fakeChannel.sent).toHaveLength(1);
    expect(fakeChannel.sent[0].recipient.externalId).toBe(staff.externalId);
    expect(fakeChannel.sent[0].message).toMatchObject({
      kind: "text",
      text: expect.stringContaining("https://chat.example.com/moderator/sessions")
    });
  });
});
