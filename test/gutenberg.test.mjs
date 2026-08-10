// Fidelity tests for the Gutenberg renderer.
//
// The bar is not "valid markup" but "the markup CUI already approved". Every assertion
// here compares generated output against the real article in test/fixtures, so a drifting
// attribute fails the build rather than surfacing as a broken page after a paste.
//
//   node --test test/
//
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BIO_VISIBLE_LIMIT,
  renderArticle,
  serializeAttrs,
  slugify,
  splitBio,
  validate,
} from "../src/lib/gutenberg.js";
import { toEntities } from "../src/lib/entities.js";

const approved = readFileSync(
  new URL("./fixtures/reference-approved-article.txt", import.meta.url), "utf8");
const published = readFileSync(
  new URL("./fixtures/reference-published-article.txt", import.meta.url), "utf8");

const p = (html) => ({ type: "paragraph", html, text: html.replace(/<[^>]+>/g, "") });
const h = (level, html) => ({ type: "heading", level, html, text: html });

/**
 * Differences that are deliberate, normalised away before comparing:
 *
 *  - the photo, which is a placeholder until someone uploads one;
 *  - entities, because the spec asks for `&ldquo;` where the approved article carries a
 *    literal curly quote. The two render identically;
 *  - `source-sans-3` and the link colour on bio paragraphs. The approved article carries
 *    both on its first bio paragraph and neither on the last two, so its own four
 *    paragraphs disagree with each other. The generator emits one consistent form, which
 *    is the one the published article uses throughout.
 */
