// Cleaning up what a contenteditable produced.
//
// The composer is a contenteditable div, so whatever the browser built on paste, on
// autocorrect, or from a drag out of Word arrives here. Only the tags a note actually
// needs survive, and the only attribute that lives through it is a plain http(s)/mailto
// href. Kept apart from the function so it can be tested without deploying anything.

const ALLOWED = new Set([
  "a", "b", "strong", "i", "em", "u", "br", "div", "p", "ul", "ol", "li",
]);

export function sanitizeNoteHtml(html: string): string {
  const withoutBlocks = String(html ?? "")
    // Drop these whole, contents included: a stripped <script> tag would otherwise leave
    // its body behind as text.
    .replace(/<\s*(script|style|iframe|object|embed|svg)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|svg)\b[^>]*\/?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  return withoutBlocks.replace(
    /<\s*(\/?)\s*([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (_whole, closing: string, rawTag: string, attrs: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED.has(tag)) return "";
      if (closing) return `</${tag}>`;
      if (tag !== "a") return `<${tag}>`;

      const href = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const url = (href?.[2] ?? href?.[3] ?? href?.[4] ?? "").trim();
      // Anything that is not plainly a web or mail address loses its href rather than
      // the note losing the text: javascript: and data: never reach Zendesk.
      if (!/^(https?:\/\/|mailto:)/i.test(url)) return "<a>";
      return `<a href="${url.replace(/"/g, "&quot;")}" rel="noreferrer noopener">`;
    },
  );
}

/** Plain text of a note, for the mirrored comment row and for emptiness checks. */
export function noteText(html: string): string {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    // The closing tag becomes the newline and the next opening tag becomes a space, so
    // without this every line after the first starts indented.
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
