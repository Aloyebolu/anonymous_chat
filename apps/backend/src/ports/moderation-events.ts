import type { ModerationEvent } from "../domain/types.js";
import type { UserId } from "../domain/types.js";

export interface ModerationEventRepository {
  save(event: ModerationEvent): Promise<void>;
  all(): Promise<readonly ModerationEvent[]>;
  countsByUser(): Promise<ReadonlyMap<UserId, number>>;
}
