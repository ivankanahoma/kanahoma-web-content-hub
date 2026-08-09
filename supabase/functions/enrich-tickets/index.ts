// Reads each ticket thread and records what the queue needs in order to rank it:
// critical impact, complexity, tone, the deadline the requester asked for, and the ETA
// we promised back.
//
// Re-runs only when a thread actually changed (content hash over subject + public
// comments), so a new comment mentioning a new date is picked up but idle tickets cost
// nothing.
//
// Processes a bounded batch per invocation and reports what is left, so a long backlog
// drains across successive scheduled runs instead of hitting the wall-clock limit.

import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5";
const BATCH_SIZE = 15;
const CONCURRENCY = 5;

const ANALYSIS_TOOL = {
  name: "record_analysis",
  description: "Record the structured analysis of one support ticket thread.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One sentence, plain English: what is actually being asked for.",
      },
      critical_impact: {
        type: "boolean",
        description:
          "True only if the issue currently blocks or misleads a prospective or " +
          "current student on the live site.",
      },
      critical_impact_reason: {
        type: "string",
        description: "Why, in a short phrase. Omit when critical_impact is false.",
      },
      complexity: {
        type: "string",
        enum: ["easy", "medium", "complex"],
        description: "How much judgement the work needs, independent of how long it takes.",
      },
      effort: {
        type: "string",
        enum: ["fast", "time_consuming"],
        description: "How much time the work takes, independent of how hard it is.",
      },
      complexity_reason: { type: "string", description: "One short phrase." },
      tone_urgency: {
        type: "integer",
        enum: [0, 1, 2, 3],
        description:
          "How pressed the requester sounds. 0 neutral, 1 mild, 2 pressing, 3 alarmed. " +
          "Judge tone only, not the subject matter.",
      },
      tone_urgency_reason: { type: "string" },
      requester_deadline: {
        type: "string",
        description:
          "YYYY-MM-DD. A date the REQUESTER asked for. Omit if they never named one.",
      },
      requester_deadline_fuzzy: {
        type: "boolean",
        description: "True when the requester was vague, e.g. 'sometime next week'.",
      },
      requester_deadline_quote: {
        type: "string",
        description: "The requester's exact words that carry the deadline.",
      },
      promised_eta: {
        type: "string",
        description:
          "YYYY-MM-DD. The most recent delivery date OUR team promised. Omit if we " +
          "never committed to one.",
      },
      promised_eta_fuzzy: {
        type: "boolean",
        description: "True when our commitment was vague, e.g. 'early next week'.",
      },
      promised_eta_quote: { type: "string" },
      promised_eta_comment_id: {
        type: "integer",
        description: "The id of the comment the promise appears in.",
      },
      last_agent_message_kind: {
        type: "string",
        enum: ["delivery", "commitment", "question", "other"],
        description:
          "What OUR most recent public message was doing. delivery = the work is " +
          "finished and we asked them to review or confirm it. commitment = we said we " +
          "WILL do it, or named a date, and the work is not done yet. question = we " +
          "asked for something we need before we can finish. other = anything else. " +
          "Omit when we have never posted a public message.",
      },
    },
    // Nullable fields are simply omitted when they do not apply, rather than typed as
    // unions, which keeps the schema inside the subset the tools API handles reliably.
    required: [
      "summary", "critical_impact", "complexity", "effort", "complexity_reason",
      "tone_urgency", "tone_urgency_reason", "requester_deadline_fuzzy",
      "promised_eta_fuzzy",
    ],
  },
};

