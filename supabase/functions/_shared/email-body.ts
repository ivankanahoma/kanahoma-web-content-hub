// Trimming a ticket comment down to what somebody actually wrote.
//
// Lives here rather than in src/ because both sides need it: the row shows the trimmed
// text, and the enrichment sends it. Duplicating the rules would mean the model and the
// reader could disagree about what a message says.
//
// Most comments arrive by email, so they carry the whole reply chain and a signature
// block behind the two useful sentences. A ticket where the last message is 1,000
// characters of which 90% is quoted history is a ticket you stop reading.
//
// Nothing is discarded: the full text stays in the database and the row offers to show
// it. This only decides what to put in front of you first, so a rule that is too keen
// costs a click, not a message.

/** A quoted reply chain starts here. */
const ORIGINAL_MESSAGE = /^-{2,}\s*(original message|forwarded message)\s*-{2,}/i;
const ON_WROTE = /^on\b.{5,120}\bwrote:\s*$/i;
const QUOTE_MARKER = /^>/;
const HEADER_FROM = /^from:\s*\S/i;
const HEADER_FOLLOW = /^(date|sent|to|cc|subject):\s*/i;

/** Legal boilerplate every CUI email carries. */
const FOOTER = [
  /^(notice|confidentiality|disclaimer)\b/i,
  /this (e-?mail|message)(\s+and\s+any)?.{0,60}(is intended|may contain|confidential)/i,
  /if you (have\s+)?received this (e-?mail|message) in error/i,
];

const SIGN_OFF =
  /^(thanks|thank you|many thanks|regards|kind regards|best regards|best|cheers|sincerely|warm regards|talk soon)[\s,!.–-]*$/i;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE = /(?:\+?\d[\d\s().-]{7,})\d/;
const DOMAIN = /^(?:https?:\/\/|www\.)|^[a-z0-9-]+\.(?:com|edu|org|net|gov)\b/i;
const STREET = /\d{1,6}\s+\S.{0,40}\b(rd|road|st|street|ave|avenue|blvd|dr|drive|suite|ste|way|ln|lane)\b/i;
const CITY_STATE_ZIP = /,\s*[A-Z]{2}\s*\|?\s*\d{5}/;

/** A line that is contact details rather than something someone said. */
function isContactLine(line: string) {
  const t = line.trim();
  if (!t) return false;
  if (EMAIL.test(t) || DOMAIN.test(t)) return true;
  if (STREET.test(t) || CITY_STATE_ZIP.test(t)) return true;
  // A bare phone number, but not a sentence that happens to contain one.
  if (PHONE.test(t) && t.replace(PHONE, "").replace(/[|,\s]/g, "").length <= 12) return true;
  return false;
}

/** Where the quoted chain begins, or -1. */
function quotedStart(lines: string[]) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (ORIGINAL_MESSAGE.test(line) || ON_WROTE.test(line) || QUOTE_MARKER.test(line)) {
      return i;
    }
    // "From:" alone is too common in prose. It only counts as a header when the lines
    // that follow look like the rest of one.
    if (HEADER_FROM.test(line)) {
      const near = lines.slice(i + 1, i + 6).map((l) => l.trim()).filter(Boolean);
      if (near.some((l) => HEADER_FOLLOW.test(l))) return i;
    }
  }
  return -1;
}

/**
 * Where the signature begins, or -1. A sign-off only counts when what follows it looks
 * like contact details, so "Thanks!" in the middle of a sentence-long message survives.
 */
function signatureStart(lines: string[]) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!SIGN_OFF.test(lines[i].trim())) continue;
    const after = lines.slice(i + 1).map((l) => l.trim()).filter(Boolean);
    if (after.length && after.some(isContactLine)) return i + 1;
  }
  return -1;
}

export function trimComment(raw: string) {
  const original = String(raw ?? "");
  let lines = original.split("\n");

  const quoted = quotedStart(lines);
  if (quoted >= 0) lines = lines.slice(0, quoted);

  const footer = lines.findIndex((l) => FOOTER.some((rx) => rx.test(l.trim())));
  if (footer >= 0) lines = lines.slice(0, footer);

  const signature = signatureStart(lines);
  if (signature >= 0) lines = lines.slice(0, signature);

  // Whatever is left, drop trailing contact lines: a signature with no sign-off above it.
  while (lines.length && (!lines.at(-1).trim() || isContactLine(lines.at(-1)))) {
    lines.pop();
  }

  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // Never hand back nothing. If the rules ate the whole message they were wrong about
  // it, and the raw text is better than an empty box.
  if (!text) return { text: original.trim(), trimmed: false };

  return { text, trimmed: text.length < original.trim().length };
}
