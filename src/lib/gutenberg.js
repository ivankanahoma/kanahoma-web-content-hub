// Renders a node list into CUI's Gutenberg block markup.
//
// Every attribute shape here is copied from markup the client has already approved, not
// inferred from the design system. Nothing in this file calls a model: the text arrives
// as nodes and leaves as nodes wrapped in blocks, so the author's prose cannot be
// rewritten on the way through.
//
// Two details that break a naive implementation:
//
//  1. `--` is illegal inside an HTML comment, so WordPress writes it as `--`
//     inside block attributes. Those six characters have to survive to the output
//     literally. They are not escapes JavaScript should ever decode.
//  2. An unused `pad` or `mar` in `kanahomaResp` is an empty *array*, not an object.
//     That is what the editor emits, and matching it keeps round-tripping clean.

import { toEntities } from "./entities.js";

/** Longest visible bio before the rest collapses. Reproduces both reference articles:
 *  a 690-character bio stays whole, and a 913-character opener collapses the rest. */
export const BIO_VISIBLE_LIMIT = 1000;

const sp = (step) => `var(--wp--preset--spacing--${step})`;

/**
 * JSON for a block comment. Runs of hyphens are escaped after serialisation, which is
 * what keeps `gold-500` readable while `var(--wp--preset--spacing--20)` is escaped: only
 * a doubled hyphen would terminate the comment early.
 */
export function serializeAttrs(obj) {
  return JSON.stringify(obj).replace(/-{2,}/g, (run) => "\\u002d".repeat(run.length));
}

/** Gutenberg's own serialisation: comment, newline, HTML, newline, closing comment. */
function block(name, attrs, inner) {
  const open = attrs && Object.keys(attrs).length
    ? `<!-- wp:${name} ${serializeAttrs(attrs)} -->`
    : `<!-- wp:${name} -->`;
  return `${open}\n${inner}\n<!-- /wp:${name} -->`;
}

/** Children sit inside the parent's HTML with no added whitespace, and are separated
 *  from each other by a blank line. */
const nest = (children) => children.filter(Boolean).join("\n\n");

// --- Headings ---------------------------------------------------------------

const HEADING_STYLE = {
  border: { radius: "0px", width: "0px", style: "none" },
  elements: { link: { color: { text: "var:preset|color|primary" } } },
  spacing: { margin: { top: "0", bottom: "0" } },
  typography: {
    fontStyle: "normal",
    fontWeight: "600",
    lineHeight: "1.2",
    letterSpacing: "0%",
  },
  layout: { selfStretch: "fit", flexSize: null },
};

const HEADING_TOP_MARGIN = {
  pad: [],
  mar: {
    desktop: { top: sp(20) },
    mobile: { top: sp(20) },
    tablet: { top: sp(20) },
  },
};

/**
 * Section headings carry the H3 (Styled) treatment as a real `<h2>`, deliberately without
 * `metadata` or `patternName`: the level differs from the source pattern, so keeping the
 * reference would both misrepresent it and risk the edit syncing to every other page.
 */
function heading(level, innerHtml) {
  const isSub = level === 3;
  const attrs = {
    ...(isSub ? { level: 3 } : {}),
    kanahomaResp: HEADING_TOP_MARGIN,
    style: HEADING_STYLE,
    textColor: "primary",
    ...(isSub
      ? { fontSize: "medium", fontFamily: "source-serif-4" }
      : { fontSize: "large" }),
  };

  const classes = [
    "wp-block-heading",
    "has-primary-color",
    "has-text-color",
    "has-link-color",
    ...(isSub ? ["has-source-serif-4-font-family", "has-medium-font-size"] : []),
    ...(isSub ? [] : ["has-large-font-size"]),
  ].join(" ");

  const style = "border-style:none;border-width:0px;border-radius:0px;margin-top:0;" +
    "margin-bottom:0;font-style:normal;font-weight:600;letter-spacing:0%;line-height:1.2";

  return block(
    "heading",
    attrs,
    `<h${level} class="${classes}" style="${style}">${innerHtml}</h${level}>`,
  );
}

// --- Body -------------------------------------------------------------------

const paragraph = (innerHtml) => block("paragraph", null, `<p>${innerHtml}</p>`);

/** The series note or standfirst above the article. */
const standfirst = (innerHtml) => block(
  "paragraph",
  { style: { typography: { fontStyle: "italic", fontWeight: "400" } } },
  `<p style="font-style:italic;font-weight:400">${innerHtml}</p>`,
);

