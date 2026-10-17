import type { AiReplyInput, AiService } from "../../ports/ai.js";

const CANNED = [
  "Hey — glad we matched. What's on your mind?",
  "That's interesting. Tell me more.",
  "Fair enough. What do you usually do for fun?",
  "I hear you. Anything you're looking forward to this week?",
  "Nice. So what brings you here tonight?"
];

export class StubAiService implements AiService {
  private cursor = 0;

  async generateReply(input: AiReplyInput): Promise<string> {
    if (input.text.trim().length === 0) return CANNED[0];
    const reply = CANNED[this.cursor % CANNED.length];
    this.cursor += 1;
    return reply;
  }
}