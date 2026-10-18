"use client";
import { useCallback } from "react";
import { ChatLog } from "@/components/ChatLog";
import { CommandPalette } from "@/components/CommandPalette";
import { Composer } from "@/components/Composer";
import { UserField } from "@/components/UserField";
import { STRINGS } from "@/lib/constants";
import { useChatStream } from "@/lib/hooks/useChatStream";
import { useSendMessage } from "@/lib/hooks/useSendMessage";
import { useUserIdentity } from "@/lib/hooks/useUserIdentity";

export default function HomePage() {
  const { user, setUser } = useUserIdentity();
  const { entries, appendOutbound } = useChatStream(user);
  const send = useSendMessage(user);

  const sendText = useCallback((text: string) => {
    appendOutbound({ kind: "text", text });
    void send({ text });
  }, [appendOutbound, send]);

  const sendAction = useCallback((action: { id: string; label: string }) => {
    appendOutbound({ kind: "text", text: action.label });
    void send({ actionId: action.id });
  }, [appendOutbound, send]);

  const sendMedia = useCallback(async (media: {
    kind: "image" | "video" | "audio" | "voice" | "document";
    mimeType: string;
    filename: string;
    base64: string;
  }) => {
    if (!user) return;
    appendOutbound({
      kind: "media",
      media: {
        kind: media.kind,
        mimeType: media.mimeType,
        filename: media.filename,
        url: `data:${media.mimeType};base64,${media.base64}`
      }
    });
    await send({ media });
  }, [appendOutbound, send, user]);

  return (
    <div className="chat-shell">
      <header className="chat-header">
        {STRINGS.appTitle} — <UserField value={user} onChange={setUser} />
      </header>
      <ChatLog entries={entries} onCommand={sendText} onAction={sendAction} />
      <CommandPalette onCommand={sendText} />
      <p className="muted" style={{ padding: "0 12px 8px" }}>{STRINGS.headerTip}</p>
      <Composer onSend={sendText} onSendMedia={sendMedia} />
    </div>
  );
}