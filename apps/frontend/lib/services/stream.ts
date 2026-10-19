import { streamUrl } from "./api";
import type { WebStreamEvent } from "@anonymous-chat/shared/contracts";

export interface StreamHandle { close: () => void }

export const openStream = (
  user: string,
  token: string,
  onMessage: (message: WebStreamEvent) => void,
  onError?: (error: Event) => void
): StreamHandle => {
  const source = new EventSource(streamUrl(user, token));
  source.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as WebStreamEvent;
      onMessage(parsed);
    } catch (error) {
      console.error("Failed to parse SSE payload", error);
    }
  };
  source.onerror = (event) => { onError?.(event); };
  return { close: () => source.close() };
};