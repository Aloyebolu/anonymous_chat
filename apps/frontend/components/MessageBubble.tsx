"use client";
import { createElement, type ReactNode } from "react";
import { InteractionButtons } from "./InteractionButtons";
import { STRINGS } from "@/lib/constants";
import type { WebOutboundMessage as OutboundMessage } from "@anonymous-chat/shared/contracts";

export interface MessageBubbleProps {
  readonly message: OutboundMessage;
  readonly role: "inbound" | "outbound";
  readonly onCommand: (command: string) => void;
  readonly onAction: (action: { id: string; label: string }) => void;
}

type RichTag = "b" | "strong" | "i" | "em" | "u" | "ins" | "s" | "strike" | "del" | "code" | "pre" | "blockquote" | "p" | "ul" | "ol" | "li" | "a" | "br";
type RichNode = { readonly text: string } | { readonly tag: RichTag; readonly href?: string; readonly children: RichNode[] };
const ALLOWED_TAGS = new Set<RichTag>(["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "code", "pre", "blockquote", "p", "ul", "ol", "li", "a", "br"]);
const safeMediaUrl = (url?: string): string | undefined => {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^data:(?:(?:image|video|audio)\/[\w.+-]+|application\/(?:pdf|octet-stream));base64,/i.test(url)) return url;
  return undefined;
};

const decodeEntities = (text: string): string => text.replace(
  /&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
  (entity, value: string) => {
    if (value[0] === "#") {
      const hexadecimal = value[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(value.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff &&
        !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    return ({ amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: "\"" })[value.toLowerCase()] ?? entity;
  }
);

const parseRichText = (text: string): readonly RichNode[] => {
  const root: { children: RichNode[] } = { children: [] };
  const stack: { tag: RichTag; children: RichNode[] }[] = [];
  const children = () => stack.at(-1)?.children ?? root.children;

  for (const token of text.split(/(<[^>]*>)/g).filter(Boolean)) {
    const match = token.match(/^<\s*(\/?)\s*([a-z][a-z0-9]*)([^>]*)>$/i);
    if (!match) {
      children().push({ text: decodeEntities(token) });
      continue;
    }
    const [, closing, rawTag, attributes] = match;
    const tag = rawTag.toLowerCase() as RichTag;
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index].tag === tag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const node: { tag: RichTag; href?: string; children: RichNode[] } = { tag, children: [] };
    if (tag === "a") {
      const href = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
      if (href && /^https?:\/\//i.test(decodeEntities(href))) node.href = decodeEntities(href);
    }
    children().push(node);
    if (tag !== "br" && !/\/\s*>$/.test(token)) stack.push(node);
  }
  return root.children;
};

const renderPlainText = (text: string, onCommand: (cmd: string) => void, keyPrefix: string): ReactNode[] => {
  const parts = text.split(/(\s+)/);
  return parts.map((part, index) => {
    if ((STRINGS.commands as readonly string[]).includes(part)) {
      return (
        <a key={`${keyPrefix}-${index}`} href="#" className="cmd" onClick={(e) => { e.preventDefault(); onCommand(part); }}>
          {part}
        </a>
      );
    }
    return <span key={`${keyPrefix}-${index}`}>{part}</span>;
  });
};

const renderRichNodes = (nodes: readonly RichNode[], onCommand: (cmd: string) => void, keyPrefix = "rich"): ReactNode[] =>
  nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if ("text" in node) return <span key={key}>{renderPlainText(node.text, onCommand, key)}</span>;
    const children = renderRichNodes(node.children, onCommand, key);
    if (node.tag === "a") {
      return node.href
        ? <a key={key} href={node.href} target="_blank" rel="noreferrer">{children}</a>
        : <span key={key}>{children}</span>;
    }
    if (node.tag === "br") return <br key={key} />;
    return createElement(node.tag, { key }, children);
  });

const DocumentIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
  </svg>
);

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);

