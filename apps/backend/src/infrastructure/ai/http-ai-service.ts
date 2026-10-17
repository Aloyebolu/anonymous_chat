import type { AiReplyInput, AiService } from "../../ports/ai.js";

export interface HttpAiOptions {
  readonly endpoint: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export class HttpAiService implements AiService {
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(private readonly options: HttpAiOptions) {
    this.maxTokens = options.maxTokens ?? 200;
    this.temperature = options.temperature ?? 0.7;
  }

  async generateReply(input: AiReplyInput): Promise<string> {
    const messages = [
      { role: "system" as const, content: input.persona.systemPrompt },
      ...input.history.map((turn) => ({ role: turn.role, content: turn.text })),
      { role: "user" as const, content: input.text }
    ];

    const res = await fetch(this.options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        stream: false
      })
    });

    if (!res.ok) throw new Error(`AI endpoint returned ${res.status}`);
    const body = (await res.json()) as { reply?: unknown };
    if (typeof body.reply !== "string" || body.reply.trim().length === 0) {
      throw new Error("AI endpoint returned no reply");
    }
    return body.reply.trim();
  }
}