const SYSTEM_PROMPT = `
You analyse support tickets for the web content team that maintains cui.edu, the public
website of Concordia University Irvine. Requesters are university staff and faculty
asking for changes to the live site. You are triaging, not answering.

Report only what the thread actually says. If something is not stated, omit that field
entirely. Never infer a deadline, a commitment, or a severity that nobody wrote down.

CRITICAL IMPACT means the live site is right now blocking or misleading a prospective or
current student. It is a high bar. It applies to:
  - wrong tuition, cost, financial aid or scholarship figures
  - a broken or missing application or enrolment path
  - wrong program start dates or application deadlines
  - wrong admissions contact details
  - a live page returning 404 or otherwise unreachable
  - an accreditation, legal or compliance problem
It does NOT apply to: typos, wording preferences, styling, adding new content, routine
updates, work on pages that are not live yet, or anything that is merely important to the
requester's department.

COMPLEXITY is about judgement, not duration:
  - easy: mechanical, no decisions. Swap text, fix a link, replace an image.
  - medium: layout or structural work, or coordination with another team.
  - complex: a new page, template or Gutenberg block; information architecture decisions;
    or content that must be reconciled against another system such as the catalog.

EFFORT is about duration, not difficulty:
  - fast: roughly under half an hour.
  - time_consuming: many pages or items, or long repetitive work.
A one-word fix on 20 pages is easy and time_consuming. A single new component is complex
and possibly fast. Judge the two axes independently.

TONE URGENCY reads how the requester sounds, and nothing else. A calmly worded report of
a broken application form is tone 0 and critical impact true. Shouting about a typo is
tone 3 and critical impact false.

OUR LAST MESSAGE. Classify only the most recent public message from OUR TEAM. This
decides what happens when a ticket goes quiet, so the distinction that matters most is
whether the requester still owes us something:

  - delivery: the work is FINISHED. "The updates have been made, let me know if
    everything looks good." Silence after this means tacit acceptance.
  - commitment: we said we will do it, or named a date, and it is NOT done yet.
    "We should be able to complete this by 8/21." "We will have the page updated for
    your review by Monday." The requester has nothing to reply to - they are waiting on
    us - so silence here means nothing at all. Never label these delivery: the presence
    of a date or a promise is exactly what separates the two.
  - question: we asked for something we need before we can finish.
  - other: anything else.

Internal notes are not messages to the requester; ignore them.

DATES. Resolve everything relative to the date of the comment it appears in, and express
it as YYYY-MM-DD in America/Los_Angeles. "by Monday" written on a Friday means the
following Monday. Mark it fuzzy when the wording is soft ("early next week", "end of the
month") but still give your best single date. Keep two things strictly apart: a deadline
the REQUESTER asked for, and an ETA OUR team promised. A message from us saying "we will
have this by Thursday" is a promised ETA, never a requester deadline.
`.trim();

type CommentRow = {
  id: number;
  author_side: string;
  author_name: string | null;
  is_public: boolean;
  body: string;
  created_at: string;
};

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function renderThread(
  ticket: { subject: string; description: string; zendesk_created_at: string },
  comments: CommentRow[],
  timezone: string,
) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const lines = comments.map((c) => {
    const when = new Date(c.created_at).toLocaleDateString("en-CA", { timeZone: timezone });
    const who = c.author_side === "us" ? "OUR TEAM" : "REQUESTER";
    const kind = c.is_public ? "" : " (internal note)";
    return `--- comment id ${c.id} | ${who}${kind} | ${when} | ${c.author_name ?? ""}\n${c.body}`;
  });
  return [
    `Today is ${today} (America/Los_Angeles).`,
    `Ticket opened: ${
      new Date(ticket.zendesk_created_at).toLocaleDateString("en-CA", { timeZone: timezone })
    }`,
    `Subject: ${ticket.subject}`,
    "",
    lines.join("\n\n"),
  ].join("\n");
}

// The tools API treats `required` as a strong hint, not a guarantee, so a field can come
// back missing. These are the ones the queue cannot rank without.
const MUST_HAVE = [
  "summary", "critical_impact", "complexity", "effort", "tone_urgency",
];

function missingFields(input: Record<string, unknown>) {
  return MUST_HAVE.filter((k) => input?.[k] === undefined || input?.[k] === null);
}

async function callModel(thread: string, apiKey: string, retryFor: string[] = []) {
  const messages: { role: string; content: string }[] = [
    { role: "user", content: thread },
  ];
  if (retryFor.length) {
    messages.push({
      role: "user",
      content:
        `Your previous analysis left these required fields out: ${retryFor.join(", ")}. ` +
        `Call record_analysis again with every required field filled in.`,
    });
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: "tool", name: "record_analysis" },
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const block = body.content?.find((b: { type: string }) => b.type === "tool_use");
  if (!block) throw new Error("Model returned no tool_use block");
  return { input: block.input as Record<string, unknown>, usage: body.usage };
}

/**
 * A half-filled analysis is worse than none: it silently drops the ticket into the
 * bottom tier as though it had been assessed. Retry once, then fail loudly.
 */
async function analyse(thread: string, apiKey: string) {
  // Usage accumulates across the retry, so a ticket that needed two calls reports what
  // it actually cost rather than only the successful attempt.
  const first = await callModel(thread, apiKey);
  const missing = missingFields(first.input);
  if (!missing.length) return first;

  const second = await callModel(thread, apiKey, missing);
  const stillMissing = missingFields(second.input);
  if (stillMissing.length) {
    throw new Error(`Model omitted required fields twice: ${stillMissing.join(", ")}`);
  }
  return {
    input: second.input,
    usage: {
      input_tokens: (first.usage?.input_tokens ?? 0) + (second.usage?.input_tokens ?? 0),
      output_tokens: (first.usage?.output_tokens ?? 0) + (second.usage?.output_tokens ?? 0),
      cache_read_input_tokens:
        (first.usage?.cache_read_input_tokens ?? 0) +
        (second.usage?.cache_read_input_tokens ?? 0),
      cache_creation_input_tokens:
        (first.usage?.cache_creation_input_tokens ?? 0) +
        (second.usage?.cache_creation_input_tokens ?? 0),
    },
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  }
  return out;
}

