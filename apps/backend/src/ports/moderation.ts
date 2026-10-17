export interface ModerationResult {
  readonly blocked: boolean;
  readonly reason?: string;
  readonly sanitized: string;
}

export interface ModerationService {
  inspect(text: string): ModerationResult;
}