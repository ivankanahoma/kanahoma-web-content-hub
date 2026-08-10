// Character to HTML entity conversion, shared by the source parser and the renderer.
//
// Kept apart from both so the renderer can be tested in Node without pulling in the
// browser-only document parsing.

const ENTITIES = [
  ["’", "&rsquo;"],
  ["‘", "&lsquo;"],
  ["“", "&ldquo;"],
  ["”", "&rdquo;"],
  ["–", "&ndash;"],
  ["—", "&mdash;"],
  ["®", "&reg;"],
];

/**
 * Ampersands go first, and only when they are not already the start of an entity, so
 * running this over text that has been through it once cannot produce `&amp;amp;`.
 */
export function toEntities(text) {
  let out = String(text ?? "").replace(
    /&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,10}|#\d{1,6}|#x[0-9a-fA-F]{1,6});)/g,
    "&amp;",
  );
  for (const [char, entity] of ENTITIES) out = out.split(char).join(entity);
  return out.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
