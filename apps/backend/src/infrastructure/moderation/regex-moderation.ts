import type { ModerationResult, ModerationService } from "../../ports/moderation.js";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const URL = /\b(?:https?:\/\/|www\.)\S+/i;
const HANDLE = /(^|\s)@[A-Za-z0-9_.]{2,}/;
const PHONE =
  /(?:\+?\d[\d\s\-().]{7,}\d)|(?:\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b)/;
const OBFUSCATED_EMAIL = /\b[A-Z0-9._%+-]+\s*(?:\(?at\)?|@)\s*[A-Z0-9.-]+\s*(?:\(?dot\)?|\.)\s*[A-Z]{2,}\b/i;
const DIGIT_SPAM = /(?:\b\d\b[\s._-]*){7,}/;

const PATTERNS: { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: OBFUSCATED_EMAIL, label: "email" },
  { pattern: EMAIL, label: "email" },
  { pattern: URL, label: "url" },
  { pattern: HANDLE, label: "handle" },
  { pattern: PHONE, label: "phone" },
  { pattern: DIGIT_SPAM, label: "phone" }
];

export class RegexModerationService implements ModerationService {
  inspect(text: string): ModerationResult {
    let sanitized = text;
    let blocked = false;
    let reason: string | undefined;

    for (const { pattern, label } of PATTERNS) {
      if (pattern.test(sanitized)) {
        blocked = true;
        reason ??= label;
        sanitized = sanitized.replace(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"), "[removed]");
      }
    }
    return { blocked, reason, sanitized };
  }
}