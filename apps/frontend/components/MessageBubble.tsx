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

export const MessageBubble = ({ message, role, onCommand, onAction }: MessageBubbleProps) => (
  <div className={`msg ${role === "outbound" ? "out" : ""}`}>
    {message.kind === "media" ? (
      <div className="chat-media">
        {(message.media.kind === "image" || message.media.kind === "sticker") && safeMediaUrl(message.media.url) && <img className="chat-media-preview" src={safeMediaUrl(message.media.url)} alt={message.caption || (message.media.kind === "sticker" ? "Shared sticker" : "Shared image")} />}
        {message.media.kind === "video" && safeMediaUrl(message.media.url) && <video className="chat-media-preview" controls src={safeMediaUrl(message.media.url)} />}
        {(message.media.kind === "audio" || message.media.kind === "voice") && safeMediaUrl(message.media.url) && <audio className="chat-media-audio" controls src={safeMediaUrl(message.media.url)} />}
        {message.media.kind === "document" && (
          safeMediaUrl(message.media.url)
            ? <a className="chat-media-document" href={safeMediaUrl(message.media.url)} download={message.media.filename} target="_blank" rel="noreferrer">{message.media.filename || "Open attachment"}</a>
            : <span>{message.media.filename || "Attachment unavailable"}</span>
        )}
        {message.caption && <p>{message.caption}</p>}
      </div>
    ) : message.format === "html"
      ? renderRichNodes(parseRichText(message.text), onCommand)
      : renderPlainText(message.text, onCommand, "plain")}
    {message.kind === "interaction" && <InteractionButtons actions={message.actions} onPick={onAction} />}
  </div>
);