const normalise = (s) => s
  .replace(/"backgroundImage":\{[^}]*\}/g, '"backgroundImage":{}')
  .replace(/,"fontFamily":"source-sans-3"/g, "")
  .replace(/ has-source-sans-3-font-family/g, "")
  .replace(/"elements":\{"link":\{"color":\{"text":"var:preset\|color\|contrast"\}\}\},/g, "")
  .replace(/ has-link-color(?=[" ])/g, "")
  .replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&rsquo;|&lsquo;/g, "'")
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"');

/** Structure only: same blocks, same attributes, same nesting, text set aside. */
const shape = (s) => normalise(s).replace(/>[^<]*</g, "><");

// --- The escapes ------------------------------------------------------------

test("doubled hyphens are escaped, single hyphens are not", () => {
  const out = serializeAttrs({
    spacing: "var(--wp--preset--spacing--20)",
    family: "source-serif-4",
    border: "gold-500",
  });

  assert.equal(
    out,
    '{"spacing":"var(\\u002d\\u002dwp\\u002d\\u002dpreset\\u002d\\u002dspacing' +
    '\\u002d\\u002d20)","family":"source-serif-4","border":"gold-500"}',
  );
  // The comment would terminate early on a literal doubled hyphen.
  assert.ok(!out.includes("--"), "a raw -- survived into a block comment");
});

test("escapes reach the output as six literal characters, not a decoded hyphen", () => {
  const markup = renderArticle([h(2, "AI Arrives in Education")]);
  assert.ok(markup.includes("\\u002d\\u002dwp"), "the escape was decoded somewhere");
  assert.ok(!markup.includes("var(--wp"), "an unescaped var() reached the comment");
});

// --- Against the approved article -------------------------------------------

test("a section heading matches the approved article exactly", () => {
  const markup = renderArticle([h(2, "AI Arrives in Education")]).trim();
  assert.ok(approved.includes(markup), "the H2 block differs from the approved article");
});

test("the standfirst matches the approved article", () => {
  const note = "This article is part of the series &ldquo;From AI Skeptic to AI " +
    "Champion,&rdquo; which explores how educators can move from fear and uncertainty " +
    "toward wise, ethical, and human-centered AI adoption.";
  const markup = renderArticle([p(note)], { standfirst: 0 }).trim();
  assert.ok(normalise(approved).includes(normalise(markup)),
            "the standfirst block differs");
});

test("the pull quote matches the approved article exactly", () => {
  const line = "AI can fill the pail. Teachers light the fire.";
  const markup = renderArticle([{ type: "quote", html: line, text: line }]).trim();
  assert.ok(approved.includes(markup), "the pull quote block differs");
});

test("the staff card matches the approved article, photo aside", () => {
  const [reference] = approved.match(
    /<!-- wp:group \{"metadata":\{"name":"Staff Card \+ Text"[\s\S]*$/) ?? [];
  assert.ok(reference, "no staff card found in the fixture");

  // Real paragraph lengths, so the Read More split lands where production put it.
  const bio = [913, 414, 446, 410].map((n) => p("x".repeat(n)));
  const nodes = [
    p("Eugene P. Kim, PhD"),
    p("Faculty, Ed.D. in Leadership Program"),
    ...bio,
  ];
  const markup = renderArticle(nodes, {
    authorBios: [{
      from: 0, to: nodes.length - 1, proseFrom: 2,
      name: "Eugene P. Kim, PhD", role: "Faculty, Ed.D. in Leadership Program",
    }],
  }).trim();

  assert.equal(shape(markup), shape(reference.trim()));
});

test("the published article's two staff cards are the same shape", () => {
  const [, first] = published.split(
    /(?=<!-- wp:group \{"metadata":\{"name":"Staff Card \+ Text")/);
  const nodes = [p("Sara Morgan"), p("Associate Professor of Teacher Credentialing"),
                 p("x".repeat(690))];
  const markup = renderArticle(nodes, {
    authorBios: [{ from: 0, to: 2, proseFrom: 2, name: "Sara Morgan",
                   role: "Associate Professor of Teacher Credentialing" }],
  }).trim();

  // The published card has no top margin where the approved one does, so only the inner
  // structure is compared. A 690-character bio must not collapse.
  assert.ok(!markup.includes("wp:details"), "a 690-character bio should not collapse");
  assert.equal(
    shape(markup.slice(markup.indexOf("<!-- wp:columns"))),
    shape(first.slice(first.indexOf("<!-- wp:columns")).trim()),
  );
});

test("the name and role are entity-encoded on the way in", () => {
  const nodes = [p("Rael &amp; Co"), p("Head of Research &amp; Strategy"), p("The bio.")];
  const markup = renderArticle(nodes, {
    authorBios: [{ from: 0, to: 2, proseFrom: 2, name: "Rael & Co",
                   role: "Head of Research & Strategy" }],
  });

  assert.ok(markup.includes(">Rael &amp; Co</h3>"), "the name was not encoded");
  assert.ok(markup.includes(">Head of Research &amp; Strategy</p>"));
  // The name and role came from source nodes too; they must not repeat as body copy.
  assert.equal((markup.match(/Rael &amp; Co/g) ?? []).length, 1);
});

// --- The Read More threshold ------------------------------------------------

test("the bio threshold reproduces both reference articles", () => {
  // Sara Morgan: one 690-character paragraph, no Read More in production.
  const morgan = splitBio([{ text: "x".repeat(690) }]);
  assert.equal(morgan.hidden.length, 0, "a 690-character bio should stay whole");

  // Eugene Kim: 913 visible, then 414 / 446 / 410 collapsed behind Read More.
  const kim = splitBio([913, 414, 446, 410].map((n) => ({ text: "x".repeat(n) })));
  assert.equal(kim.visible.length, 1);
  assert.equal(kim.hidden.length, 3);
});

test("one paragraph is always visible, however long", () => {
  const { visible, hidden } = splitBio([{ text: "x".repeat(BIO_VISIBLE_LIMIT * 3) },
                                        { text: "short" }]);
  assert.equal(visible.length, 1);
  assert.equal(hidden.length, 1);
});

test("a collapsed bio emits a details block with a Read More summary", () => {
  const nodes = [p("Name"), p("Role"),
                 p("a".repeat(950)), p("b".repeat(500))];
  const markup = renderArticle(nodes, {
    authorBios: [{ from: 0, to: 3, proseFrom: 2, name: "Name", role: "Role" }],
  });
  assert.ok(markup.includes("<summary>Read More</summary>"));
  assert.equal((markup.match(/<!-- wp:details/g) ?? []).length, 1);
  assert.ok(published.includes("wp-block-group has-border-color has-gold-500-border-color"));
});

// --- Structure --------------------------------------------------------------

test("a full article validates clean", () => {
  const nodes = [
    p("A series note."),
    h(2, "First section"),
    p("Body copy with <strong>bold</strong> and a <em>title</em>."),
    { type: "list", ordered: false,
      items: [{ html: "One", text: "One" }, { html: "Two", text: "Two" }] },
    { type: "list", ordered: true,
      items: [{ html: "Step one", text: "Step one" }] },
    h(3, "A sub-heading"),
    { type: "quote", html: "A quotable line.", text: "A quotable line." },
    h(2, "References"),
    p('Hu, K. (2023). <em>Reuters</em>. <a href="https://x.test" target="_blank" ' +
      'rel="noreferrer noopener">https://x.test</a>'),
    p("Author Name"), p("Author Role"), p("The bio."),
  ];
  const markup = renderArticle(nodes, {
    standfirst: 0,
    authorBios: [{ from: 9, to: 11, proseFrom: 11,
                   name: "Author Name", role: "Author Role" }],
  });

  assert.deepEqual(validate(markup), [], "validation reported problems");
  assert.ok(markup.includes('<!-- wp:list {"ordered":true} -->'));
  assert.ok(markup.includes("<h3 class="), "the sub-heading did not render as an h3");
  assert.ok(markup.includes("has-medium-font-size"), "the h3 is not smaller than the h2");
});

test("validate catches markup that does not balance", () => {
  const broken = renderArticle([p("Body")]).replace("<!-- /wp:paragraph -->", "");
  assert.ok(validate(broken).some((m) => m.includes("wp:paragraph")));
});

test("validate rejects a font size that is not a token", () => {
  const bad = renderArticle([p("Body")]).replace('<p>', '<p>') +
    '<!-- wp:paragraph {"fontSize":"18px"} -->\n<p>x</p>\n<!-- /wp:paragraph -->';
  assert.ok(validate(bad).some((m) => m.includes("18px")));
});

// --- Odds and ends ----------------------------------------------------------

test("slugs are safe for a filename", () => {
  assert.equal(slugify("Eugene P. Kim, PhD"), "eugene-p-kim-phd");
  assert.equal(slugify("Sara Morgan"), "sara-morgan");
  assert.equal(slugify(""), "author");
});

test("entities are encoded once, not twice", () => {
  assert.equal(toEntities("Rael & Co"), "Rael &amp; Co");
  assert.equal(toEntities("Rael &amp; Co"), "Rael &amp; Co");
  assert.equal(toEntities("it’s a “quote” – dash — long"),
               "it&rsquo;s a &ldquo;quote&rdquo; &ndash; dash &mdash; long");
});