Deno.serve(async () => {
  const started = Date.now();
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")!;

  const { data: client } = await db.from("clients").select("*").eq("slug", "cui").single();

  // enrichable_tickets already excludes solved tickets and requesters whose email domain
  // is off the allowlist, so junk never reaches the model.
  const { data: tickets } = await db
    .from("enrichable_tickets")
    .select("id, subject, description, zendesk_created_at")
    .eq("client_id", client!.id);

  const { data: existing } = await db
    .from("ticket_insights").select("ticket_id, content_hash");
  const hashByTicket = new Map(
    (existing ?? []).map((r) => [Number(r.ticket_id), r.content_hash]),
  );

  // Work out which threads actually changed before spending a single token.
  const pending: { ticket: typeof tickets[number]; comments: CommentRow[]; hash: string }[] = [];
  for (const ticket of tickets ?? []) {
    const { data: comments } = await db
      .from("ticket_comments")
      .select("id, author_side, author_name, is_public, body, created_at")
      .eq("ticket_id", ticket.id)
      .neq("author_side", "system")   // the autoresponder is noise, never context
      .order("created_at");
    const hash = await sha256(
      ticket.subject + " " + (comments ?? []).map((c) => c.id + c.body).join(" "),
    );
    if (hashByTicket.get(Number(ticket.id)) === hash) continue;
    pending.push({ ticket, comments: (comments ?? []) as CommentRow[], hash });
  }

  const batch = pending.slice(0, BATCH_SIZE);
  const failures: { ticket_id: number; error: string }[] = [];

  await mapLimit(batch, CONCURRENCY, async ({ ticket, comments, hash }) => {
    try {
      const thread = renderThread(ticket, comments, client!.timezone);
      const { input: a, usage } = await analyse(thread, apiKey);

      await db.from("ai_usage").insert({
        job: "enrich-tickets",
        ticket_id: ticket.id,
        model: MODEL,
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0,
        cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
        cache_creation_tokens: usage?.cache_creation_input_tokens ?? 0,
      });

      // Store the model's verdict untouched. Ivan's optional keyword rules are applied
      // at read time by the ticket_queue view, so they never overwrite this.
      const { error } = await db.from("ticket_insights").upsert({
        ticket_id: ticket.id,
        summary: a.summary,
        ai_critical_impact: a.critical_impact === true,
        ai_critical_impact_reason: a.critical_impact_reason ?? null,
        complexity: a.complexity,
        effort: a.effort,
        complexity_reason: a.complexity_reason,
        tone_urgency: a.tone_urgency,
        tone_urgency_reason: a.tone_urgency_reason,
        last_agent_message_kind: a.last_agent_message_kind ?? null,
        requester_deadline: a.requester_deadline ?? null,
        requester_deadline_fuzzy: a.requester_deadline_fuzzy ?? false,
        requester_deadline_quote: a.requester_deadline_quote ?? null,
        model: MODEL,
        content_hash: hash,
        enriched_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);

      // ETAs are append-only history. Only record a genuinely new commitment, so
      // re-analysis of an unchanged promise does not pile up duplicate rows.
      if (a.promised_eta) {
        const { data: latest } = await db
          .from("ticket_etas").select("eta_date")
          .eq("ticket_id", ticket.id).order("created_at", { ascending: false }).limit(1);
        if (latest?.[0]?.eta_date !== a.promised_eta) {
          await db.from("ticket_etas").insert({
            ticket_id: ticket.id,
            eta_date: a.promised_eta,
            is_fuzzy: a.promised_eta_fuzzy ?? false,
            quote: a.promised_eta_quote,
            source_comment_id: a.promised_eta_comment_id,
            source: "ai",
          });
        }
      }
    } catch (err) {
      failures.push({ ticket_id: Number(ticket.id), error: String(err) });
    }
  });

  const summary = {
    analysed: batch.length - failures.length,
    failed: failures.length,
    remaining: Math.max(0, pending.length - batch.length),
    failures: failures.slice(0, 5),
    ms: Date.now() - started,
  };
  console.log("enrich-tickets", JSON.stringify(summary));
  return Response.json(summary);
});
