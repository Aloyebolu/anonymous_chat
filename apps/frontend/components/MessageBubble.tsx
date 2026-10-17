"use client";
import { InteractionButtons } from "./InteractionButtons";
import { STRINGS } from "@/lib/constants";
import type { OutboundMessage } from "@/lib/types";

export interface MessageBubbleProps {
  readonly message: OutboundMessage;
  readonly role: "inbound" | "outbound";
  readonly onCommand: (command: string) => void;
  readonly onAction: (action: { id: string; label: string }) => void;
}

const renderWithCommands = (text: string, onCommand: (cmd: string) => void) => {
  const parts = text.split(/(\s+)/);
  return parts.map((part, i) => {
    if ((STRINGS.commands as readonly string[]).includes(part)) {
      return (
        <a key={i} href="#" className="cmd" onClick={(e) => { e.preventDefault(); onCommand(part); }}>
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
};

export const MessageBubble = ({ message, role, onCommand, onAction }: MessageBubbleProps) => (
  <div className={`msg ${role === "outbound" ? "out" : ""}`}>
    {renderWithCommands(message.text, onCommand)}
    {message.kind === "interaction" && <InteractionButtons actions={message.actions} onPick={onAction} />}
  </div>
);