function list({ ordered, items }) {
  const inner = nest(items.map((i) =>
    block("list-item", null, `<li>${i.html}</li>`)));
  return block(
    "list",
    ordered ? { ordered: true } : null,
    `<${ordered ? "ol" : "ul"} class="wp-block-list">${inner}</${ordered ? "ol" : "ul"}>`,
  );
}

/** Green serif italic on white with a gold rule down the left. */
function pullQuote(innerHtml) {
  const attrs = {
    metadata: { name: "Pull Quote" },
    kanahomaResp: {
      pad: {
        desktop: { top: sp(30), bottom: sp(30), left: sp(40), right: sp(40) },
        mobile: { top: sp(20), bottom: sp(20), left: sp(20), right: sp(20) },
      },
      mar: {
        desktop: { top: sp(30), bottom: sp(30) },
        mobile: { top: sp(20), bottom: sp(20) },
      },
    },
    style: {
      border: {
        left: { color: "var:preset|color|gold-500", width: "3px" },
        top: { width: "0px", style: "none" },
        right: { width: "0px", style: "none" },
        bottom: { width: "0px", style: "none" },
      },
    },
    layout: { type: "constrained" },
  };

  const quote = block(
    "paragraph",
    {
      style: { typography: { fontStyle: "italic", fontWeight: "600", lineHeight: "1.4" } },
      textColor: "primary",
      fontSize: "h-4",
      fontFamily: "source-serif-4",
    },
    '<p class="has-primary-color has-text-color has-source-serif-4-font-family ' +
    `has-h-4-font-size" style="font-style:italic;font-weight:600;line-height:1.4">` +
    `${innerHtml}</p>`,
  );

  const style = "border-top-style:none;border-top-width:0px;border-right-style:none;" +
    "border-right-width:0px;border-bottom-style:none;border-bottom-width:0px;" +
    "border-left-color:var(--wp--preset--color--gold-500);border-left-width:3px";

  return block("group", attrs, `<div class="wp-block-group" style="${style}">${quote}</div>`);
}

// --- Author bio card --------------------------------------------------------

/** Paragraphs inside the card carry the contrast/body recipe the pattern expects, which
 *  body paragraphs deliberately do not. */
const bioParagraph = (innerHtml) => block(
  "paragraph",
  {
    style: {
      elements: { link: { color: { text: "var:preset|color|contrast" } } },
      typography: { fontStyle: "normal", fontWeight: "400" },
    },
    textColor: "contrast",
    fontSize: "body",
  },
  '<p class="has-contrast-color has-text-color has-link-color has-body-font-size" ' +
  `style="font-style:normal;font-weight:400">${innerHtml}</p>`,
);

/**
 * Split a bio so the visible part stays under the limit. At least one paragraph is always
 * visible, and a bio that fits entirely gets no Read More at all.
 */
export function splitBio(paragraphs, limit = BIO_VISIBLE_LIMIT) {
  const visible = [];
  let used = 0;
  for (const p of paragraphs) {
    const length = (p.text ?? p.html ?? "").length;
    if (visible.length && used + length > limit) break;
    visible.push(p);
    used += length;
  }
  return { visible, hidden: paragraphs.slice(visible.length) };
}

function readMore(paragraphs) {
  const attrs = {
    style: {
      spacing: {
        padding: { top: "0", bottom: "0", left: "0", right: "0" },
        margin: { bottom: "var:preset|spacing|50" },
      },
      elements: { link: { color: { text: "var:preset|color|primary" } } },
      typography: { fontStyle: "normal", fontWeight: "600" },
    },
    textColor: "primary",
    fontSize: "small",
    fontFamily: "source-serif-4",
  };
  const style = "margin-bottom:var(--wp--preset--spacing--50);padding-top:0;" +
    "padding-right:0;padding-bottom:0;padding-left:0;font-style:normal;font-weight:600";

  return block(
    "details",
    attrs,
    '<details class="wp-block-details has-primary-color has-text-color has-link-color ' +
    `has-source-serif-4-font-family has-small-font-size" style="${style}">` +
    `<summary>Read More</summary>${nest(paragraphs.map((p) => bioParagraph(p.html)))}` +
    "</details>",
  );
}

export const PHOTO_PLACEHOLDER = "REPLACE-media-library-url";

