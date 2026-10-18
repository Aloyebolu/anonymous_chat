import { createHash } from "node:crypto";
import { userId as brandUserId, type CommunicationIdentity, type Conversation, type ConversationId, type Eligibility, type ModerationEvent, type ProfileDraft, type Report, type UserId, type UserProfile } from "../../domain/types.js";
import type { ConversationRepository, MatchQueueEntry, MatchQueueRepository, PointsRepository, UserRepository } from "../../ports/repositories.js";
import type { ReportRepository } from "../../ports/reports.js";
import type { ModerationEventRepository } from "../../ports/moderation-events.js";
import type { PostgresDatabase } from "./postgres-database.js";

const DAILY_POINT_CAP = 20;

const hydrateEligibility = (value: Eligibility): Eligibility => ({
  ...value,
  verifiedAt: new Date(value.verifiedAt)
});

const hydrateConversation = (value: Conversation): Conversation => ({
  ...value,
  createdAt: new Date(value.createdAt)
});

const hydrateReport = (value: Report): Report => ({
  ...value,
  createdAt: new Date(value.createdAt)
});

const hydrateModerationEvent = (value: ModerationEvent): ModerationEvent => ({
  ...value,
  createdAt: new Date(value.createdAt)
});

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async findOrCreate(input: Omit<CommunicationIdentity, "userId">): Promise<CommunicationIdentity> {
    const created: CommunicationIdentity = { ...input, userId: brandUserId(crypto.randomUUID()) };
    const result = await this.db.query<{ payload: CommunicationIdentity }>(
      `INSERT INTO communication_identities (channel, external_id, user_id, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (channel, external_id) DO NOTHING
       RETURNING payload`,
      [input.channel, input.externalId, created.userId, created]
    );
    if (result.rows[0]) return result.rows[0].payload;
    const existing = await this.db.query<{ payload: CommunicationIdentity }>(
      "SELECT payload FROM communication_identities WHERE channel = $1 AND external_id = $2",
      [input.channel, input.externalId]
    );
    if (!existing.rows[0]) throw new Error("Identity was not found after a conflicting insert.");
    return existing.rows[0].payload;
  }

  async identityFor(id: UserId, preferredChannel?: string): Promise<CommunicationIdentity | undefined> {
    const result = await this.db.query<{ payload: CommunicationIdentity }>(
      `SELECT payload FROM communication_identities
       WHERE user_id = $1 AND ($2::text IS NULL OR channel = $2)
       ORDER BY channel, external_id LIMIT 1`,
      [id, preferredChannel ?? null]
    );
    return result.rows[0]?.payload;
  }

  async allIdentities(): Promise<readonly CommunicationIdentity[]> {
    const result = await this.db.query<{ payload: CommunicationIdentity }>(
      "SELECT payload FROM communication_identities ORDER BY channel, external_id"
    );
    return result.rows.map((row) => row.payload);
  }

  async claimModeratorIdentity(identity: CommunicationIdentity, code: string): Promise<UserId | undefined> {
    const codeHash = createHash("sha256").update(code).digest("hex");
    return this.db.transaction(async (client) => {
      const lockKey = `${identity.channel}:${identity.externalId}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);

      const targetResult = await client.query<{ payload: UserProfile }>(
        `SELECT payload FROM user_profiles
         WHERE payload->>'moderator' = 'true'
           AND payload->>'moderatorLinkCodeHash' = $1
           AND (payload->>'moderatorLinkCodeExpiresAt')::timestamptz > now()
         LIMIT 1 FOR UPDATE`,
        [codeHash]
      );
      const target = targetResult.rows[0]?.payload;
      if (!target) return undefined;

      const identityResult = await client.query<{ user_id: UserId }>(
        `SELECT user_id FROM communication_identities
         WHERE channel = $1 AND external_id = $2 FOR UPDATE`,
        [identity.channel, identity.externalId]
      );
      const sourceId = identityResult.rows[0]?.user_id ?? identity.userId;
      if (sourceId !== target.userId) {
        const sourceHasActiveConversation = await client.query<{ exists: boolean }>(
          `SELECT
             EXISTS (
               SELECT 1 FROM conversations
               WHERE status = 'active'
                 AND payload->'participants' @> jsonb_build_array(jsonb_build_object('userId', $1::text))
             ) AS exists`,
          [sourceId]
        );
        if (sourceHasActiveConversation.rows[0]?.exists) return undefined;
      }

      const claimed = { ...identity, userId: target.userId };
      await client.query(
        `INSERT INTO communication_identities (channel, external_id, user_id, payload)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (channel, external_id) DO UPDATE SET user_id = EXCLUDED.user_id, payload = EXCLUDED.payload`,
        [identity.channel, identity.externalId, target.userId, claimed]
      );

      const updatedProfile: UserProfile = {
        ...target,
        moderatorLinkCodeHash: undefined,
        moderatorLinkCodeExpiresAt: undefined,
        moderatorChannels: [...(target.moderatorChannels ?? []), identity.channel]
      };
      await client.query(
        `UPDATE user_profiles SET payload = $2 WHERE user_id = $1`,
        [target.userId, updatedProfile]
      );
      return target.userId;
    });
  }

  async saveProfile(profile: UserProfile): Promise<void> {
    await this.db.query(
      `INSERT INTO user_profiles (user_id, payload) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET payload = EXCLUDED.payload`,
      [profile.userId, profile]
    );
  }

  async profileFor(id: UserId): Promise<UserProfile | undefined> {
    const result = await this.db.query<{ payload: UserProfile }>(
      "SELECT payload FROM user_profiles WHERE user_id = $1",
      [id]
    );
    return result.rows[0]?.payload;
  }

  async saveEligibility(value: Eligibility): Promise<void> {
    await this.db.query(
      `INSERT INTO user_eligibility (user_id, payload) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET payload = EXCLUDED.payload`,
      [value.userId, value]
    );
  }

  async eligibilityFor(id: UserId): Promise<Eligibility | undefined> {
    const result = await this.db.query<{ payload: Eligibility }>(
      "SELECT payload FROM user_eligibility WHERE user_id = $1",
      [id]
    );
    return result.rows[0] ? hydrateEligibility(result.rows[0].payload) : undefined;
  }

  async saveDraft(draft: ProfileDraft): Promise<void> {
    await this.db.query(
      `INSERT INTO profile_drafts (user_id, payload) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET payload = EXCLUDED.payload`,
      [draft.userId, draft]
    );
  }

  async draftFor(id: UserId): Promise<ProfileDraft | undefined> {
    const result = await this.db.query<{ payload: ProfileDraft }>(
      "SELECT payload FROM profile_drafts WHERE user_id = $1",
      [id]
    );
    return result.rows[0]?.payload;
  }

  async clearDraft(id: UserId): Promise<void> {
    await this.db.query("DELETE FROM profile_drafts WHERE user_id = $1", [id]);
  }
}

export class PostgresMatchQueueRepository implements MatchQueueRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async enqueue(id: UserId): Promise<void> {
    await this.db.query(
      `INSERT INTO match_queue (user_id, enqueued_at) VALUES ($1, now())
       ON CONFLICT (user_id) DO UPDATE SET enqueued_at = EXCLUDED.enqueued_at`,
      [id]
    );
  }

  async remove(id: UserId): Promise<void> {
    await this.db.query("DELETE FROM match_queue WHERE user_id = $1", [id]);
  }

  async entries(): Promise<readonly MatchQueueEntry[]> {
    const result = await this.db.query<{ user_id: UserId; enqueued_at: Date }>(
      "SELECT user_id, enqueued_at FROM match_queue ORDER BY enqueued_at"
    );
    return result.rows.map((row) => ({ userId: row.user_id, enqueuedAt: new Date(row.enqueued_at) }));
  }
}

export class PostgresConversationRepository implements ConversationRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async save(conversation: Conversation): Promise<void> {
    await this.db.query(
      `INSERT INTO conversations (id, status, created_at, payload) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status, created_at = EXCLUDED.created_at, payload = EXCLUDED.payload`,
      [conversation.id, conversation.status, conversation.createdAt, conversation]
    );
  }

  async activeFor(id: UserId): Promise<Conversation | undefined> {
    const result = await this.db.query<{ payload: Conversation }>(
      `SELECT payload FROM conversations
       WHERE status = 'active'
         AND payload->'participants' @> jsonb_build_array(jsonb_build_object('userId', $1::text))
       ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    return result.rows[0] ? hydrateConversation(result.rows[0].payload) : undefined;
  }

  async byId(id: ConversationId): Promise<Conversation | undefined> {
    const result = await this.db.query<{ payload: Conversation }>(
      "SELECT payload FROM conversations WHERE id = $1",
      [id]
    );
    return result.rows[0] ? hydrateConversation(result.rows[0].payload) : undefined;
  }

  async all(): Promise<readonly Conversation[]> {
    const result = await this.db.query<{ payload: Conversation }>(
      "SELECT payload FROM conversations ORDER BY created_at"
    );
    return result.rows.map((row) => hydrateConversation(row.payload));
  }
}

export class PostgresReportRepository implements ReportRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async save(report: Report): Promise<void> {
    await this.db.query(
      `INSERT INTO reports (id, created_at, payload) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET created_at = EXCLUDED.created_at, payload = EXCLUDED.payload`,
      [report.id, report.createdAt, report]
    );
  }

  async all(): Promise<readonly Report[]> {
    const result = await this.db.query<{ payload: Report }>(
      "SELECT payload FROM reports ORDER BY created_at"
    );
    return result.rows.map((row) => hydrateReport(row.payload));
  }
}

