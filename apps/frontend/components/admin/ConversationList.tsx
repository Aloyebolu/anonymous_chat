"use client";
import { STRINGS } from "@/lib/constants";
import type { AdminConversation } from "@anonymous-chat/shared/contracts";

export interface ConversationListProps {
  readonly conversations: readonly AdminConversation[];
  readonly watched: readonly string[];
  readonly onWatch: (id: string) => void;
  readonly onUnwatch: (id: string) => void;
  readonly onInspect: (id: string) => void;
}

export const ConversationList = ({ conversations, watched, onWatch, onUnwatch, onInspect }: ConversationListProps) => {
  const active = conversations.filter((c) => c.status === "active");
  if (active.length === 0) return <p className="muted">{STRINGS.noActive}</p>;
  return (
    <div>
      {active.map((c) => {
        const isWatched = watched.includes(c.id);
        return (
          <div key={c.id} style={{ padding: "8px 0", borderBottom: "1px solid #eee" }}>
            <div>
              <strong>{c.id.slice(0, 8)}</strong>{" "}
              <span className={`pill ${c.status}`}>{c.status}</span>{" "}
              <span className="muted">kind: {c.kind}</span>
            </div>
            <div>
              {c.participants.map((p) => (
                <code key={p.userId}>{p.channel}:{p.externalId}</code>
              )).reduce<React.ReactNode[]>((acc, el, i) => i === 0 ? [el] : [...acc, " ↔ ", el], [])}
            </div>
            <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
              {isWatched ? (
                <>
                  <button onClick={() => onUnwatch(c.id)}>{STRINGS.watchStop}</button>
                  <button onClick={() => onInspect(c.id)}>View log</button>
                </>
              ) : (
                <button onClick={() => onWatch(c.id)}>{STRINGS.watchStart}</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};