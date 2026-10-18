import { createHash } from "node:crypto";
import { userId as brandUserId, type CommunicationIdentity, type Conversation, type ConversationId, type Eligibility, type ModerationEvent, type ProfileDraft, type Report, type UserId, type UserProfile } from "../../domain/types.js";
import type { ConversationRepository, MatchQueueEntry, MatchQueueRepository, PointsRepository, UserRepository } from "../../ports/repositories.js";
import type { ReportRepository } from "../../ports/reports.js";
import type { ModerationEventRepository } from "../../ports/moderation-events.js";
import type { JsonDatabase, JsonDatabaseShape } from "./json-database.js";

const identityKey = (channel: string, externalId: string) => `${channel}:${externalId}`;

export class JsonUserRepository implements UserRepository {
  constructor(private readonly db: JsonDatabase) { }

  async findOrCreate(input: Omit<CommunicationIdentity, "userId">): Promise<CommunicationIdentity> {
    const state = await this.db.load();
    const key = identityKey(input.channel, input.externalId);
    const existing = state.identities[key];
    if (existing) return existing;
    const created: CommunicationIdentity = { ...input, userId: brandUserId(crypto.randomUUID()) };
    await this.db.mutate((s: JsonDatabaseShape) => { s.identities[key] = created; });
    return created;
  }
  async identityFor(id: UserId, preferredChannel?: string): Promise<CommunicationIdentity | undefined> {
    const state = await this.db.load();
    return Object.values(state.identities).find((i) => i.userId === id && (!preferredChannel || i.channel === preferredChannel));
  }
  async allIdentities(): Promise<readonly CommunicationIdentity[]> { return Object.values((await this.db.load()).identities); }
  async claimModeratorIdentity(identity: CommunicationIdentity, code: string): Promise<UserId | undefined> {
    let claimed: UserId | undefined;
    const key = identityKey(identity.channel, identity.externalId);
    const codeHash = createHash("sha256").update(code).digest("hex");
    await this.db.mutate((state) => {
      const target = Object.values(state.profiles).find((profile) => profile.moderator &&
        profile.moderatorLinkCodeHash === codeHash &&
        Boolean(profile.moderatorLinkCodeExpiresAt && Date.parse(profile.moderatorLinkCodeExpiresAt) > Date.now()));
      if (!target) return;
      const sourceId = state.identities[key]?.userId ?? identity.userId;
      console.log({ sourceId, targetUserId: target.userId })
      if (sourceId !== target.userId && !(
        state.profiles[sourceId] || state.eligibility[sourceId] ||
        state.queue.some((entry) => entry.userId === sourceId) ||
        Object.values(state.conversations).some((conversation) => conversation.status === "active" && conversation.participants.some((participant) => participant.userId === sourceId))
      )) return;
      state.identities[key] = { ...identity, userId: target.userId };
      state.profiles[target.userId] = { ...target, moderatorLinkCodeHash: undefined, moderatorLinkCodeExpiresAt: undefined, moderatorChannels: [...target.moderatorChannels || [], identity.channel] };
      claimed = target.userId;
    });
    return claimed;
  }
  async saveProfile(profile: UserProfile): Promise<void> { await this.db.mutate((s) => { s.profiles[profile.userId] = profile; }); }
  async profileFor(id: UserId): Promise<UserProfile | undefined> { return (await this.db.load()).profiles[id]; }
  async saveEligibility(eligibility: Eligibility): Promise<void> { await this.db.mutate((s) => { s.eligibility[eligibility.userId] = eligibility; }); }
  async eligibilityFor(id: UserId): Promise<Eligibility | undefined> {
    const entry = (await this.db.load()).eligibility[id];
    return entry ? { ...entry, verifiedAt: new Date(entry.verifiedAt as unknown as string) } : undefined;
  }
  async saveDraft(draft: ProfileDraft): Promise<void> { await this.db.mutate((s) => { s.drafts[draft.userId] = draft; }); }
  async draftFor(id: UserId): Promise<ProfileDraft | undefined> { return (await this.db.load()).drafts[id]; }
  async clearDraft(id: UserId): Promise<void> { await this.db.mutate((s) => { delete s.drafts[id]; }); }
}

export class JsonMatchQueueRepository implements MatchQueueRepository {
  constructor(private readonly db: JsonDatabase) { }
  async enqueue(id: UserId): Promise<void> {
    const at = new Date().toISOString();
    await this.db.mutate((s) => {
      s.queue = s.queue.filter((entry) => entry.userId !== id);
      s.queue.push({ userId: id, enqueuedAt: at });
    });
  }
  async remove(id: UserId): Promise<void> { await this.db.mutate((s) => { s.queue = s.queue.filter((e) => e.userId !== id); }); }
  async entries(): Promise<readonly MatchQueueEntry[]> {
    const state = await this.db.load();
    return state.queue.map((entry) => ({ userId: brandUserId(entry.userId), enqueuedAt: new Date(entry.enqueuedAt) }));
  }
}

