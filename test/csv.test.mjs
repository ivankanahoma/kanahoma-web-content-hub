import test from "node:test";
import assert from "node:assert/strict";

import { toCsv } from "../src/lib/csv.js";

const row = (over = {}) => ({
  id: 1, subject: "A subject", status: "open", tier: 0, critical_impact: true,
  waiting_on: "us", answered: false, reopens: 0, requester_name: "Ada",
  is_vip: false, assignee_name: null, complexity: "easy", effort: "fast",
  institutional_knowledge: "none", institutional_knowledge_note: null,
  requester_deadline: null, eta_date: null, age_days: 3,
  requested_pre_launch: false, summary: "Fix a link", ...over,
});

test("the header names every column once", () => {
  const [header] = toCsv([]).split("\r\n");
  assert.ok(header.startsWith("﻿Ticket,Subject,Status,Tier"));
  assert.ok(header.includes("Institutional knowledge,Knowledge needed"));
});

test("commas, quotes and newlines cannot break a row", () => {
  const csv = toCsv([row({ subject: 'Update "tuition", fees', summary: "Line one\nLine two" })]);
  const body = csv.split("\r\n")[1];
  assert.ok(body.includes('"Update ""tuition"", fees"'));
  assert.ok(body.includes('"Line one\nLine two"'));
  // Header plus one record. The newline inside the summary is carried by the quoted
  // field and must not start a second row.
  assert.equal(csv.trimEnd().split("\r\n").length, 2);
});

test("an unassigned ticket says so rather than leaving a hole", () => {
  assert.ok(toCsv([row()]).includes(",unassigned,"));
});

test("the tier is exported as its label, not its number", () => {
  assert.ok(toCsv([row({ tier: 8 })]).includes("Requested pre-launch"));
});
