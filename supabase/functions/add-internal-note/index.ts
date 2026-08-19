// Posts an internal note to a Zendesk ticket.
//
// Internal only, and that is enforced here rather than trusted from the request: the
// body cannot ask for a public reply. A note that reached the requester by accident
// would be a different kind of mistake entirely, so `public` is a constant, not a
// parameter.
//
// The second and last thing the hub writes to Zendesk. Same rules as assign-ticket: the
// caller's role is checked against their own token, and nothing else on the ticket is
// touched.

import { createClient } from "jsr:@supabase/supabase-js@2";

import { json, preflight } from "../_shared/cors.ts";
import { Denied, requireRole } from "../_shared/auth.ts";
import { noteText, sanitizeNoteHtml } from "../_shared/note-html.ts";

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

type Attachment = { filename: string; contentType?: string; data: string };

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  try {
    const { profile } = await requireRole(req, ["admin", "manager"]);

    const body = await req.json().catch(() => ({}));
    const ticketId = body.ticket_id;
    const attachments: Attachment[] = Array.isArray(body.attachments)
      ? body.attachments
      : [];
    if (!ticketId) return json({ error: "ticket_id is required" }, { status: 400 });

    const html = sanitizeNoteHtml(body.html);
    if (!noteText(html) && !attachments.length) {
      return json({ error: "The note is empty." }, { status: 400 });
    }

    let total = 0;
    for (const file of attachments) {
      const size = Math.floor((file.data?.length ?? 0) * 3 / 4);
      if (size > MAX_ATTACHMENT_BYTES) {
        return json(
          { error: `${file.filename} is over the 5 MB limit for one file.` },
          { status: 413 },
        );
      }
      total += size;
    }
    if (total > MAX_TOTAL_BYTES) {
      return json({ error: "Those attachments add up to over 8 MB." }, { status: 413 });
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: ticket } = await db
      .from("tickets").select("id, client_id").eq("id", ticketId).maybeSingle();
    if (!ticket) return json({ error: "unknown ticket" }, { status: 404 });

    const { data: client } = await db
      .from("clients").select("zendesk_subdomain").eq("id", ticket.client_id).single();

    const base = `https://${client.zendesk_subdomain}.zendesk.com`;
    const auth = "Basic " + btoa(
      `${Deno.env.get("ZENDESK_EMAIL")}/token:${Deno.env.get("ZENDESK_TOKEN")}`,
    );

    // Files are uploaded first and exchanged for tokens. If one fails the note is not
    // posted at all, rather than posted with the attachment silently missing.
    const uploadTokens: string[] = [];
    for (const file of attachments) {
      const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
      const res = await fetch(
        `${base}/api/v2/uploads.json?filename=${encodeURIComponent(file.filename)}`,
        {
          method: "POST",
          headers: {
            Authorization: auth,
            "content-type": file.contentType || "application/octet-stream",
          },
          body: bytes,
        },
      );
      if (!res.ok) {
        console.error("zendesk upload", res.status, await res.text());
        return json(
          { error: `Zendesk refused the attachment ${file.filename}.` },
          { status: 502 },
        );
      }
      uploadTokens.push((await res.json()).upload.token);
    }

    const res = await fetch(`${base}/api/v2/tickets/${ticketId}.json`, {
      method: "PUT",
      headers: { Authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({
        ticket: {
          comment: {
            html_body: html || " ",
            public: false, // never a parameter
            ...(uploadTokens.length ? { uploads: uploadTokens } : {}),
          },
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("zendesk note", res.status, detail);
      return json({ error: `Zendesk refused the note (${res.status}).` }, { status: 502 });
    }

    const payload = await res.json();
    const posted = payload.audit?.events?.find(
      (e: { type: string }) => e.type === "Comment",
    );

    // Mirror it immediately so the thread is not missing the note until the next sync.
    // The real Zendesk comment id makes this idempotent when sync re-reads the thread.
    if (posted?.id) {
      await db.from("ticket_comments").upsert({
        id: posted.id,
        ticket_id: Number(ticketId),
        author_id: payload.audit?.author_id ?? null,
        author_name: profile.full_name ?? profile.email,
        author_side: "us",
        is_public: false,
        body: noteText(html),
        created_at: payload.audit?.created_at ?? new Date().toISOString(),
      });
      await db.from("tickets")
        .update({ zendesk_updated_at: payload.ticket?.updated_at ?? new Date().toISOString() })
        .eq("id", ticketId);
    }

    console.log("add-internal-note", JSON.stringify({
      ticket: ticketId, by: profile.email, attachments: uploadTokens.length,
      chars: noteText(html).length,
    }));

    return json({ ticket_id: ticketId, comment_id: posted?.id ?? null });
  } catch (e) {
    if (e instanceof Denied) return json({ error: e.message }, { status: e.status });
    console.error("add-internal-note", e);
    return json({ error: "Could not post the note." }, { status: 500 });
  }
});
