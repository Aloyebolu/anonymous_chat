"use client";
import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import type { ChatEntry } from "@/lib/hooks/useChatStream";

export interface ChatLogProps {
  readonly entries: readonly ChatEntry[];
  readonly onCommand: (command: string) => void;
  readonly onAction: (action: { id: string; label: string }) => void;
}

export const ChatLog = ({ entries, onCommand, onAction }: ChatLogProps) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  // Auto-scroll to bottom when new entries arrive, but only if the user
  // hasn't scrolled up to read history.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !pinned) return;
    el.scrollTop = el.scrollHeight;
  }, [entries, pinned]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distance < 80);
  };

  const jumpToLatest = () => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setPinned(true);
  };

  return (
    <>
      <style>{CSS_TEXT}</style>
      <div className="cl-root">
        <div
          ref={scrollerRef}
          className="cl-scroller"
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          {entries.length === 0 ? (
            <div className="cl-empty">No messages yet — say hi 👋</div>
          ) : (
            entries.map((entry) => (
              <MessageBubble
                key={entry.id}
                message={entry.message}
                role={entry.role}
                onCommand={onCommand}
                onAction={onAction}
              />
            ))
          )}
        </div>

        {!pinned && entries.length > 0 && (
          <button type="button" className="cl-jump" onClick={jumpToLatest} aria-label="Jump to latest message">
            <span>Jump to latest</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        )}
      </div>
    </>
  );
};

const CSS_TEXT = `
.cl-root { position:relative; display:flex; flex-direction:column; min-height:0; flex:1; }
.cl-root * { box-sizing:border-box; }

.cl-scroller {
  display:flex; flex-direction:column; gap:6px;
  padding:16px 14px 10px;
  overflow-y:auto;
  overscroll-behavior:contain;
  scroll-behavior:smooth;
  scrollbar-width:thin;
  min-height:0; flex:1;
}
.cl-scroller::-webkit-scrollbar { width:8px; }
.cl-scroller::-webkit-scrollbar-thumb {
  background:rgba(148,163,184,.35); border-radius:4px;
}
.cl-scroller::-webkit-scrollbar-thumb:hover { background:rgba(148,163,184,.55); }
.cl-scroller::-webkit-scrollbar-track { background:transparent; }

/* subtle divider between consecutive bubbles handled by bubble margin */
.cl-scroller > * + * { margin-top:2px; }

.cl-empty {
  align-self:center; margin:auto;
  padding:24px 16px;
  font-size:13.5px; text-align:center;
  color:#94a3b8;
}
@media (prefers-color-scheme: dark) { .cl-empty { color:#64748b; } }

.cl-jump {
  position:absolute; left:50%; bottom:14px;
  transform:translateX(-50%);
  display:inline-flex; align-items:center; gap:6px;
  padding:8px 14px; border-radius:999px;
  border:1px solid rgba(99,102,241,.35);
  background:rgba(255,255,255,.9);
  color:#4f46e5;
  font-size:12.5px; font-weight:600; font-family:inherit;
  cursor:pointer; backdrop-filter:blur(10px);
  box-shadow:0 6px 20px -8px rgba(15,23,42,.4);
  transition:transform .16s, box-shadow .18s, background .18s;
  animation:cl-pop .25s cubic-bezier(.34,1.4,.5,1) both;
}
.cl-jump:hover { background:#fff; box-shadow:0 8px 26px -8px rgba(15,23,42,.5); }
.cl-jump:active { transform:translateX(-50%) scale(.95); }
.cl-jump svg { display:block; }

@media (prefers-color-scheme: dark) {
  .cl-jump {
    background:rgba(30,41,59,.9);
    border-color:rgba(129,140,248,.35);
    color:#a5b4fc;
    box-shadow:0 6px 20px -8px rgba(0,0,0,.6);
  }
  .cl-jump:hover { background:rgba(30,41,59,1); }
}

@media (prefers-reduced-motion: reduce) {
  .cl-scroller { scroll-behavior:auto; }
  .cl-jump { animation:none; }
}

@keyframes cl-pop {
  from { opacity:0; transform:translate(-50%, 8px); }
  to   { opacity:1; transform:translate(-50%, 0); }
}
`;