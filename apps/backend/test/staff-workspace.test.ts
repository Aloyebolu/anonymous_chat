import { describe, expect, it } from "vitest";
import { ChatApplication } from "../src/application/chat-application.js";
import { MATCHMAKING_CONFIG, MatchmakingService } from "../src/application/matchmaking.js";
import { conversationId } from "../src/domain/types.js";
import { FakeChannelDriver } from "../src/infrastructure/channels/fake-channel-driver.js";
import { InMemoryMessageLogRepository } from "../src/infrastructure/persistence/in-memory-message-log.js";
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
    const log = new InMemoryMessageLogRepository();
    const app = new ChatApplication(
      users,
      conversations,
      channels,
      new MatchmakingService(users, new InMemoryMatchQueueRepository(), conversations),
      { inspect: () => ({ blocked: false }) },
      { reply: async () => "" },
      { all: async () => [] },
      log,
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
    expect(log.entriesFor(conversationId("support-0"))).toHaveLength(0);
  });

  it("starts recording both sides of a newly assigned support session", async () => {
    const users = new InMemoryUserRepository();
    const queue = new InMemoryMatchQueueRepository();
    const conversations = new InMemoryConversationRepository();
    const participant = await users.findOrCreate({ channel: "fake", externalId: "participant" });
    const moderator = await users.findOrCreate({ channel: "fake", externalId: "moderator" });
    await users.saveEligibility({
      userId: participant.userId,
      status: "eligible",
      method: "self-declared-18-plus",
      verifiedAt: new Date()
    });
    await users.saveProfile({
      userId: participant.userId,
      gender: "male",
      country: "NG",
      preferredGender: "any"
    });
    await users.saveProfile({
      userId: moderator.userId,
      gender: "nonbinary",
      country: "NG",
      preferredGender: "any",
      moderator: true,
      moderatorAvailable: true,
      moderatorChannels: ["fake"]
    });
    await queue.enqueue(participant.userId);

    const config = {
      ...MATCHMAKING_CONFIG,
      jitter: 0,
      lowSupplyThreshold: 1,
      aiFallback: { ...MATCHMAKING_CONFIG.aiFallback, baseMs: 0, minMs: 0, maxMs: 0 }
    };
    const matching = new MatchmakingService(users, queue, conversations, config);
    const channels = new ChannelRegistry();
    const fakeChannel = new FakeChannelDriver();
    channels.register(fakeChannel);
    const log = new InMemoryMessageLogRepository();
    const app = new ChatApplication(
      users,
      conversations,
      channels,
      matching,
      { inspect: () => ({ blocked: false }) },
      { reply: async () => "" },
      { save: async () => undefined, all: async () => [] },
      log
    );

    await app.runMatchmakingSweep();
    const [session] = await conversations.all();
    await app.receive({
      kind: "message",
      channel: "fake",
      identity: participant,
      externalMessageId: "participant-message",
      content: { kind: "text", text: "I need some help." },
      timestamp: new Date()
    });

    const messages = log.entriesFor(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("I need some help.");
    expect(messages[0].fromUserId).toBe(participant.userId);

    expect(await app.sendStaffMessage(moderator.userId, session.id, "I can help with that.")).toBe(true);
    const completeHistory = log.entriesFor(session.id);
    expect(completeHistory).toHaveLength(2);
    expect(completeHistory[1].text).toBe("I can help with that.");
    expect(completeHistory[1].fromUserId).toBe(moderator.userId);

    expect(await app.endStaffSession(moderator.userId, session.id)).toBe(true);
    expect((await conversations.byId(session.id))?.status).toBe("ended");
    expect(fakeChannel.sent.at(-1)?.recipient.externalId).toBe(participant.externalId);
  });
});
