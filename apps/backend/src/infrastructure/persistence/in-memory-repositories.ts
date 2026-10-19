import { userId, type CommunicationIdentity, type Conversation, type ConversationId, type Eligibility, type ProfileDraft, type UserId, type UserProfile } from "../../domain/types.js";
import type { ConversationRepository, MatchQueueEntry, MatchQueueRepository, UserRepository } from "../../ports/repositories.js";

export class InMemoryUserRepository implements UserRepository {
  private readonly identities = new Map<string, CommunicationIdentity>();
  private readonly profiles = new Map<UserId, UserProfile>();
  private readonly eligibility = new Map<UserId, Eligibility>();
  private readonly drafts = new Map<UserId, ProfileDraft>();

  async findOrCreate(input: Omit<CommunicationIdentity, "userId">): Promise<CommunicationIdentity> {
    const key = `${input.channel}:${input.externalId}`;
    let found = this.identities.get(key);
    if (!found) {
      found = { ...input, userId: userId(crypto.randomUUID()) };
      this.identities.set(key, found);
    }
    return found;
  }

  async identityForChannelExternalId(channel: string, externalId: string): Promise<CommunicationIdentity | undefined> {
    return this.identities.get(`${channel}:${externalId}`);
  }

  async identityFor(id: UserId, preferredChannel?: string): Promise<CommunicationIdentity | undefined> {
    return [...this.identities.values()].find((identity) => identity.userId === id && (!preferredChannel || identity.channel === preferredChannel));
  }

  async allIdentities(): Promise<readonly CommunicationIdentity[]> {
    return [...this.identities.values()];
  }

  async saveProfile(profile: UserProfile): Promise<void> { this.profiles.set(profile.userId, profile); }
  async profileFor(id: UserId): Promise<UserProfile | undefined> { return this.profiles.get(id); }
  async saveEligibility(value: Eligibility): Promise<void> { this.eligibility.set(value.userId, value); }
  async eligibilityFor(id: UserId): Promise<Eligibility | undefined> { return this.eligibility.get(id); }
  async saveDraft(draft: ProfileDraft): Promise<void> { this.drafts.set(draft.userId, draft); }
  async draftFor(id: UserId): Promise<ProfileDraft | undefined> { return this.drafts.get(id); }
  async clearDraft(id: UserId): Promise<void> { this.drafts.delete(id); }
}

export class InMemoryMatchQueueRepository implements MatchQueueRepository {
  private readonly entriesMap = new Map<UserId, Date>();

  async enqueue(id: UserId): Promise<void> {
    this.entriesMap.delete(id);
    this.entriesMap.set(id, new Date());
  }
  async remove(id: UserId): Promise<void> { this.entriesMap.delete(id); }
  async entries(): Promise<readonly MatchQueueEntry[]> {
    return [...this.entriesMap.entries()].map(([userId, enqueuedAt]) => ({ userId, enqueuedAt }));
  }
}

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly values = new Map<ConversationId, Conversation>();
  async save(value: Conversation) { this.values.set(value.id, value); }
  async activeFor(userId: UserId) {
    return [...this.values.values()].find((c) => c.status === "active" && c.participants.some((p) => p.userId === userId));
  }
  async byId(id: ConversationId) { return this.values.get(id); }
  async all(): Promise<readonly Conversation[]> { return [...this.values.values()]; }
}