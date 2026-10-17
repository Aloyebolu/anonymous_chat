import type { ConversationId } from "../../domain/types.js";
import type { MessageLogEntry } from "../../domain/types.js";
import type { MessageLogRepository } from "../../ports/reports.js";

export class InMemoryMessageLogRepository implements MessageLogRepository {
  private readonly watched = new Set<ConversationId>();
  private readonly entries = new Map<ConversationId, MessageLogEntry[]>();

  watch(conversationId: ConversationId): void { this.watched.add(conversationId); }
  unwatch(conversationId: ConversationId): void {
    this.watched.delete(conversationId);
    this.entries.delete(conversationId);
  }
  isWatched(conversationId: ConversationId): boolean { return this.watched.has(conversationId); }
  watchedConversations(): readonly ConversationId[] { return [...this.watched]; }

  append(entry: MessageLogEntry): void {
    if (!this.watched.has(entry.conversationId)) return;
    const list = this.entries.get(entry.conversationId) ?? [];
    list.push(entry);
    if (list.length > 500) list.splice(0, list.length - 500);
    this.entries.set(entry.conversationId, list);
  }

  entriesFor(conversationId: ConversationId): readonly MessageLogEntry[] {
    return this.entries.get(conversationId) ?? [];
  }
}