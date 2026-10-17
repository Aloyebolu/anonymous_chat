import { streamUrl } from "./api";
import type { OutboundMessage } from "../types";

export interface StreamHandle { close: () => void }

export const openStream = (
  user: string,
  onMessage: (message: OutboundMessage) => void,
  onError?: (error: Event) => void
): StreamHandle => {
  const source = new EventSource(streamUrl(user));
  source.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as OutboundMessage;
      onMessage(parsed);
    } catch (error) {
      console.error("Failed to parse SSE payload", error);
    }
  };
  source.onerror = (event) => { onError?.(event); };
  return { close: () => source.close() };
};