export const MessageBubble = ({ message, role, onCommand, onAction }: MessageBubbleProps) => {
  const outbound = role === "outbound";
  const isMedia = message.kind === "media";
  const isInteraction = message.kind === "interaction";

  let body: ReactNode = null;
  if (isMedia) {
    const url = safeMediaUrl(message.media.url);
    const kind = message.media.kind;
    const media = message.media;

    body = (
      <div className="mb-media">
        {!url && (
          <div className="mb-media-fallback">
            <DocumentIcon />
            <span>{media.filename || "Attachment unavailable"}</span>
          </div>
        )}

        {url && (kind === "image" || kind === "sticker") && (
          <img
            className={`mb-media-preview${kind === "sticker" ? " mb-media-sticker" : ""}`}
            src={url}
            alt={message.caption || (kind === "sticker" ? "Shared sticker" : "Shared image")}
            loading="lazy"
          />
        )}

        {url && kind === "video" && (
          <video className="mb-media-preview mb-media-video" controls src={url} preload="metadata" />
        )}

        {url && (kind === "audio" || kind === "voice") && (
          <div className={`mb-media-audio${kind === "voice" ? " mb-media-voice" : ""}`}>
            <audio controls src={url} preload="metadata" />
          </div>
        )}

        {url && kind === "document" && (
          <a
            className="mb-media-doc"
            href={url}
            download={media.filename}
            target="_blank"
            rel="noreferrer"
          >
            <span className="mb-media-doc-icon"><DocumentIcon /></span>
            <span className="mb-media-doc-name">{media.filename || "Open attachment"}</span>
            <span className="mb-media-doc-action"><DownloadIcon /></span>
          </a>
        )}

        {message.caption && <p className="mb-caption">{message.caption}</p>}
      </div>
    );
  } else if (message.format === "html") {
    body = <div className="mb-text mb-rich">{renderRichNodes(parseRichText(message.text), onCommand)}</div>;
  } else {
    body = <div className="mb-text">{renderPlainText(message.text, onCommand, "plain")}</div>;
  }

  return (
    <>
      <style>{CSS_TEXT}</style>
      <div
        className={`mb-bubble${outbound ? " mb-out" : " mb-in"}${isMedia ? " mb-bubble-media" : ""}`}
      >
        {body}
        {isInteraction && (
          <div className="mb-actions">
            <InteractionButtons actions={message.actions} onPick={onAction} />
          </div>
        )}
      </div>
    </>
  );
};

