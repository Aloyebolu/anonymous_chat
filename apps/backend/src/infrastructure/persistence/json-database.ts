import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CommunicationIdentity, Conversation, Eligibility, ModerationEvent, ProfileDraft, Report, UserProfile } from "../../domain/types.js";

export interface QueueEntryRecord {
  readonly userId: string;
  readonly enqueuedAt: string;
}

export interface JsonDatabaseShape {
  identities: Record<string, CommunicationIdentity>;
  profiles: Record<string, UserProfile>;
  eligibility: Record<string, Eligibility>;
  drafts: Record<string, ProfileDraft>;
  queue: QueueEntryRecord[];
  conversations: Record<string, Conversation>;
  reports: Record<string, Report>;
  pointEvents: { id: string; userId: string; eventId: string; createdAt: string; points: number }[];
  moderationEvents: Record<string, ModerationEvent>;
}

const emptyState = (): JsonDatabaseShape => ({
  identities: {},
  profiles: {},
  eligibility: {},
  drafts: {},
  queue: [],
  conversations: {},
  reports: {},
  pointEvents: [],
  moderationEvents: {}
});

export class JsonDatabase {
  private loadPromise?: Promise<JsonDatabaseShape>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<JsonDatabaseShape> {
    if (!this.loadPromise) this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  async mutate(mutator: (state: JsonDatabaseShape) => void): Promise<void> {
    const state = await this.load();
    mutator(state);
    await this.enqueueWrite(state);
  }

  private async doLoad(): Promise<JsonDatabaseShape> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as JsonDatabaseShape;
      this.hydrate(parsed);
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return emptyState();
    }
  }

  private hydrate(state: JsonDatabaseShape): void {
    state.identities ??= {};
    state.profiles ??= {};
    state.eligibility ??= {};
    state.drafts ??= {};
    state.queue ??= [];
    state.conversations ??= {};
    state.reports ??= {};
    state.pointEvents ??= [];
    state.moderationEvents ??= {};

    for (const key of Object.keys(state.eligibility)) {
      const entry = state.eligibility[key] as unknown as { verifiedAt: unknown };
      if (typeof entry.verifiedAt === "string") entry.verifiedAt = new Date(entry.verifiedAt);
    }
    for (const key of Object.keys(state.conversations)) {
      const entry = state.conversations[key] as unknown as { createdAt: unknown };
      if (typeof entry.createdAt === "string") entry.createdAt = new Date(entry.createdAt);
    }
    for (const key of Object.keys(state.reports)) {
      const entry = state.reports[key] as unknown as { createdAt: unknown };
      if (typeof entry.createdAt === "string") entry.createdAt = new Date(entry.createdAt);
    }
    for (const key of Object.keys(state.moderationEvents)) {
      const event = state.moderationEvents[key] as unknown as { createdAt: unknown };
      if (typeof event.createdAt === "string") event.createdAt = new Date(event.createdAt);
    }
    state.queue = state.queue.map((entry) => ({
      userId: entry.userId,
      enqueuedAt: String(entry.enqueuedAt)
    }));
  }

  private async enqueueWrite(state: JsonDatabaseShape): Promise<void> {
    const snapshot = JSON.stringify(state, null, 2);
    const previous = this.writeQueue;
    this.writeQueue = (async () => {
      try { await previous; } catch { /* keep going */ }
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, this.path);
    })();
    await this.writeQueue;
  }
}
