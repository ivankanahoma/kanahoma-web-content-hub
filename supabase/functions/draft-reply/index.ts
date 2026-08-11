// Writes a copy-paste reply draft for one ticket, on demand.
//
// Read-only against Zendesk: nothing is ever posted from here. The draft lands in
// ticket_drafts and Ivan pastes it himself, so a wrong draft costs nothing.

import { createClient } from "jsr:@supabase/supabase-js@2";

import { json, preflight } from "../_shared/cors.ts";

const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `
You write reply drafts for the web content team that maintains cui.edu, the public
website of Concordia University Irvine. The reader is university staff or faculty who
asked for a change to the site. Your draft will be pasted into Zendesk by a human, who
edits it first.

Voice: direct, warm, professional. Plain sentences. No corporate filler, no "we hope this
message finds you well", no apologising twice for the same thing.

Hard rules, in order of importance:

1. Never invent anything. No dates, no promises, no facts about the site that are not in
   the thread. If the team has not committed to a date, do not put one in.
2. If the request cannot be actioned without more information, the draft's job is to ask
   for exactly that, as specific numbered questions. Do not pad it with reassurance.
3. Where the draft needs a fact only the writer has - a date, a URL, a decision - leave a
   bracketed placeholder like [ETA] or [page URL]. A visible gap is correct; a plausible
   guess is not.
4. Acknowledge a deadline the requester gave, without agreeing to it unless the team
   already did.
5. Two to six sentences unless a list of questions genuinely needs more.
6. Never use em dashes or en dashes. Use a comma, a full stop, or a colon instead.

Sign off as "Web Team". Return only the message body: no subject line, no preamble
explaining what you wrote.
`.trim();

function stripHtml(s: string) {
  return (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { ticket_id: ticketId } = await req.json().catch(() => ({}));
  if (!ticketId) {
    return json({ error: "ticket_id is required" }, { status: 400 });
  }

  const { data: ticket } = await db
    .from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) return json({ error: "unknown ticket" }, { status: 404 });

  const { data: client } = await db
    .from("clients").select("*").eq("id", ticket.client_id).single();

  const { data: comments } = await db
    .from("ticket_comments")
    .select("id, author_side, author_name, is_public, body, created_at")
    .eq("ticket_id", ticketId)
    .neq("author_side", "system")
    .order("created_at");

  const { data: insight } = await db
    .from("ticket_insights").select("*").eq("ticket_id", ticketId).maybeSingle();

  const { data: eta } = await db
    .from("ticket_etas").select("eta_date, is_fuzzy")
    .eq("ticket_id", ticketId).order("created_at", { ascending: false }).limit(1);

  const tz = client.timezone;
  const thread = (comments ?? []).map((c) => {
    const when = new Date(c.created_at).toLocaleDateString("en-CA", { timeZone: tz });
    const who = c.author_side === "us" ? "OUR TEAM" : "REQUESTER";
    return `--- ${who}${c.is_public ? "" : " (internal note)"} | ${when} | ${c.author_name ?? ""}\n${stripHtml(c.body)}`;
  }).join("\n\n");

  // State the model must not contradict, spelled out rather than left to inference.
  const facts = [
    `Today is ${new Date().toLocaleDateString("en-CA", { timeZone: tz })} (${tz}).`,
    `Subject: ${ticket.subject}`,
    eta?.[0]
      ? `The team has already promised: ${eta[0].eta_date}${eta[0].is_fuzzy ? " (approximate)" : ""}. Reuse this date rather than inventing another.`
      : `The team has NOT promised a date. Do not state one; use [ETA] if a date is needed.`,
    insight?.requester_deadline
      ? `The requester asked for: ${insight.requester_deadline}.`
      : `The requester did not give a deadline.`,
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 900,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `${facts}\n\n${thread}` }],
    }),
  });

  if (!res.ok) {
    return json({ error: `Anthropic ${res.status}` }, { status: 502 });
  }

  const payload = await res.json();
  const body = (payload.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n")
    // The prompt forbids these, but a slip would land in the clipboard, so strip them
    // here as well: " word - word " reads the same and matches how the team writes.
    .replace(/\s*[\u2014\u2013]\s*/g, " - ")
    .trim();

  if (!body) return json({ error: "empty draft" }, { status: 502 });

  await db.from("ai_usage").insert({
    job: "draft-reply",
    ticket_id: ticketId,
    model: MODEL,
    input_tokens: payload.usage?.input_tokens ?? 0,
    output_tokens: payload.usage?.output_tokens ?? 0,
    cache_read_tokens: payload.usage?.cache_read_input_tokens ?? 0,
    cache_creation_tokens: payload.usage?.cache_creation_input_tokens ?? 0,
  });

  const contentHash = await sha256(
    ticket.subject + " " + (comments ?? []).map((c) => c.id + c.body).join(" "),
  );

  const { error } = await db.from("ticket_drafts").upsert({
    ticket_id: ticketId,
    body,
    model: MODEL,
    content_hash: contentHash,
    generated_at: new Date().toISOString(),
  });
  if (error) return json({ error: error.message }, { status: 500 });

  return json({ body, model: MODEL, content_hash: contentHash });
});
