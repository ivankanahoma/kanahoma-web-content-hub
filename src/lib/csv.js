// Export of whatever the queue is currently showing.
//
// The point is reporting to the client, so the export follows the filters rather than
// dumping the table: what you exported is what you were looking at.

import { TIERS } from "./queue.js";

const COLUMNS = [
  ["Ticket", (t) => t.id],
  ["Subject", (t) => t.subject ?? ""],
  ["Status", (t) => t.status ?? ""],
  ["Tier", (t) => TIERS[t.tier]?.label ?? `Tier ${t.tier}`],
  ["Critical", (t) => (t.critical_impact ? "yes" : "no")],
  ["Waiting on", (t) => (t.waiting_on === "us" ? "us" : "requester")],
  ["Answered", (t) => (t.answered ? "yes" : "no")],
  ["Reopened", (t) => (t.reopens > 0 ? t.reopens : "")],
  ["Requester", (t) => t.requester_name ?? ""],
  ["VIP", (t) => (t.is_vip ? "yes" : "no")],
  ["Assignee", (t) => t.assignee_name ?? "unassigned"],
  ["Complexity", (t) => t.complexity ?? ""],
  ["Effort", (t) => t.effort ?? ""],
  ["Institutional knowledge", (t) => t.institutional_knowledge ?? ""],
  ["Knowledge needed", (t) => t.institutional_knowledge_note ?? ""],
  ["Requester deadline", (t) => t.requester_deadline ?? ""],
  ["Promised ETA", (t) => t.eta_date ?? ""],
  ["Age (days)", (t) => t.age_days ?? ""],
  ["Pre-launch", (t) => (t.requested_pre_launch ? "yes" : "no")],
  ["Summary", (t) => t.summary ?? ""],
];

/**
 * A field is quoted whenever it could otherwise break the row, and embedded quotes are
 * doubled. Subjects routinely contain commas, and summaries contain both.
 */
function cell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows) {
  const lines = [COLUMNS.map(([name]) => cell(name)).join(",")];
  for (const row of rows) {
    lines.push(COLUMNS.map(([, read]) => cell(read(row))).join(","));
  }
  // CRLF and a BOM, so Excel opens it with the right encoding instead of mangling the
  // requester names that carry accents.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function downloadCsv(rows, filename) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
