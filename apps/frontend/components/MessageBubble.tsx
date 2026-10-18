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

const decodeEntities = (text: string): string => text.replace(
  /&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
  (entity, value: string) => {
    if (value[0] === "#") {
      const hexadecimal = value[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(value.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
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
    return createElement(node.tag, { key }, children);
  });

export const MessageBubble = ({ message, role, onCommand, onAction }: MessageBubbleProps) => (
  <div className={`msg ${role === "outbound" ? "out" : ""}`}>
    {message.format === "html"
      ? renderRichNodes(parseRichText(message.text), onCommand)
      : renderPlainText(message.text, onCommand, "plain")}
    {message.kind === "interaction" && <InteractionButtons actions={message.actions} onPick={onAction} />}
  </div>
);