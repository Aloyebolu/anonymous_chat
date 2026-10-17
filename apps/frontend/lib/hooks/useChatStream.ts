"use client";
import { useEffect, useRef, useState } from "react";
import { openStream } from "../services/stream";
import type { OutboundMessage } from "../types";

export interface ChatEntry {
  readonly id: string;
  readonly role: "inbound" | "outbound";
  readonly message: OutboundMessage;
}

export const useChatStream = (user: string) => {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const counter = useRef(0);

  useEffect(() => {
    setEntries([]);
    if (!user) return;
    const handle = openStream(user, (message) => {
      counter.current += 1;
      setEntries((prev) => [...prev, { id: `in-${counter.current}`, role: "inbound", message }]);
    });
    return () => handle.close();
  }, [user]);

  const appendOutbound = (message: OutboundMessage) => {
    counter.current += 1;
    setEntries((prev) => [...prev, { id: `out-${counter.current}`, role: "outbound", message }]);
  };

  return { entries, appendOutbound };
};