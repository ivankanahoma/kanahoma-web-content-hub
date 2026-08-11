// Labels the parts of an article. It does not write one.
//
// The browser has already parsed the source into numbered nodes. This function sends the
// model that numbered list and gets back indices: which node is the series note, which
// range is an author bio, which nodes carry a typo. The article text makes the round trip
// only as input.
//
// That is the whole point of the design. The model never re-emits the author's prose, so
// "never invent content" is not a rule it has to follow, it is a thing it cannot do. The
// only text it writes is the excerpt, which is meant to be written, and typo corrections,
// which arrive as find/replace pairs that are applied and then listed for review.

import { createClient } from "jsr:@supabase/supabase-js@2";

import { json, preflight } from "../_shared/cors.ts";

const MODEL = "claude-sonnet-5";
const MAX_NODES = 400;

const SYSTEM_PROMPT = `
You label the parts of an article that is about to be published on cui.edu, the public
website of Concordia University Irvine. The article has already been split into numbered
nodes. You classify those nodes. You never rewrite them.

You are given every node as "INDEX | TYPE | text". Return indices, not text.

What to find:

STANDFIRST - a short italic note above the article placing it in a series or setting it
up, for example "This article is part of the series ...". It is always near the top and
there is at most one. If the article opens straight into its argument, there is none.

AUTHOR BIOS - the author's own biography, at the end of the article. A bio names the
person, usually gives their title or role, and describes their career in the third
person. There can be more than one when an article has several authors.
  - "from" is the first node of the whole bio block, including the line carrying the name.
  - "to" is its last node.
  - "proseFrom" is the first node of the biography itself, after the name and role lines.
  - "name" and "role" are copied from those lines, not invented. If the source gives no
    role, leave it empty and say so in notes. Never infer a job title.
A closing paragraph that argues the article's point is not a bio, even if it mentions the
author. If you are not sure, do not label it.

EXCERPT - the one thing you write. Take the opening sentence of the article's first real
body paragraph, or the first two if the first is short. Trim to roughly 155 characters at
a word boundary. No trailing ellipsis, no quotation marks around it, no inline HTML. It
must read as a complete thought, because it is what appears on the article cards.

Never build the excerpt from the standfirst. If you labelled a node as the standfirst, it
is not eligible: an excerpt that opens "This article is part of the series ..." describes
the series on every card instead of describing this article. Start from the first body
paragraph after it. Headings are not eligible either.

SEO - only if the source document actually contains them: meta title, meta description,
focus keyphrase, canonical URL. These usually sit in a block at the top or bottom labelled
as SEO. If the source has none, set seoFound to false and leave the fields empty. Never
write SEO values yourself.

TYPOS - only unambiguous mechanical errors: a duplicated word, a missing space, a
malformed year range, a stray bracket. Give the node index, the exact text to find, and
what to replace it with. Do not correct grammar, style, capitalisation choices, British
versus American spelling, or anything you would describe as "clearer". If the author
wrote it on purpose, leave it. When in doubt, leave it.

REFERENCES - the index where a reference or sources list begins, if there is one. This is
usually a heading called References, Sources or Works Cited.

NOTES - short factual observations the editor has to act on. Things worth a note: no
section headings in the source, no author bio found, a role that was missing, a link left
as a placeholder, a claim that contradicts itself, an image mentioned but not supplied.
Do not note anything you already returned as a field.

Never use em dashes or en dashes in anything you write.
`.trim();

const TOOL = {
  name: "record_labels",
  description: "Record which node is which. Indices only, except the excerpt.",
  input_schema: {
    type: "object",
    properties: {
      standfirst: {
        type: ["integer", "null"],
        description: "Node index of the series note, or null.",
      },
      referencesFrom: {
        type: ["integer", "null"],
        description: "Node index where the reference list begins, or null.",
      },
      authorBios: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "integer" },
            to: { type: "integer" },
            proseFrom: { type: "integer" },
            name: { type: "string" },
            role: { type: "string" },
          },
          required: ["from", "to", "proseFrom", "name", "role"],
          additionalProperties: false,
        },
      },
      excerpt: { type: "string" },
      seoFound: { type: "boolean" },
      seo: {
        type: "object",
        properties: {
          metaTitle: { type: "string" },
          metaDescription: { type: "string" },
          focusKeyphrase: { type: "string" },
          canonicalUrl: { type: "string" },
        },
        required: ["metaTitle", "metaDescription", "focusKeyphrase", "canonicalUrl"],
        additionalProperties: false,
      },
      typos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            find: { type: "string" },
            replace: { type: "string" },
            why: { type: "string" },
          },
          required: ["index", "find", "replace", "why"],
          additionalProperties: false,
        },
      },
      notes: { type: "array", items: { type: "string" } },
    },
    required: ["standfirst", "referencesFrom", "authorBios", "excerpt", "seoFound", "seo",
               "typos", "notes"],
    additionalProperties: false,
  },
};

