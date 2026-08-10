// What each role sees in the menu.
//
// This is presentation, not security: RLS decides what a role can actually read. The
// tests exist because the two have to agree, and a menu that offers a section the
// database will refuse reads as a broken tool.

import test from "node:test";
import assert from "node:assert/strict";

import { SECTIONS, homeSectionFor, parentOf, sectionsFor } from "../src/lib/sections.js";

const ids = (role) => sectionsFor(role).map((s) => s.id);
const childIds = (role, parent) =>
  sectionsFor(role).find((s) => s.id === parent)?.children?.map((c) => c.id) ?? [];

test("Tools is a heading, not a destination", () => {
  const tools = SECTIONS.find((s) => s.id === "tools");
  assert.equal(tools.navigable, false);
  assert.ok(tools.children.length, "a heading with no children would be a dead label");
  assert.equal(parentOf("article-generator"), "tools");
});

test("an admin sees everything", () => {
  assert.deepEqual(ids("admin"), SECTIONS.map((s) => s.id));
  assert.ok(childIds("admin", "queue").includes("spam"));
});

test("a content editor sees the queue, tools and the documentation only", () => {
  assert.deepEqual(ids("content_editor"), ["queue", "tools", "docs"]);
  assert.deepEqual(childIds("content_editor", "tools"), ["article-generator"]);
});

test("a content editor gets no requester directory, keywords or schedules", () => {
  const visible = new Set([
    ...ids("content_editor"),
    ...sectionsFor("content_editor").flatMap((s) => (s.children ?? []).map((c) => c.id)),
  ]);
  for (const hidden of ["requesters", "spam", "keywords", "students", "leadership",
                        "asana", "activity"]) {
    assert.ok(!visible.has(hidden), `${hidden} should be hidden from a content editor`);
  }
});

test("an account with no role yet sees nothing", () => {
  assert.deepEqual(ids(null), []);
});

test("every role lands on a section it can actually reach", () => {
  for (const role of ["admin", "manager", "viewer", "content_editor"]) {
    const reachable = new Set(sectionsFor(role).flatMap((s) => [
      ...(s.navigable === false ? [] : [s.id]),
      ...(s.children ?? []).map((c) => c.id),
    ]));
    assert.ok(reachable.has(homeSectionFor(role)),
              `${role} lands on ${homeSectionFor(role)}, which it cannot open`);
  }
});
