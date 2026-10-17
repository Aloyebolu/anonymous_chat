import type { ConversationId, UserId } from "../domain/types.js";

export interface AiTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface AiPersona {
  readonly systemPrompt: string;
}

export interface AiReplyInput {
  readonly conversationId: ConversationId;
  readonly userId: UserId;
  readonly persona: AiPersona;
  readonly text: string;
  readonly history: readonly AiTurn[];
}

export interface AiService {
  generateReply(input: AiReplyInput): Promise<string>;
}