/**
 * The Staff Card + Text pattern, expanded rather than referenced. A synced block cannot
 * carry a different photo per article, and the photo changes every time.
 *
 * The `id` is left off on purpose. An invented media library id points at someone else's
 * file or at nothing, and the block breaks either way.
 */
function staffCard({ name, role, slug, paragraphs }) {
  const { visible, hidden } = splitBio(paragraphs);

  const photo = block(
    "group",
    {
      kanahomaResp: {
        pad: { mobile: { bottom: "25rem", left: "" }, tablet: { right: "", left: "", bottom: "" } },
        mar: [],
      },
      className: "is-style-default",
      style: {
        border: {
          radius: { topLeft: "16px", topRight: "0px", bottomLeft: "16px", bottomRight: "0px" },
          width: "1px",
          color: "#FDB724",
        },
        background: {
          backgroundImage: {
            url: `${PHOTO_PLACEHOLDER}/${slug}-profile.webp`,
            source: "file",
            title: `${slug}-profile`,
          },
          backgroundSize: "cover",
        },
      },
      layout: { type: "constrained" },
    },
    '<div class="wp-block-group is-style-default has-border-color" ' +
    'style="border-color:#FDB724;border-width:1px;border-top-left-radius:16px;' +
    'border-top-right-radius:0px;border-bottom-left-radius:16px;' +
    'border-bottom-right-radius:0px"></div>',
  );

  const nameHeading = block(
    "heading",
    {
      level: 3,
      style: HEADING_STYLE,
      textColor: "primary",
      fontSize: "medium",
      fontFamily: "source-serif-4",
    },
    '<h3 class="wp-block-heading has-primary-color has-text-color has-link-color ' +
    'has-source-serif-4-font-family has-medium-font-size" style="border-style:none;' +
    "border-width:0px;border-radius:0px;margin-top:0;margin-bottom:0;font-style:normal;" +
    `font-weight:600;letter-spacing:0%;line-height:1.2">${toEntities(name)}</h3>`,
  );

  const roleParagraph = role
    ? block(
      "paragraph",
      {
        className: "has-contrast-color has-text-color has-link-color",
        style: {
          border: { radius: "0px" },
          typography: {
            lineHeight: "1.5", fontStyle: "normal", fontWeight: "700", textAlign: "left",
          },
          elements: { link: { color: { text: "var:preset|color|contrast" } } },
        },
        textColor: "contrast",
        fontSize: "body",
      },
      '<p class="has-text-align-left has-contrast-color has-text-color has-link-color ' +
      'has-body-font-size" style="border-radius:0px;font-style:normal;font-weight:700;' +
      `line-height:1.5">${toEntities(role)}</p>`,
    )
    : null;

  const textColumn = block(
    "group",
    {
      kanahomaResp: {
        pad: {
          desktop: { left: "", right: "", top: sp(20), bottom: sp(20) },
          tablet: { right: "", left: "", bottom: "", top: sp(30) },
          mobile: { right: sp(20), left: sp(20), bottom: "" },
        },
        mar: [],
      },
      style: {
        spacing: {
          blockGap: "var:preset|spacing|10",
          padding: { left: "0", right: "var:preset|spacing|30", top: "0", bottom: "0" },
          margin: { top: "0", bottom: "0" },
        },
        border: { radius: "16px" },
      },
      backgroundColor: "base",
      layout: { type: "flex", orientation: "vertical", justifyContent: "left" },
    },
    '<div class="wp-block-group has-base-background-color has-background" ' +
    'style="border-radius:16px;margin-top:0;margin-bottom:0;padding-top:0;' +
    'padding-right:var(--wp--preset--spacing--30);padding-bottom:0;padding-left:0">' +
    nest([
      nameHeading,
      roleParagraph,
      ...visible.map((p) => bioParagraph(p.html)),
      hidden.length ? readMore(hidden) : null,
    ]) +
    "</div>",
  );

  const columns = block(
    "columns",
    { kanahomaEqualHeight: true },
    '<div class="wp-block-columns">' +
    nest([
      block("column", { width: "25%" },
        `<div class="wp-block-column" style="flex-basis:25%">${photo}</div>`),
      block("column", { width: "75%" },
        `<div class="wp-block-column" style="flex-basis:75%">${textColumn}</div>`),
    ]) +
    "</div>",
  );

  return block(
    "group",
    {
      metadata: {
        name: "Staff Card + Text",
        categories: [9],
        patternName: "core/block/16389",
      },
      kanahomaResp: {
        pad: [],
        mar: {
          mobile: { bottom: sp(50), top: sp(50) },
          tablet: { bottom: sp(50), top: sp(50) },
          desktop: { bottom: sp(60), top: sp(60) },
        },
      },
      style: { border: { radius: "16px", width: "1px" } },
      borderColor: "gold-500",
      layout: { type: "constrained" },
    },
    '<div class="wp-block-group has-border-color has-gold-500-border-color" ' +
    `style="border-width:1px;border-radius:16px">${columns}</div>`,
  );
}

