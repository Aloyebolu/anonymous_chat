import { STRINGS } from "../constants";
import { API_PATHS } from "@anonymous-chat/shared/api";

const WEB = process.env.NEXT_PUBLIC_WEB_API ?? "http://localhost:3000";

export interface SendPayload {
  readonly user: string;
  readonly text?: string;
  readonly actionId?: string;
  readonly media?: {
    readonly kind: "image" | "video" | "audio" | "voice" | "document";
    readonly mimeType: string;
    readonly filename: string;
    readonly base64: string;
  };
}

export const sendInbound = async (payload: SendPayload, token: string): Promise<void> => {
  const res = await fetch(`${WEB}${API_PATHS.send}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`send failed: ${res.status}`);
  }
};

export const streamUrl = (user: string, token: string): string =>
  `${WEB}${API_PATHS.stream}?user=${encodeURIComponent(user)}&token=${encodeURIComponent(token)}`;

export const commands = STRINGS.commands;