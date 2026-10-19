import { STRINGS } from "../constants";
import { API_PATHS } from "@anonymous-chat/shared/api";

const WEB = process.env.NEXT_PUBLIC_WEB_API ?? "http://localhost:3000";

export interface SendPayload {
  readonly user: string;
  readonly text?: string;
  readonly actionId?: string;
  readonly externalMessageId?: string;
  readonly replyToMessageId?: string;
  readonly media?: {
    readonly kind: "image" | "video" | "audio" | "voice" | "document";
    readonly mimeType: string;
    readonly filename: string;
    readonly base64: string;
  };
}

export const sendInbound = async (payload: SendPayload, token: string): Promise<{ readonly messageId?: string }> => {
  const res = await fetch(`${WEB}${API_PATHS.send}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Send failed (${res.status}).`);
  }
  return res.status === 204 ? {} : await res.json() as { readonly messageId?: string };
};

const postMessageAction = async (
  path: string,
  payload: { readonly user: string; readonly messageId: string; readonly text?: string; readonly emoji?: string },
  token: string
): Promise<void> => {
  const response = await fetch(`${WEB}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || `Message action failed (${response.status}).`);
  }
};

export const editWebMessage = (user: string, token: string, messageId: string, text: string): Promise<void> =>
  postMessageAction(API_PATHS.web.editMessage, { user, messageId, text }, token);

export const reactToWebMessage = (user: string, token: string, messageId: string, emoji: string): Promise<void> =>
  postMessageAction(API_PATHS.web.reactMessage, { user, messageId, emoji }, token);

export const streamUrl = (user: string, token: string): string =>
  `${WEB}${API_PATHS.stream}?user=${encodeURIComponent(user)}&token=${encodeURIComponent(token)}`;

export const commands = STRINGS.commands;