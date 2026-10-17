"use client";
import { MessageBubble } from "./MessageBubble";
import type { ChatEntry } from "@/lib/hooks/useChatStream";

export interface ChatLogProps {
  readonly entries: readonly ChatEntry[];
  readonly onCommand: (command: string) => void;
  readonly onAction: (action: { id: string; label: string }) => void;
}

export const ChatLog = ({ entries, onCommand, onAction }: ChatLogProps) => (
  <div className="chat-log">
    {entries.map((entry) => (
      <MessageBubble
        key={entry.id}
        message={entry.message}
        role={entry.role}
        onCommand={onCommand}
        onAction={onAction}
      />
    ))}
  </div>
);