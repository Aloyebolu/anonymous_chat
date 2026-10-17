import type { CommunicationIdentity, Conversation, ConversationId, Eligibility, ProfileDraft, UserId, UserProfile } from "../domain/types.js";

export interface UserRepository {
  findOrCreate(identity: Omit<CommunicationIdentity, "userId">): Promise<CommunicationIdentity>;
  identityFor(userId: UserId, preferredChannel?: string): Promise<CommunicationIdentity | undefined>;
  allIdentities(): Promise<readonly CommunicationIdentity[]>;
  saveProfile(profile: UserProfile): Promise<void>;
  profileFor(userId: UserId): Promise<UserProfile | undefined>;
  saveEligibility(eligibility: Eligibility): Promise<void>;
  eligibilityFor(userId: UserId): Promise<Eligibility | undefined>;
  saveDraft(draft: ProfileDraft): Promise<void>;
  draftFor(userId: UserId): Promise<ProfileDraft | undefined>;
  clearDraft(userId: UserId): Promise<void>;
}

export interface MatchQueueEntry {
  readonly userId: UserId;
  readonly enqueuedAt: Date;
}

export interface MatchQueueRepository {
  enqueue(userId: UserId): Promise<void>;
  remove(userId: UserId): Promise<void>;
  entries(): Promise<readonly MatchQueueEntry[]>;
}

export interface ConversationRepository {
  save(conversation: Conversation): Promise<void>;
  activeFor(userId: UserId): Promise<Conversation | undefined>;
  byId(id: ConversationId): Promise<Conversation | undefined>;
  all(): Promise<readonly Conversation[]>;
}

export interface PointsRepository {
  balance(userId: UserId): Promise<number>;
  /** Grants one point at most once per event, with a daily earn cap. */
  award(userId: UserId, eventId: string, at?: Date): Promise<number>;
  awardActivity(userId: UserId, eventId: string, points: number, at?: Date): Promise<number>;
  spend(userId: UserId, eventId: string, points: number, at?: Date): Promise<"spent" | "duplicate" | "insufficient">;
}