export class JsonConversationRepository implements ConversationRepository {
  constructor(private readonly db: JsonDatabase) { }
  async save(conversation: Conversation): Promise<void> { await this.db.mutate((s) => { s.conversations[conversation.id] = conversation; }); }
  async activeFor(userId: UserId): Promise<Conversation | undefined> {
    const state = await this.db.load();
    return Object.values(state.conversations).map(hydrateConversation).find((c) => c.status === "active" && c.participants.some((p) => p.userId === userId));
  }
  async byId(id: ConversationId): Promise<Conversation | undefined> {
    const found = (await this.db.load()).conversations[id];
    return found ? hydrateConversation(found) : undefined;
  }
  async all(): Promise<readonly Conversation[]> { return Object.values((await this.db.load()).conversations).map(hydrateConversation); }
}

export class JsonReportRepository implements ReportRepository {
  constructor(private readonly db: JsonDatabase) { }
  async save(report: Report): Promise<void> { await this.db.mutate((s) => { s.reports[report.id] = report; }); }
  async all(): Promise<readonly Report[]> {
    const state = await this.db.load();
    return Object.values(state.reports).map((r) => ({ ...r, createdAt: new Date(r.createdAt as unknown as string) }));
  }
}

const DAILY_POINT_CAP = 20;

export class JsonPointsRepository implements PointsRepository {
  constructor(private readonly db: JsonDatabase) { }
  async balance(id: UserId): Promise<number> {
    return (await this.db.load()).pointEvents
      .filter((event) => event.userId === id)
      .reduce((total, event) => total + event.points, 0);
  }
  async award(id: UserId, eventId: string, at = new Date()): Promise<number> {
    return this.awardActivity(id, eventId, 1, at);
  }
  async awardActivity(id: UserId, eventId: string, points: number, at = new Date()): Promise<number> {
    if (!Number.isInteger(points) || points < 1) return 0;
    let granted = false;
    await this.db.mutate((state) => {
      if (state.pointEvents.some((event) => event.eventId === eventId)) return;
      const day = at.toISOString().slice(0, 10);
      const earnedToday = state.pointEvents
        .filter((event) => event.userId === id && event.points > 0 && event.createdAt.slice(0, 10) === day)
        .reduce((sum, event) => sum + event.points, 0);
      const grantedPoints = Math.min(points, DAILY_POINT_CAP - earnedToday);
      if (grantedPoints < 1) return;
      state.pointEvents.push({ id: crypto.randomUUID(), userId: id, eventId, createdAt: at.toISOString(), points: grantedPoints });
      granted = true;
    });
    if (!granted) return 0;
    const event = (await this.db.load()).pointEvents.find((entry) => entry.eventId === eventId);
    return event?.points ?? 0;
  }
  async spend(id: UserId, eventId: string, points: number, at = new Date()): Promise<"spent" | "duplicate" | "insufficient"> {
    if (!Number.isInteger(points) || points < 1) return "insufficient";
    let result: "spent" | "duplicate" | "insufficient" = "insufficient";
    await this.db.mutate((state) => {
      if (state.pointEvents.some((event) => event.eventId === eventId)) { result = "duplicate"; return; }
      const balance = state.pointEvents.filter((event) => event.userId === id).reduce((sum, event) => sum + event.points, 0);
      if (balance < points) return;
      state.pointEvents.push({ id: crypto.randomUUID(), userId: id, eventId, createdAt: at.toISOString(), points: -points });
      result = "spent";
    });
    return result;
  }
}

export class JsonModerationEventRepository implements ModerationEventRepository {
  constructor(private readonly db: JsonDatabase) { }
  async save(event: ModerationEvent): Promise<void> {
    await this.db.mutate((state) => {
      state.moderationEvents[event.id] = event;
      const ids = Object.keys(state.moderationEvents);
      if (ids.length > 5_000) {
        ids.sort((a, b) => new Date(state.moderationEvents[a].createdAt).getTime() - new Date(state.moderationEvents[b].createdAt).getTime());
        for (const oldId of ids.slice(0, ids.length - 5_000)) delete state.moderationEvents[oldId];
      }
    });
  }
  async all(): Promise<readonly ModerationEvent[]> {
    return Object.values((await this.db.load()).moderationEvents).slice(-500).map((event) => ({
      ...event,
      createdAt: new Date(event.createdAt as unknown as string)
    }));
  }
  async countsByUser(): Promise<ReadonlyMap<UserId, number>> {
    const counts = new Map<UserId, number>();
    for (const event of Object.values((await this.db.load()).moderationEvents)) {
      counts.set(event.userId, (counts.get(event.userId) ?? 0) + 1);
    }
    return counts;
  }
}

const hydrateConversation = (conversation: Conversation): Conversation => ({
  ...conversation,
  createdAt: new Date(conversation.createdAt as unknown as string)
});
