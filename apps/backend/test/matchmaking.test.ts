import { afterEach, describe, expect, it, vi } from "vitest";
import { MATCHMAKING_CONFIG, MatchmakingService, type MatchmakingConfig } from "../src/application/matchmaking.js";
import {
  InMemoryConversationRepository,
  InMemoryMatchQueueRepository,
  InMemoryUserRepository
} from "../src/infrastructure/persistence/in-memory-repositories.js";

const testConfig = (overrides: Partial<MatchmakingConfig> = {}): MatchmakingConfig => ({
  ...MATCHMAKING_CONFIG,
  jitter: 0,
  ...overrides
});

const makeUser = async (users: InMemoryUserRepository, externalId: string, profile: { gender: "male" | "female" | "nonbinary"; country: string; preferredGender: "male" | "female" | "nonbinary" | "any"; preferredCountry?: string; priorityTier?: number }) => {
  const identity = await users.findOrCreate({ channel: "fake", externalId });
  await users.saveEligibility({ userId: identity.userId, status: "eligible", method: "self-declared-18-plus", verifiedAt: new Date() });
  await users.saveProfile({ userId: identity.userId, ...profile });
  return identity;
};

const setup = (config: MatchmakingConfig) => {
  const users = new InMemoryUserRepository();
  const queue = new InMemoryMatchQueueRepository();
  const conversations = new InMemoryConversationRepository();
  const service = new MatchmakingService(users, queue, conversations, config);
  return { users, queue, conversations, service };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("matchmaking", () => {
  it("matches a strictly compatible pair on the second join", async () => {
    const { users, service } = setup(testConfig({ lowSupplyThreshold: 4, relaxPreferencesAfterMs: 10 * 60_000 }));
    const alice = await makeUser(users, "alice", { gender: "male", country: "NG", preferredGender: "female" });
    const bob = await makeUser(users, "bob", { gender: "female", country: "NG", preferredGender: "male" });

    const first = await service.join(alice.userId);
    expect(first).toHaveLength(0);

    const second = await service.join(bob.userId);
    expect(second).toHaveLength(1);
    expect(second[0].participants.map((p) => p.userId).sort()).toEqual([alice.userId, bob.userId].sort());
  });

  it("does not force incompatible users together when supply is plentiful and nobody has waited long", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    const { users, service } = setup(testConfig({ lowSupplyThreshold: 3, relaxPreferencesAfterMs: 10 * 60_000 }));

    // Three users: alice wants female, only males are waiting. Everyone strictly incompatible.
    const alice = await makeUser(users, "alice", { gender: "female", country: "NG", preferredGender: "male" });
    const bob = await makeUser(users, "bob", { gender: "female", country: "NG", preferredGender: "male" });
    const carol = await makeUser(users, "carol", { gender: "female", country: "NG", preferredGender: "male" });

    await service.join(alice.userId);
    await service.join(bob.userId);
    const result = await service.join(carol.userId);

    expect(result).toHaveLength(0);
  });

  it("relaxes the preference filter when someone has waited past relaxPreferencesAfterMs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    const { users, service } = setup(testConfig({ lowSupplyThreshold: 3, relaxPreferencesAfterMs: 60_000 }));

    const alice = await makeUser(users, "alice", { gender: "female", country: "NG", preferredGender: "male" });
    const bob = await makeUser(users, "bob", { gender: "female", country: "NG", preferredGender: "male" });

    await service.join(alice.userId);

    // 90 seconds later, bob joins. Alice's wait exceeded the relax threshold.
    vi.setSystemTime(new Date("2025-01-01T00:01:30Z"));
    const result = await service.join(bob.userId);

    expect(result).toHaveLength(1);
  });

  it("relaxes the filter below the low-supply threshold", async () => {
    const { users, service } = setup(testConfig({ lowSupplyThreshold: 10, relaxPreferencesAfterMs: 10 * 60_000 }));

    const alice = await makeUser(users, "alice", { gender: "female", country: "NG", preferredGender: "male" });
    const bob = await makeUser(users, "bob", { gender: "female", country: "NG", preferredGender: "male" });

    await service.join(alice.userId);
    const result = await service.join(bob.userId);

    // Preferences would reject this pair; low supply makes it acceptable.
    expect(result).toHaveLength(1);
  });

  it("prefers high priorityTier users when competing for the same partner", async () => {
    const { users, service } = setup(testConfig({ lowSupplyThreshold: 2, relaxPreferencesAfterMs: 10 * 60_000 }));

    const carol = await makeUser(users, "carol", { gender: "male", country: "NG", preferredGender: "any" });
    const alice = await makeUser(users, "alice", { gender: "female", country: "NG", preferredGender: "male" });
    const bob = await makeUser(users, "bob", { gender: "female", country: "NG", preferredGender: "male", priorityTier: 1 });

    await service.join(carol.userId);
    await service.join(alice.userId);
    const result = await service.join(bob.userId);

    expect(result).toHaveLength(1);
    const [conversation] = result;
    const ids = conversation.participants.map((p) => p.userId).sort();
    expect(ids).toEqual([bob.userId, carol.userId].sort());
    expect(ids).not.toContain(alice.userId);
  });

  it("sweep matches a fresh user against a partner whose wait has passed the relax threshold", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    const { users, service } = setup(testConfig({ lowSupplyThreshold: 3, relaxPreferencesAfterMs: 30_000 }));
    const alice = await makeUser(users, "alice", { gender: "female", country: "NG", preferredGender: "male" });
    await service.join(alice.userId);

    vi.setSystemTime(new Date("2025-01-01T00:00:45Z"));
    const swept = await service.sweep();
    // Only one user, nothing to match.
    expect(swept).toHaveLength(0);

    const bob = await makeUser(users, "bob", { gender: "female", country: "NG", preferredGender: "male" });
    await service.join(bob.userId);
    // alice's wait exceeds the relax threshold → match.
    // Re-check that a second sweep is a no-op.
    expect(await service.sweep()).toHaveLength(0);
  });

  it("waits for human matches before connecting a waiting user to an available moderator", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    const { users, service, queue } = setup(testConfig());
    const user = await makeUser(users, "waiting-user", { gender: "male", country: "NG", preferredGender: "any" });
    const moderator = await users.findOrCreate({ channel: "telegram", externalId: "moderator" });
    await users.saveProfile({
      userId: moderator.userId,
      gender: "female",
      country: "NG",
      preferredGender: "any",
      moderator: true,
      moderatorAvailable: true,
      moderatorChannels: ["telegram"]
    });

    expect(await service.join(user.userId)).toHaveLength(0);
    expect(await queue.entries()).toHaveLength(1);

    vi.advanceTimersByTime(service.aiThresholdMs(1) - 1);
    expect(await service.sweep()).toHaveLength(0);
    expect(await queue.entries()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    const matched = await service.sweep();
    expect(matched).toHaveLength(1);
    expect(matched[0].kind).toBe("operator");
    expect(matched[0].participants.map((participant) => participant.userId)).toContain(moderator.userId);
  });

  it("uses AI after the fallback wait when no moderator is available", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    const { users, service } = setup(testConfig());
    const user = await makeUser(users, "waiting-user", { gender: "male", country: "NG", preferredGender: "any" });

    expect(await service.join(user.userId)).toHaveLength(0);
    vi.advanceTimersByTime(service.aiThresholdMs(1));

    const matched = await service.sweep();
    expect(matched).toHaveLength(1);
    expect(matched[0].kind).toBe("ai");
  });

  it("still gives real users priority over moderators after the fallback wait", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    const { users, service } = setup(testConfig());
    const waitingUser = await makeUser(users, "waiting-user", { gender: "male", country: "NG", preferredGender: "any" });
    const arrivingUser = await makeUser(users, "arriving-user", { gender: "female", country: "NG", preferredGender: "any" });
    const moderator = await users.findOrCreate({ channel: "telegram", externalId: "moderator" });
    await users.saveProfile({
      userId: moderator.userId,
      gender: "female",
      country: "NG",
      preferredGender: "any",
      moderator: true,
      moderatorAvailable: true,
      moderatorChannels: ["telegram"]
    });

    await service.join(waitingUser.userId);
    vi.advanceTimersByTime(service.aiThresholdMs(1));

    const matched = await service.join(arrivingUser.userId);
    expect(matched).toHaveLength(1);
    expect(matched[0].kind).toBe("human");
    expect(matched[0].participants.map((participant) => participant.userId)).toContain(waitingUser.userId);
    expect(matched[0].participants.map((participant) => participant.userId)).toContain(arrivingUser.userId);
    expect(matched[0].participants.map((participant) => participant.userId)).not.toContain(moderator.userId);
  });
});