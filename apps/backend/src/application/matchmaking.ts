import { AI_CHANNEL, AI_EXTERNAL_ID, conversationId, isVipProfile, type Conversation, type UserId, type UserProfile } from "../domain/types.js";
import type { ConversationRepository, MatchQueueEntry, MatchQueueRepository, UserRepository } from "../ports/repositories.js";

export interface MatchmakingConfig {
  readonly lowSupplyThreshold: number;
  readonly relaxPreferencesAfterMs: number;
  readonly scoring: {
    readonly preferredGenderMatch: number;
    readonly preferredGenderMismatch: number;
    readonly preferredCountryMatch: number;
    readonly preferredCountryMismatch: number;
    readonly waitSecond: number;
    readonly priorityTier: number;
    readonly keeper: number;
    readonly vip: number;
  };
  readonly jitter: number;
  readonly aiFallback: {
    readonly enabled: boolean;
    readonly baseMs: number;
    readonly minMs: number;
    readonly maxMs: number;
    readonly minOnlineForRealMatches: number;
  };
}

export const MATCHMAKING_CONFIG: MatchmakingConfig = {
  lowSupplyThreshold: 4,
  relaxPreferencesAfterMs: 90_000,
  scoring: {
    preferredGenderMatch: 100,
    preferredGenderMismatch: -250,
    preferredCountryMatch: 40,
    preferredCountryMismatch: -30,
    waitSecond: 1,
    priorityTier: 250,
    keeper: 75,
    vip: 300
  },
  jitter: 10,
  aiFallback: {
    enabled: true,
    baseMs: 60_000,
    minMs: 15_000,
    maxMs: 120_000,
    minOnlineForRealMatches: 5
  }
};

const directionalScore = (viewer: UserProfile, other: UserProfile, config: MatchmakingConfig): number => {
  const s = config.scoring;
  let score = 0;
  if (viewer.preferredGender === "any") score += s.preferredGenderMatch * 0.5;
  else if (viewer.preferredGender === other.gender) score += s.preferredGenderMatch;
  else score += s.preferredGenderMismatch;

  if (!viewer.preferredCountry) score += s.preferredCountryMatch * 0.5;
  else if (viewer.preferredCountry === other.country) score += s.preferredCountryMatch;
  else score += s.preferredCountryMismatch;

  const tier = viewer.priorityTier ?? 0;
  return score + tier * s.priorityTier + (isVipProfile(viewer) ? s.vip : 0);
};

const preferenceScore = (a: UserProfile, b: UserProfile, config: MatchmakingConfig): number =>
  directionalScore(a, b, config) + directionalScore(b, a, config);

const vipAccepts = (vip: UserProfile, other: UserProfile): boolean => {
  const genderOk = vip.preferredGender === "any" || vip.preferredGender === other.gender;
  const countryOk = !vip.preferredCountry || vip.preferredCountry.toLowerCase() === other.country.toLowerCase();
  return genderOk && countryOk;
};

const pairScore = (a: UserProfile, b: UserProfile, aWaitMs: number, bWaitMs: number, config: MatchmakingConfig): number => {
  const waitBonus = (Math.max(aWaitMs, bWaitMs) / 1000) * config.scoring.waitSecond;
  const jitter = (Math.random() - 0.5) * 2 * config.jitter;
  const keeperBoost = a.keeper || b.keeper ? config.scoring.keeper : 0;
  return preferenceScore(a, b, config) + keeperBoost + waitBonus + jitter;
};

interface Candidate {
  readonly a: MatchQueueEntry;
  readonly b: MatchQueueEntry;
  readonly score: number;
  readonly relaxed: boolean;
  readonly vipPriority: boolean;
  readonly ageMs: number;
}

export class MatchmakingService {
  constructor(
    private readonly users: UserRepository,
    private readonly queue: MatchQueueRepository,
    private readonly conversations: ConversationRepository,
    private readonly config: MatchmakingConfig = MATCHMAKING_CONFIG
  ) {}

  /** The current AI-fallback threshold, given the queue size. Exposed for the admin UI. */
  aiThresholdMs(queueSize: number): number {
    const { baseMs, minMs, maxMs, minOnlineForRealMatches } = this.config.aiFallback;
    const raw = baseMs * (Math.max(queueSize, 1) / Math.max(minOnlineForRealMatches, 1));
    return Math.min(Math.max(raw, minMs), maxMs);
  }

