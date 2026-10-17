"use client";
import { useEffect, useState } from "react";
import { STRINGS } from "@/lib/constants";
import { fetchWatchLog } from "@/lib/services/admin";
import type { MessageLogEntry } from "@/lib/types";

export interface WatchPanelProps {
  readonly conversationId: string | null;
  readonly onClose: () => void;
}

export const WatchPanel = ({ conversationId, onClose }: WatchPanelProps) => {
  const [entries, setEntries] = useState<readonly MessageLogEntry[]>([]);

  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    const load = async () => {
      try {
        const { entries } = await fetchWatchLog(conversationId);
        if (active) setEntries(entries);
      } catch (error) {
        console.error(error);
      }
    };
    void load();
    const timer = setInterval(load, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [conversationId]);

  if (!conversationId) return <p className="muted">{STRINGS.watchEmpty}</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <code>{conversationId.slice(0, 8)}</code>
        <button onClick={onClose}>{STRINGS.watchStop}</button>
      </div>
      {entries.length === 0 ? (
        <p className="muted">{STRINGS.watchLogEmpty}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
          {entries.map((entry) => (
            <div key={entry.id} style={{ fontSize: 13 }}>
              <span className="muted">{new Date(entry.timestamp).toLocaleTimeString()}</span>{" "}
              <code>{entry.direction === "inbound" ? entry.fromUserId.slice(0, 6) : "→ " + entry.toUserId.slice(0, 6)}</code>{" "}
              {entry.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};