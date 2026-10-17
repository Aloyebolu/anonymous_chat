import type { ConversationId, UserId } from "../domain/types.js";
import type { MessageLogEntry, Report } from "../domain/types.js";

export interface ReportRepository {
  save(report: Report): Promise<void>;
  all(): Promise<readonly Report[]>;
}

export interface MessageLogRepository {
  watch(conversationId: ConversationId): void;
  unwatch(conversationId: ConversationId): void;
  isWatched(conversationId: ConversationId): boolean;
  append(entry: MessageLogEntry): void;
  entriesFor(conversationId: ConversationId): readonly MessageLogEntry[];
  watchedConversations(): readonly ConversationId[];
}