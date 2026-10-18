const ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\""
};

const decodeEntities = (text: string): string => text.replace(
  /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
  (entity, value: string) => {
    if (value[0] === "#") {
      const hexadecimal = value[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(value.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return ENTITIES[value] ?? entity;
  }
);

export const htmlToPlainText = (html: string): string => decodeEntities(
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|blockquote|pre|h[1-6])\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
).replace(/[ \t]+\n/g, "\n").trim();