  async isWaiting(userId: UserId): Promise<boolean> {
    return (await this.queue.entries()).some((entry) => entry.userId === userId);
  }

  async stopWaiting(userId: UserId): Promise<void> {
    await this.queue.remove(userId);
  }

  async join(userId: UserId): Promise<readonly Conversation[]> {
    const eligibility = await this.users.eligibilityFor(userId);
    const profile = await this.users.profileFor(userId);
    if (eligibility?.status !== "eligible") throw new Error("Adult eligibility is required before matchmaking.");
    if (!profile) throw new Error("A profile is required before matchmaking.");
    if (profile.shadowBanned) throw new Error("This account cannot join matchmaking.");
    if (await this.conversations.activeFor(userId)) throw new Error("Leave the current conversation before matching again.");

    await this.queue.enqueue(userId);
    return this.runMatchingPass();
  }

  async sweep(): Promise<readonly Conversation[]> {
    return this.runMatchingPass();
  }

  async forceOperatorMatch(operatorUserId: UserId, waitingUserId: UserId): Promise<Conversation | undefined> {
    const operatorIdentity = await this.users.identityFor(operatorUserId);
    const targetIdentity = await this.users.identityFor(waitingUserId);
    if (!operatorIdentity || !targetIdentity) return undefined;
    const targetProfile = await this.users.profileFor(waitingUserId);
    if (targetProfile?.shadowBanned) return undefined;
    if (await this.conversations.activeFor(waitingUserId)) return undefined;

    const conversation: Conversation = {
      id: conversationId(crypto.randomUUID()),
      participants: [
        { userId: operatorUserId, identity: operatorIdentity },
        { userId: waitingUserId, identity: targetIdentity }
      ],
      status: "active",
      createdAt: new Date(),
      kind: "operator"
    };
    await this.queue.remove(waitingUserId);
    await this.conversations.save(conversation);
    return conversation;
  }

  private async runMatchingPass(): Promise<readonly Conversation[]> {
    const now = new Date();
    const entries = await this.queue.entries();
    const profiles = new Map<UserId, UserProfile>();
    const taken = new Set<UserId>();

    for (const entry of entries) {
      const profile = await this.users.profileFor(entry.userId);
      const eligibility = await this.users.eligibilityFor(entry.userId);
      if (!profile || profile.shadowBanned || eligibility?.status !== "eligible" || (await this.conversations.activeFor(entry.userId))) {
        await this.queue.remove(entry.userId);
        taken.add(entry.userId);
        continue;
      }
      profiles.set(entry.userId, profile);
    }

    const available = entries.filter((entry) => !taken.has(entry.userId));
    const lowSupply = available.length < this.config.lowSupplyThreshold;
    const candidates: Candidate[] = [];

    for (let i = 0; i < available.length; i++) {
      for (let j = i + 1; j < available.length; j++) {
        const a = available[i];
        const b = available[j];
        const aProfile = profiles.get(a.userId)!;
        const bProfile = profiles.get(b.userId)!;
        const aVip = isVipProfile(aProfile, now.getTime());
        const bVip = isVipProfile(bProfile, now.getTime());
        if ((aVip && !vipAccepts(aProfile, bProfile)) || (bVip && !vipAccepts(bProfile, aProfile))) continue;
        const aWaitMs = now.getTime() - a.enqueuedAt.getTime();
        const bWaitMs = now.getTime() - b.enqueuedAt.getTime();
        const relaxed =
          lowSupply ||
          aWaitMs >= this.config.relaxPreferencesAfterMs ||
          bWaitMs >= this.config.relaxPreferencesAfterMs;

        if (!relaxed && preferenceScore(aProfile, bProfile, this.config) < 0) continue;

        candidates.push({
          a, b,
          score: pairScore(aProfile, bProfile, aWaitMs, bWaitMs, this.config),
          relaxed,
          vipPriority: aVip || bVip,
          ageMs: Math.max(aWaitMs, bWaitMs)
        });
      }
    }

    candidates.sort((x, y) => {
      if (x.vipPriority !== y.vipPriority) return x.vipPriority ? -1 : 1;
      if (x.relaxed !== y.relaxed) return x.relaxed ? -1 : 1;
      if (x.relaxed && y.relaxed) return y.ageMs - x.ageMs;
      return y.score - x.score;
    });

    const created: Conversation[] = [];
    for (const candidate of candidates) {
      if (taken.has(candidate.a.userId) || taken.has(candidate.b.userId)) continue;
      const conversation = await this.createHumanConversation(candidate.a.userId, candidate.b.userId);
      if (!conversation) continue;
      taken.add(candidate.a.userId);
      taken.add(candidate.b.userId);
      created.push(conversation);
    }

    // Keep waiters in the human queue until the fallback threshold. At that
    // point, offer an available moderator first, then use AI if none can take it.
    const remaining = available.filter((entry) => !taken.has(entry.userId));
    const threshold = this.aiThresholdMs(remaining.length || 1);
    const moderators = await this.availableModerators();
    for (const entry of remaining) {
      if (now.getTime() - entry.enqueuedAt.getTime() < threshold) continue;

      const moderator = moderators.find((candidate) => !taken.has(candidate.userId));
      if (moderator) {
        const conversation = await this.createModeratorConversation(entry.userId, moderator.userId, moderator.identity);
        if (conversation) {
          taken.add(entry.userId);
          taken.add(moderator.userId);
          created.push(conversation);
          continue;
        }
      }

      if (!this.config.aiFallback.enabled) continue;
      const conversation = await this.createAiConversation(entry.userId);
      if (!conversation) continue;
      taken.add(entry.userId);
      created.push(conversation);
    }

    return created;
  }

