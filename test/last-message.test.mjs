// The two queries behind "last message on the thread".
//
// This exists because they were once built from a single shared builder, which is
// mutable: both came out ordered `asc,desc`, both returned the same row, and the block
// never rendered on any ticket. Nothing threw and nothing logged.

import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

import { newestQuery, oldestQuery } from "../src/lib/lastMessage.js";

const client = createClient("https://example.supabase.co", "anon-key-placeholder");
const params = (q) => decodeURIComponent(q.url.search);

test("the two queries are ordered in opposite directions", () => {
  assert.match(params(oldestQuery(client, 75022)), /order=created_at\.asc(&|$)/);
  assert.match(params(newestQuery(client, 75022)), /order=created_at\.desc(&|$)/);
});

test("neither query carries the other's ordering", () => {
  const oldest = params(oldestQuery(client, 75022));
  const newest = params(newestQuery(client, 75022));
  assert.ok(!oldest.includes("created_at.desc"), "oldest picked up a descending order");
  assert.ok(!newest.includes("created_at.asc"), "newest picked up an ascending order");
  assert.notEqual(oldest, newest, "both queries came out identical");
});

test("system comments are excluded and the ticket is scoped", () => {
  for (const q of [oldestQuery(client, 75022), newestQuery(client, 75022)]) {
    assert.ok(params(q).includes("author_side=neq.system"));
    assert.ok(params(q).includes("ticket_id=eq.75022"));
    assert.ok(params(q).includes("limit=1"));
  }
});
