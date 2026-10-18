import { describe, expect, it } from "vitest";
import { escapeHtml } from "@anonymous-chat/shared/rich-text";
import { htmlToPlainText } from "../src/infrastructure/channels/html-text.js";

describe("shared rich text", () => {
  it("escapes user-provided text before including it in HTML messages", () => {
    expect(escapeHtml("<b>hello & goodbye</b>")).toBe("&lt;b&gt;hello &amp; goodbye&lt;/b&gt;");
  });

  it("converts supported HTML text to readable plain text", () => {
    expect(htmlToPlainText("<b>Hello</b><br><p>Tom &amp; Jo</p><ul><li>One</li><li>Two</li></ul>"))
      .toBe("Hello\nTom & Jo\n• One\n• Two");
  });
});