  private async availableModerators(): Promise<{ userId: UserId; identity: import("../domain/types.js").CommunicationIdentity }[]> {
    const identities = await this.users.allIdentities();
    const byUser = new Map<UserId, typeof identities[number][]>();
    for (const identity of identities) byUser.set(identity.userId, [...(byUser.get(identity.userId) ?? []), identity]);
    const available: { userId: UserId; identity: import("../domain/types.js").CommunicationIdentity }[] = [];
    for (const [id, channels] of byUser) {
      const profile = await this.users.profileFor(id);
      if (!profile?.moderator || !profile.moderatorAvailable || profile.shadowBanned ||
        available.some((entry) => entry.userId === id) || await this.conversations.activeFor(id)) continue;
      const identity = channels.find((candidate) => profile.moderatorChannels?.includes(candidate.channel));
      if (identity) available.push({ userId: id, identity });
    }
    return available;
  }

  private async createModeratorConversation(targetId: UserId, moderatorId: UserId, moderatorIdentity: import("../domain/types.js").CommunicationIdentity): Promise<Conversation | undefined> {
    const [targetIdentity, targetProfile] = await Promise.all([this.users.identityFor(targetId), this.users.profileFor(targetId)]);
    if (!targetIdentity || !targetProfile || targetProfile.shadowBanned || await this.conversations.activeFor(moderatorId)) return undefined;
    const conversation: Conversation = {
      id: conversationId(crypto.randomUUID()),
      participants: [
        { userId: targetId, identity: targetIdentity },
        { userId: moderatorId, identity: moderatorIdentity }
      ],
      status: "active",
      createdAt: new Date(),
      kind: "operator"
    };
    await this.queue.remove(targetId);
    await this.conversations.save(conversation);
    return conversation;
  }

  private async createHumanConversation(aId: UserId, bId: UserId): Promise<Conversation | undefined> {
    const [aIdentity, bIdentity] = await Promise.all([this.users.identityFor(aId), this.users.identityFor(bId)]);
    if (!aIdentity || !bIdentity) return undefined;
    const conversation: Conversation = {
      id: conversationId(crypto.randomUUID()),
      participants: [
        { userId: aId, identity: aIdentity },
        { userId: bId, identity: bIdentity }
      ],
      status: "active",
      createdAt: new Date(),
      kind: "human"
    };
    await this.queue.remove(aId);
    await this.queue.remove(bId);
    await this.conversations.save(conversation);
    return conversation;
  }

  private async createAiConversation(userId: UserId): Promise<Conversation | undefined> {
    const userIdentity = await this.users.identityFor(userId);
    if (!userIdentity) return undefined;
    const aiIdentity = await this.users.findOrCreate({ channel: AI_CHANNEL, externalId: AI_EXTERNAL_ID });
    const conversation: Conversation = {
      id: conversationId(crypto.randomUUID()),
      participants: [
        { userId, identity: userIdentity },
        { userId: aiIdentity.userId, identity: aiIdentity }
      ],
      status: "active",
      createdAt: new Date(),
      kind: "ai"
    };
    await this.queue.remove(userId);
    await this.conversations.save(conversation);
    return conversation;
  }
}