const CSS_TEXT = `
.mb-bubble {
  position:relative;
  max-width:min(82%, 560px);
  padding:10px 14px;
  border-radius:18px;
  font-size:15px; line-height:1.45;
  color:#0f172a;
  background:#f1f5f9;
  border:1px solid rgba(15,23,42,.06);
  box-shadow:0 1px 2px rgba(15,23,42,.06);
  word-break:break-word; overflow-wrap:anywhere;
  animation:mb-in .26s cubic-bezier(.2,.9,.2,1) both;
}
.mb-bubble * { box-sizing:border-box; }
.mb-bubble-media { padding:6px; }
.mb-in  { align-self:flex-start; border-bottom-left-radius:6px; }
.mb-out {
  align-self:flex-end;
  color:#fff;
  background:linear-gradient(135deg,#6366f1,#4f46e5);
  border-color:rgba(79,70,229,.5);
  border-bottom-right-radius:6px;
  box-shadow:0 6px 18px -10px rgba(79,70,229,.75);
}

@media (prefers-color-scheme: dark) {
  .mb-in {
    color:#e2e8f0;
    background:#1e293b;
    border-color:rgba(148,163,184,.12);
  }
  .mb-out {
    background:linear-gradient(135deg,#6366f1,#4338ca);
    border-color:rgba(99,102,241,.5);
  }
}

.mb-text { white-space:pre-wrap; }
.mb-text a { color:inherit; text-decoration:underline; text-underline-offset:2px; }
.mb-in .mb-text a { color:#4f46e5; }
.mb-out .mb-text a { color:#e0e7ff; }

/* command chip */
.mb-text .cmd {
  display:inline-block;
  padding:1px 8px; border-radius:8px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:.92em; font-weight:600;
  text-decoration:none;
  background:rgba(99,102,241,.12); color:#4f46e5;
  transition:background .16s, color .16s;
}
.mb-text .cmd:hover { background:rgba(99,102,241,.22); }
.mb-out .mb-text .cmd { background:rgba(255,255,255,.18); color:#fff; }
.mb-out .mb-text .cmd:hover { background:rgba(255,255,255,.28); }
@media (prefers-color-scheme: dark) {
  .mb-in .mb-text .cmd { background:rgba(129,140,248,.16); color:#a5b4fc; }
  .mb-in .mb-text .cmd:hover { background:rgba(129,140,248,.26); }
}

/* rich text */
.mb-rich p { margin:0 0 .5em; }
.mb-rich p:last-child { margin-bottom:0; }
.mb-rich code {
  padding:1px 6px; border-radius:6px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:.9em;
  background:rgba(15,23,42,.07);
}
.mb-out .mb-rich code { background:rgba(255,255,255,.18); }
.mb-rich pre {
  margin:.5em 0; padding:10px 12px; border-radius:10px; overflow-x:auto;
  background:rgba(15,23,42,.07);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.88em;
}
.mb-out .mb-rich pre { background:rgba(0,0,0,.25); }
.mb-rich pre code { padding:0; background:none; }
.mb-rich blockquote {
  margin:.5em 0; padding:.15em 0 .15em 12px;
  border-left:3px solid rgba(99,102,241,.5);
  color:inherit; opacity:.85;
}
.mb-rich ul, .mb-rich ol { margin:.4em 0; padding-left:1.3em; }
.mb-rich li { margin:.15em 0; }

/* media */
.mb-media { display:flex; flex-direction:column; gap:6px; }
.mb-media-preview {
  display:block; width:100%; max-height:340px; object-fit:cover;
  border-radius:13px; background:rgba(15,23,42,.08);
}
.mb-media-video { object-fit:contain; background:#000; }
.mb-media-sticker {
  width:auto; max-width:160px; max-height:160px;
  background:transparent; object-fit:contain;
}
.mb-media-audio { padding:2px 4px; }
.mb-media-audio audio { width:100%; }
.mb-media-voice audio { width:100%; max-width:320px; }

.mb-media-doc {
  display:flex; align-items:center; gap:10px;
  padding:10px 12px; border-radius:12px;
  text-decoration:none; color:inherit;
  background:rgba(15,23,42,.06);
  transition:background .16s;
}
.mb-out .mb-media-doc { background:rgba(255,255,255,.16); }
.mb-media-doc:hover { background:rgba(15,23,42,.11); }
.mb-out .mb-media-doc:hover { background:rgba(255,255,255,.26); }
.mb-media-doc-icon {
  display:grid; place-items:center; flex:none;
  width:32px; height:32px; border-radius:9px;
  background:rgba(99,102,241,.16); color:#4f46e5;
}
.mb-out .mb-media-doc-icon { background:rgba(255,255,255,.22); color:#fff; }
.mb-media-doc-name {
  flex:1; min-width:0;
  font-size:13.5px; font-weight:600;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.mb-media-doc-action { display:grid; place-items:center; flex:none; opacity:.7; }

.mb-media-fallback {
  display:flex; align-items:center; gap:8px;
  padding:10px 12px; border-radius:12px;
  font-size:13px; font-weight:600;
  background:rgba(15,23,42,.06);
}
.mb-out .mb-media-fallback { background:rgba(255,255,255,.16); }

.mb-caption {
  margin:0; padding:2px 8px 6px;
  font-size:14px; line-height:1.4; white-space:pre-wrap;
}

/* actions */
.mb-actions { margin-top:10px; }

@media (prefers-reduced-motion: reduce) {
  .mb-bubble { animation:none; }
}
@keyframes mb-in {
  from { opacity:0; transform:translateY(6px) scale(.985); }
  to   { opacity:1; transform:none; }
}
`;