export class PostgresPointsRepository implements PointsRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async balance(id: UserId): Promise<number> {
    const result = await this.db.query<{ balance: string | null }>(
      "SELECT COALESCE(SUM(points), 0)::text AS balance FROM point_events WHERE user_id = $1",
      [id]
    );
    return Number(result.rows[0]?.balance ?? 0);
  }

  async award(id: UserId, eventId: string, at = new Date()): Promise<number> {
    return this.awardActivity(id, eventId, 1, at);
  }

  async awardActivity(id: UserId, eventId: string, points: number, at = new Date()): Promise<number> {
    if (!Number.isInteger(points) || points < 1) return 0;
    return this.db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`event:${eventId}`]);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`user:${id}`]);
      const existing = await client.query<{ points: number }>(
        "SELECT points FROM point_events WHERE event_id = $1",
        [eventId]
      );
      if (existing.rows[0]) return 0;

      const day = at.toISOString().slice(0, 10);
      const dayStart = new Date(`${day}T00:00:00.000Z`);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const earned = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(points), 0)::text AS total FROM point_events
         WHERE user_id = $1 AND points > 0
           AND created_at >= $2 AND created_at < $3`,
        [id, dayStart, dayEnd]
      );
      const grantedPoints = Math.min(points, DAILY_POINT_CAP - Number(earned.rows[0]?.total ?? 0));
      if (grantedPoints < 1) return 0;

      await client.query(
        "INSERT INTO point_events (id, event_id, user_id, created_at, points) VALUES ($1, $2, $3, $4, $5)",
        [crypto.randomUUID(), eventId, id, at, grantedPoints]
      );
      return grantedPoints;
    });
  }

  async spend(id: UserId, eventId: string, points: number, at = new Date()): Promise<"spent" | "duplicate" | "insufficient"> {
    if (!Number.isInteger(points) || points < 1) return "insufficient";
    return this.db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`event:${eventId}`]);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`user:${id}`]);
      const existing = await client.query("SELECT 1 FROM point_events WHERE event_id = $1", [eventId]);
      if (existing.rowCount) return "duplicate";

      const balance = await client.query<{ total: string }>(
        "SELECT COALESCE(SUM(points), 0)::text AS total FROM point_events WHERE user_id = $1",
        [id]
      );
      if (Number(balance.rows[0]?.total ?? 0) < points) return "insufficient";

      await client.query(
        "INSERT INTO point_events (id, event_id, user_id, created_at, points) VALUES ($1, $2, $3, $4, $5)",
        [crypto.randomUUID(), eventId, id, at, -points]
      );
      return "spent";
    });
  }
}

export class PostgresModerationEventRepository implements ModerationEventRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async save(event: ModerationEvent): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO moderation_events (id, user_id, created_at, payload) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE
         SET user_id = EXCLUDED.user_id, created_at = EXCLUDED.created_at, payload = EXCLUDED.payload`,
        [event.id, event.userId, event.createdAt, event]
      );
      await client.query(
        `DELETE FROM moderation_events
         WHERE id IN (SELECT id FROM moderation_events ORDER BY created_at DESC OFFSET 5000)`
      );
    });
  }

  async all(): Promise<readonly ModerationEvent[]> {
    const result = await this.db.query<{ payload: ModerationEvent }>(
      "SELECT payload FROM moderation_events ORDER BY created_at DESC LIMIT 500"
    );
    return result.rows.map((row) => hydrateModerationEvent(row.payload));
  }

  async countsByUser(): Promise<ReadonlyMap<UserId, number>> {
    const result = await this.db.query<{ user_id: UserId; count: string }>(
      "SELECT user_id, COUNT(*)::text AS count FROM moderation_events GROUP BY user_id"
    );
    return new Map(result.rows.map((row) => [row.user_id, Number(row.count)]));
  }
}
