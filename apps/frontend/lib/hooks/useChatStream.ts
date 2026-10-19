"use client";
import { useEffect, useRef, useState } from "react";
import { openStream } from "../services/stream";
import type { WebOutboundMessage as OutboundMessage, WebStreamEvent } from "@anonymous-chat/shared/contracts";

export interface ChatEntry {
  readonly id: string;
  readonly role: "inbound" | "outbound";
  readonly message: OutboundMessage;
}

export const useChatStream = (user: string, token: string) => {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const counter = useRef(0);

  useEffect(() => {
    setEntries([]);
    if (!user || !token) return;
    const handle = openStream(user, token, (event) => {
      if (event.kind === "delete") {
        setEntries((prev) => prev.filter((entry) => entry.id !== event.messageId));
        return;
      }
      counter.current += 1;
      setEntries((prev) => [...prev, {
        id: event.messageId,
        role: "inbound",
        message: event
      }]);
    });
    return () => handle.close();
  }, [token, user]);

  const appendOutbound = (message: OutboundMessage) => {
    counter.current += 1;
    setEntries((prev) => [...prev, { id: `out-${counter.current}`, role: "outbound", message }]);
  };

  return { entries, appendOutbound };
};