export const slugify = (name) => String(name ?? "author")
  .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "author";

// --- Assembly ---------------------------------------------------------------

/**
 * `analysis` carries indices into `nodes`, never text. Anything it does not claim is a
 * body paragraph, which is what keeps an unrecognised section in the article rather than
 * silently dropped.
 */
export function renderArticle(nodes, analysis = {}) {
  const standfirstIndex = analysis.standfirst ?? null;
  const bios = analysis.authorBios ?? [];

  // `from`..`to` covers the whole bio section, name and role lines included, so those
  // never also appear as body paragraphs. `proseFrom` is where the prose starts.
  const claimed = new Set();
  for (const bio of bios) {
    for (let i = bio.from; i <= bio.to; i++) claimed.add(i);
  }

  const body = [];
  nodes.forEach((node, index) => {
    if (claimed.has(index)) return;

    if (index === standfirstIndex && node.type === "paragraph") {
      body.push(standfirst(node.html));
      return;
    }
    if (node.type === "heading") { body.push(heading(node.level, node.html)); return; }
    if (node.type === "list") { body.push(list(node)); return; }
    if (node.type === "quote") { body.push(pullQuote(node.html)); return; }
    body.push(paragraph(node.html));
  });

  for (const bio of bios) {
    const paragraphs = nodes
      .slice(bio.proseFrom ?? bio.from, bio.to + 1)
      .filter((n) => n.type === "paragraph");
    body.push(staffCard({
      name: bio.name,
      role: bio.role,
      slug: slugify(bio.name),
      paragraphs,
    }));
  }

  return body.join("\n\n") + "\n";
}

// --- Validation -------------------------------------------------------------

const PAIRS = ["group", "columns", "column", "list", "list-item", "paragraph", "heading",
               "details"];
const TOKENS = new Set(["body", "h-1", "h-2", "h-3", "h-4", "h-5", "h-6", "large",
                        "medium", "small"]);

/**
 * Structural assertions, run on the finished string rather than trusted from the code
 * that produced it. Unbalanced markup pasted into WordPress corrupts the post silently.
 */
export function validate(markup) {
  const problems = [];

  for (const name of PAIRS) {
    const open = (markup.match(new RegExp(`<!-- wp:${name} [^>]*-->|<!-- wp:${name} -->`, "g")) ?? []).length;
    const close = (markup.match(new RegExp(`<!-- /wp:${name} -->`, "g")) ?? []).length;
    if (open !== close) problems.push(`wp:${name} opens ${open} times, closes ${close}`);
  }

  for (const [tag] of [["div"], ["li"], ["details"]]) {
    const open = (markup.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;
    const close = (markup.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
    if (open !== close) problems.push(`<${tag}> opens ${open} times, closes ${close}`);
  }

  for (const m of markup.matchAll(/"fontSize":"([^"]+)"/g)) {
    if (!TOKENS.has(m[1])) problems.push(`fontSize "${m[1]}" is not a design token`);
  }
  for (const m of markup.matchAll(/"fontFamily":"([^"]+)"/g)) {
    if (!["source-serif-4", "source-sans-3"].includes(m[1])) {
      problems.push(`fontFamily "${m[1]}" is not one of the two allowed families`);
    }
  }

  if (/<li>(?![\s\S]*?<\/li>)/.test(markup) === false) {
    const stray = markup.split("<li>").length - 1 -
      (markup.match(/<!-- wp:list-item -->/g) ?? []).length;
    if (stray !== 0) problems.push(`${stray} <li> outside a wp:list-item block`);
  }

  const levels = [...markup.matchAll(/<h([23])\b/g)].map((m) => Number(m[1]));
  // The post title is the H1, so the body may only start at H2.
  if (levels[0] === 3) problems.push("the article starts at H3, which skips a level");

  return problems;
}
