// The internal note composer is a contenteditable, so its output is whatever the browser
// felt like producing. Everything here is about what must not reach Zendesk.

import test from "node:test";
import assert from "node:assert/strict";

import { noteText, sanitizeNoteHtml }
  from "../supabase/functions/_shared/note-html.ts";

test("ordinary formatting survives", () => {
  assert.equal(
    sanitizeNoteHtml("<div>Checked with <b>Alex</b>, removing <em>today</em>.</div>"),
    "<div>Checked with <b>Alex</b>, removing <em>today</em>.</div>",
  );
});

test("a real link keeps its href and gains rel", () => {
  assert.equal(
    sanitizeNoteHtml('<a href="https://cui.edu/nursing">the page</a>'),
    '<a href="https://cui.edu/nursing" rel="noreferrer noopener">the page</a>',
  );
  assert.ok(sanitizeNoteHtml('<a href="mailto:a@b.com">mail</a>').includes("mailto:"));
});

test("javascript and data urls lose the href, not the words", () => {
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)",
                     "data:text/html;base64,PHN2Zz4=", "vbscript:x", "//evil.test"]) {
    const out = sanitizeNoteHtml(`<a href="${bad}">click me</a>`);
    assert.equal(out, "<a>click me</a>", `${bad} was not neutralised`);
  }
});

test("a script tag is dropped whole, body included", () => {
  assert.equal(
    sanitizeNoteHtml("before<script>alert('x')</script>after"),
    "beforeafter",
  );
  assert.equal(sanitizeNoteHtml("<style>body{display:none}</style>hi"), "hi");
});

test("event handlers and styles cannot ride in on an allowed tag", () => {
  const out = sanitizeNoteHtml(
    '<div onclick="steal()" style="position:fixed" class="x">text</div>');
  assert.equal(out, "<div>text</div>");
  assert.ok(!/onclick|style|class/i.test(out));
});

test("tags nobody asked for are removed but their text stays", () => {
  assert.equal(
    sanitizeNoteHtml("<h1>Title</h1><table><tr><td>cell</td></tr></table>"),
    "Titlecell",
  );
  assert.equal(sanitizeNoteHtml('<img src="x" onerror="boom()">'), "");
});

test("an unclosed or malformed tag cannot smuggle an attribute through", () => {
  const out = sanitizeNoteHtml('<a href="https://ok.test" onmouseover="x">t</a>');
  assert.equal(out, '<a href="https://ok.test" rel="noreferrer noopener">t</a>');
});

test("noteText flattens to something a comment row can hold", () => {
  assert.equal(
    noteText("<div>Line one</div><div>Line two</div>"),
    "Line one\nLine two",
  );
  assert.equal(noteText("<p>a&nbsp;&nbsp;b</p>"), "a b");
  assert.equal(noteText("<div><br></div>"), "");
});

test("an empty composer is empty, however the browser dressed it up", () => {
  for (const empty of ["", "<br>", "<div><br></div>", "<div>   </div>", "<p></p>"]) {
    assert.equal(noteText(sanitizeNoteHtml(empty)), "", `${empty} looked non-empty`);
  }
});
