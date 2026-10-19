"use client";
import { useEffect, useRef, useState } from "react";
import { openStream } from "../services/stream";
import type { WebOutboundMessage as OutboundMessage, WebStreamEvent } from "@anonymous-chat/shared/contracts";

export interface ChatEntry {
  readonly id: string;
  readonly role: "inbound" | "outbound";
  readonly message: OutboundMessage;
  readonly reactions: readonly string[];
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
      if (event.kind === "edit") {
        setEntries((prev) => prev.map((entry) => entry.id === event.messageId &&
          (entry.message.kind === "text" || entry.message.kind === "interaction")
          ? { ...entry, message: { ...entry.message, text: event.text, format: event.format } }
          : entry));
        return;
      }
      if (event.kind === "reaction") {
        setEntries((prev) => prev.map((entry) => entry.id === event.messageId
          ? { ...entry, reactions: [...new Set([...entry.reactions, event.emoji])] }
          : entry));
        return;
      }
      counter.current += 1;
      setEntries((prev) => [...prev, {
        id: event.messageId,
        role: "inbound",
        message: event,
        reactions: []
      }]);
    });
    return () => handle.close();
  }, [token, user]);

  const appendOutbound = (message: OutboundMessage, messageId: string) => {
    counter.current += 1;
    setEntries((prev) => [...prev, { id: messageId || `out-${counter.current}`, role: "outbound", message, reactions: [] }]);
  };

  const updateText = (messageId: string, text: string) => {
    setEntries((prev) => prev.map((entry) => entry.id === messageId &&
      (entry.message.kind === "text" || entry.message.kind === "interaction")
      ? { ...entry, message: { ...entry.message, text } }
      : entry));
  };

  const appendReaction = (messageId: string, emoji: string) => {
    setEntries((prev) => prev.map((entry) => entry.id === messageId
      ? { ...entry, reactions: [...new Set([...entry.reactions, emoji])] }
      : entry));
  };

  return { entries, appendOutbound, updateText, appendReaction };
};