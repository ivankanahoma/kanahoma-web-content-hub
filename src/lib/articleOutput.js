// The second half of a generated article: everything that does not live in the content
// area, plus the list of things a human still has to do.
//
// The block markup fills the editor. The excerpt, the SEO fields and the featured image
// all live elsewhere in the WordPress admin, and an article published without them looks
// broken in the places nobody checks: the archive cards and the news feed.

import { PHOTO_PLACEHOLDER, slugify } from "./gutenberg.js";

const FEATURED_IMAGE =
  "The featured image must be 1425 x 450 px, .webp. If the article supplies an image at\n" +
  "another size, resize and convert it before uploading. If no image is supplied, the\n" +
  "article cannot be published without one.";

const SEO_INSTRUCTION =
  "Paste these into the Meta Boxes, found below the content area in the post editor.";

const CHECKLIST = [
  "Post title set (this becomes the H1; the body markup has no title)",
  "Template set to Articles in the post sidebar",
  "Excerpt filled (value provided above)",
  "At least one Category selected",
  "Featured image uploaded at 1425 x 450 .webp",
  "SEO fields filled in Meta Boxes, if provided",
  "Author photo replaced in the staff card, if the article has an author bio",
  "Any # placeholder links replaced",
];

const rule = (label) => `${label}\n${"-".repeat(label.length)}`;

export function buildCompanionFields({ title, analysis, bios }) {
  const seo = analysis.seoFound && analysis.seo
    ? [
      SEO_INSTRUCTION,
      "",
      `Meta title:        ${analysis.seo.metaTitle || "(not in the source)"}`,
      `Meta description:  ${analysis.seo.metaDescription || "(not in the source)"}`,
      `Focus keyphrase:   ${analysis.seo.focusKeyphrase || "(not in the source)"}`,
      `Canonical URL:     ${analysis.seo.canonicalUrl || "(not in the source)"}`,
    ]
    : [
      "The source contains no SEO metadata, so none is provided here. These have to be",
      "written from scratch before publishing. They are not generated: an invented meta",
      "description is worse than an empty one, because nobody goes back to check it.",
    ];

  const photos = bios.length
    ? bios.map((b) => `  ${PHOTO_PLACEHOLDER}/${slugify(b.name)}-profile.webp`)
    : ["  No author bio in this article, so no photo to replace."];

  return [
    rule(`ARTICLE FIELDS${title ? `: ${title}` : ""}`),
    "",
    rule("EXCERPT"),
    "Goes in the Excerpt panel of the post sidebar. Leaving it empty makes WordPress fall",
    "back to the first 55 words of the body, which usually starts mid-thought.",
    "",
    analysis.excerpt || "(the source had no usable opening sentence)",
    "",
    "",
    rule("SEO"),
    ...seo,
    "",
    "",
    rule("FEATURED IMAGE"),
    FEATURED_IMAGE,
    "",
    "",
    rule("AUTHOR PHOTO"),
    "The staff card carries a placeholder URL. Upload the photo and replace it:",
    ...photos,
    "",
    "",
    rule("PUBLISHING CHECKLIST"),
    ...CHECKLIST.map((item) => `[ ] ${item}`),
    "",
  ].join("\n");
}

/**
 * What the editor has to look at before publishing. Only what applies: a flag list that
 * always says the same eight things stops being read.
 */
export function buildFlags({ analysis, nodes, bios, warnings, appliedTypos, links,
                             problems }) {
  const flags = [];

  for (const problem of problems ?? []) {
    flags.push({ level: "error", text: `Markup validation: ${problem}` });
  }
  for (const warning of warnings ?? []) {
    flags.push({ level: "warn", text: warning });
  }

  if (!bios.length) {
    flags.push({
      level: "warn",
      text: "No author bio was found, so the article ends without a staff card. Add one " +
        "by hand if the article should have it.",
    });
  }
  for (const bio of bios) {
    flags.push({
      level: "action",
      text: `Author photo is a placeholder: ${PHOTO_PLACEHOLDER}/` +
        `${slugify(bio.name)}-profile.webp. Upload the real photo and replace the URL.`,
    });
    if (!bio.role) {
      flags.push({
        level: "warn",
        text: `No role was given for ${bio.name}, so the card has none. ` +
          "It was not guessed.",
      });
    }
  }

  for (const typo of appliedTypos ?? []) {
    flags.push({
      level: "info",
      text: `Typo corrected in block ${typo.index}: "${typo.find}" became ` +
        `"${typo.replace}" (${typo.why}).`,
    });
  }

  const placeholders = (links ?? []).filter((h) => !h || h === "#").length;
  if (placeholders) {
    flags.push({
      level: "action",
      text: `${placeholders} link${placeholders === 1 ? "" : "s"} point nowhere and were ` +
        "left as #. Replace them before publishing.",
    });
  }

  if (!nodes.some((n) => n.type === "heading")) {
    flags.push({
      level: "warn",
      text: "The source has no section headings, so the article has none. Headings were " +
        "not invented; add them in the editor if it needs them.",
    });
  }

  // Three block types appear in no published CUI article. They are built from valid
  // tokens, but nothing in production proves the theme styles them as expected.
  const unprecedented = [
    nodes.some((n) => n.type === "list") && "lists",
    nodes.some((n) => n.type === "heading" && n.level === 3) && "sub-headings (H3)",
  ].filter(Boolean);
  if (unprecedented.length) {
    flags.push({
      level: "warn",
      text: `This article uses ${unprecedented.join(" and ")}, which appear in no ` +
        "published CUI article. Check them in a draft preview before publishing.",
    });
  }

  if (!analysis.seoFound) {
    flags.push({
      level: "action",
      text: "No SEO metadata in the source. Meta title and description have to be " +
        "written before publishing.",
    });
  }

  for (const note of analysis.notes ?? []) {
    flags.push({ level: "info", text: note });
  }

  return flags;
}

/**
 * Corrections arrive as find/replace pairs rather than rewritten paragraphs, so a model
 * that tries to improve the prose cannot: anything it did not name exactly is skipped.
 */
export function applyTypos(nodes, typos = []) {
  const applied = [];
  const next = nodes.map((n) => ({ ...n }));

  for (const typo of typos) {
    const node = next[typo.index];
    if (!node || !node.html?.includes(typo.find)) continue;
    node.html = node.html.split(typo.find).join(typo.replace);
    node.text = (node.text ?? "").split(typo.find).join(typo.replace);
    applied.push(typo);
  }

  return { nodes: next, applied };
}
