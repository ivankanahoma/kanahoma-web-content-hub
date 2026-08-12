// Sets a ticket's assignee in Zendesk.
//
// This is the only place the hub writes to Zendesk. Everything else mirrors it and Zendesk
// stays the system of record, so the rules here are deliberately narrow:
//
//  - admin and manager only, checked against the caller's own JWT rather than trusted from
//    the request body;
//  - the assignee has to be a current member of the Web Team group, so this cannot be used
//    to move work out of the queue it belongs to;
//  - nothing else on the ticket is touched. No status, no comment, no tags.
//
// The local row is updated to match so the queue reflects the change before the next sync,
// but Zendesk is written first: if that fails there is nothing to undo.

import { createClient } from "jsr:@supabase/supabase-js@2";

import { json, preflight } from "../_shared/cors.ts";
import { Denied, requireRole } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  try {
    const { profile } = await requireRole(req, ["admin", "manager"]);

    const { ticket_id: ticketId, assignee_id: rawAssignee } = await req.json()
      .catch(() => ({}));
    if (!ticketId) return json({ error: "ticket_id is required" }, { status: 400 });

    // null is a real value here: it means unassign.
    const assigneeId = rawAssignee == null ? null : Number(rawAssignee);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: ticket } = await db
      .from("tickets").select("id, client_id, assignee_id").eq("id", ticketId).maybeSingle();
    if (!ticket) return json({ error: "unknown ticket" }, { status: 404 });

    if (assigneeId != null) {
      const { data: agent } = await db
        .from("zendesk_agents")
        .select("id, name")
        .eq("id", assigneeId)
        .eq("client_id", ticket.client_id)
        .maybeSingle();
      if (!agent) {
        return json(
          { error: "That person is not in the Web Team group in Zendesk." },
          { status: 400 },
        );
      }
    }

    const { data: client } = await db
      .from("clients").select("zendesk_subdomain").eq("id", ticket.client_id).single();

    const auth = "Basic " + btoa(
      `${Deno.env.get("ZENDESK_EMAIL")}/token:${Deno.env.get("ZENDESK_TOKEN")}`,
    );
    const res = await fetch(
      `https://${client.zendesk_subdomain}.zendesk.com/api/v2/tickets/${ticketId}.json`,
      {
        method: "PUT",
        headers: { Authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ ticket: { assignee_id: assigneeId } }),
      },
    );

    if (!res.ok) {
      const detail = await res.text();
      console.error("zendesk assign", res.status, detail);
      return json({ error: `Zendesk refused the change (${res.status}).` }, { status: 502 });
    }

    const updated = await res.json();
    const applied = updated.ticket?.assignee_id ?? null;

    await db.from("tickets")
      .update({ assignee_id: applied, synced_at: new Date().toISOString() })
      .eq("id", ticketId);

    console.log("assign-ticket", JSON.stringify({
      ticket: ticketId,
      from: ticket.assignee_id,
      to: applied,
      by: profile.email,
    }));

    return json({ ticket_id: ticketId, assignee_id: applied });
  } catch (e) {
    if (e instanceof Denied) return json({ error: e.message }, { status: e.status });
    console.error("assign-ticket", e);
    return json({ error: "Could not assign the ticket." }, { status: 500 });
  }
});
