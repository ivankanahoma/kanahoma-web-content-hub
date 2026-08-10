// Turns a source document into an ordered list of typed nodes.
//
// This runs entirely in the browser. A .docx never leaves the machine it was dropped on;
// only the extracted text is sent anywhere, and only to classify which parts of the
// article are what.
//
// The node list is the contract with everything downstream: the model labels nodes by
// index and the renderer turns them into blocks. Neither ever rewrites the text.

import mammoth from "mammoth";
import { marked } from "marked";
import { toEntities } from "./entities.js";

/** Inline tags that survive into the markup. Everything else is unwrapped. */
const KEEP_INLINE = new Set(["STRONG", "B", "EM", "I", "SUP", "SUB", "A"]);

function serializeInline(node, links) {
  let out = "";
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      out += toEntities(child.data);
      continue;
    }
    if (child.nodeType !== 1) continue;

    const tag = child.tagName;
    const inner = serializeInline(child, links);
    if (!inner.trim() && tag !== "A") continue;

    if (tag === "A") {
      const href = child.getAttribute("href") ?? "#";
      links.push(href);
      // Placeholders stay bare so they are obvious in the editor; real destinations open
      // in a new tab, matching every published CUI article.
      const attrs = /^https?:\/\//i.test(href)
        ? ` href="${href}" target="_blank" rel="noreferrer noopener"`
        : ` href="${href}"`;
      out += `<a${attrs}>${inner}</a>`;
    } else if (tag === "STRONG" || tag === "B") {
      out += `<strong>${inner}</strong>`;
    } else if (tag === "EM" || tag === "I") {
      out += `<em>${inner}</em>`;
    } else if (KEEP_INLINE.has(tag)) {
      out += `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`;
    } else {
      out += inner; // unknown wrapper: keep the words, drop the tag
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

const textOf = (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/**
 * A single leading H1 is the article title: WordPress renders it from the post title
 * field, so it is captured and dropped. Several H1s mean the author used Heading 1 for
 * sections instead, in which case everything shifts down a level so the document still
 * starts at H2 under the post title.
 */
function headingPlan(body) {
  const h1s = [...body.children].filter((el) => el.tagName === "H1");
  const leadingTitle = h1s.length === 1 && body.children[0]?.tagName === "H1";
  return { demote: h1s.length > 1, title: leadingTitle ? textOf(h1s[0]) : null };
}

function htmlToNodes(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;
  const { demote, title } = headingPlan(body);

  const nodes = [];
  const links = [];

  for (const el of body.children) {
    const tag = el.tagName;

    if (/^H[1-6]$/.test(tag)) {
      const source = Number(tag[1]);
      if (source === 1 && !demote && title) continue; // the article title
      // Everything below the post title is H2, and anything deeper is H3. Skipping a
      // level is invalid, and CUI's design system has no styling past H3 in an article.
      const level = demote ? Math.min(source + 1, 3) : Math.min(Math.max(source, 2), 3);
      const inner = serializeInline(el, links);
      if (inner) nodes.push({ type: "heading", level, html: inner, text: textOf(el) });
      continue;
    }

    if (tag === "UL" || tag === "OL") {
      const items = [...el.querySelectorAll(":scope > li")]
        .map((li) => ({ html: serializeInline(li, links), text: textOf(li) }))
        .filter((i) => i.html);
      if (items.length) nodes.push({ type: "list", ordered: tag === "OL", items });
      continue;
    }

    if (tag === "BLOCKQUOTE") {
      const inner = [...el.children].map((c) => serializeInline(c, links)).join(" ").trim()
        || serializeInline(el, links);
      if (inner) nodes.push({ type: "quote", html: inner, text: textOf(el) });
      continue;
    }

    if (tag === "TABLE" || tag === "FIGURE" || tag === "IMG") {
      nodes.push({ type: "unsupported", tag: tag.toLowerCase(), text: textOf(el) });
      continue;
    }

    const inner = serializeInline(el, links);
    if (inner) nodes.push({ type: "paragraph", html: inner, text: textOf(el) });
  }

  return { nodes, title, demoted: demote, links };
}

/** `.docx` keeps its structure; everything else is read as markdown, which degrades to
 *  plain paragraphs when there is no markup to find. */
export async function readSource({ file, text }) {
  const warnings = [];
  let html;

  if (file && /\.docx$/i.test(file.name)) {
    const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    html = result.value;
    for (const m of result.messages) {
      if (m.type === "warning") warnings.push(`Word import: ${m.message}`);
    }
  } else {
    const raw = file ? await file.text() : (text ?? "");
    if (!raw.trim()) throw new Error("Nothing to read: the source is empty.");
    html = marked.parse(raw, { async: false, breaks: false, mangle: false });
  }

  const parsed = htmlToNodes(html);
  if (!parsed.nodes.length) throw new Error("No readable content in that source.");

  if (parsed.demoted) {
    warnings.push(
      "The source uses Heading 1 for its sections, so every heading moved down one " +
      "level. Check that the first heading is not actually the article title.",
    );
  }
  for (const n of parsed.nodes) {
    if (n.type === "unsupported") {
      warnings.push(
        `A <${n.tag}> was dropped: images and tables have to be placed by hand in the ` +
        `editor. Content near it: "${n.text.slice(0, 60)}"`,
      );
    }
  }

  return {
    ...parsed,
    nodes: parsed.nodes.filter((n) => n.type !== "unsupported"),
    warnings,
  };
}
