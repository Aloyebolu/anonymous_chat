export const AI_CHANNEL = "ai";
export const AI_EXTERNAL_ID = "assistant";

export const VIP_CONFIG = { pointsCost: 100, durationDays: 30 } as const;

export const CHAT_COMMANDS = [
  "/start",
  "/find",
  "/next",
  "/leave",
  "/end",
  "/report",
  "/block",
  "/help",
  "/vip",
  "/app",
  "/points"
] as const;