type Node = { type: string; level?: number; text: string };

/**
 * Indices the model returned are checked against the list it was given. A bio range that
 * runs off the end would silently swallow the article, and a standfirst pointing at a
 * heading would italicise the wrong thing.
 */
function sanitize(result: Record<string, unknown>, nodes: Node[]) {
  const last = nodes.length - 1;
  const inRange = (n: unknown) => typeof n === "number" && n >= 0 && n <= last;
  const dropped: string[] = [];

  const standfirst = inRange(result.standfirst) &&
    nodes[result.standfirst as number].type === "paragraph"
    ? result.standfirst as number
    : null;
  if (result.standfirst != null && standfirst === null) {
    dropped.push("The series note the model picked was not a paragraph, so it was ignored.");
  }

  const bios = (Array.isArray(result.authorBios) ? result.authorBios : [])
    .filter((b: Record<string, number>) => {
      const ok = inRange(b.from) && inRange(b.to) && b.from <= b.to &&
        b.proseFrom >= b.from && b.proseFrom <= b.to;
      if (!ok) dropped.push("An author bio with an impossible range was ignored.");
      return ok;
    })
    .sort((a: { from: number }, b: { from: number }) => a.from - b.from);

  // Overlapping bios would render the same paragraphs into two cards.
  const bounded = bios.filter((b: { from: number }, i: number) =>
    i === 0 || b.from > bios[i - 1].to);

  return {
    standfirst,
    referencesFrom: inRange(result.referencesFrom) ? result.referencesFrom : null,
    authorBios: bounded,
    excerpt: String(result.excerpt ?? "").trim(),
    seoFound: result.seoFound === true,
    seo: result.seo ?? null,
    typos: (Array.isArray(result.typos) ? result.typos : [])
      .filter((t: { index: number; find: string }) =>
        inRange(t.index) && t.find && nodes[t.index].text.includes(t.find)),
    notes: [...(Array.isArray(result.notes) ? result.notes : []), ...dropped],
  };
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const started = Date.now();

  let body: { nodes?: Node[]; title?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "expected a JSON body" }, { status: 400 });
  }

  const nodes = body.nodes ?? [];
  if (!nodes.length) return json({ error: "nodes is required" }, { status: 400 });
  if (nodes.length > MAX_NODES) {
    return json(
      { error: `That article has ${nodes.length} blocks, over the ${MAX_NODES} limit.` },
      { status: 413 },
    );
  }

  const listing = nodes
    .map((n, i) => {
      const kind = n.type === "heading" ? `heading h${n.level ?? 2}` : n.type;
      return `${i} | ${kind} | ${n.text}`;
    })
    .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{
        role: "user",
        content: `${body.title ? `Working title: ${body.title}\n\n` : ""}` +
          `Nodes:\n${listing}`,
      }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("anthropic", res.status, detail);
    return json({ error: `Anthropic ${res.status}` }, { status: 502 });
  }

  const payload = await res.json();
  const call = payload.content?.find((c: { type: string }) => c.type === "tool_use");
  if (!call) return json({ error: "the model returned no labels" }, { status: 502 });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  await db.from("ai_usage").insert({
    job: "analyze-article",
    model: MODEL,
    input_tokens: payload.usage?.input_tokens ?? 0,
    output_tokens: payload.usage?.output_tokens ?? 0,
    cache_read_tokens: payload.usage?.cache_read_input_tokens ?? 0,
    cache_creation_tokens: payload.usage?.cache_creation_input_tokens ?? 0,
  });

  const analysis = sanitize(call.input, nodes);
  console.log("analyze-article", JSON.stringify({
    nodes: nodes.length,
    bios: analysis.authorBios.length,
    typos: analysis.typos.length,
    ms: Date.now() - started,
  }));

  return json(analysis);
});
