import { STRINGS } from "../constants";
import { API_PATHS } from "@anonymous-chat/shared/api";

const WEB = process.env.NEXT_PUBLIC_WEB_API;

export interface SendPayload {
  readonly user: string;
  readonly text?: string;
  readonly actionId?: string;
}

export const sendInbound = async (payload: SendPayload): Promise<void> => {
  const res = await fetch(`${WEB}${API_PATHS.send}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`send failed: ${res.status}`);
  }
};

export const streamUrl = (user: string): string =>
  `${WEB}${API_PATHS.stream}?user=${encodeURIComponent(user)}`;

export const commands = STRINGS.commands;