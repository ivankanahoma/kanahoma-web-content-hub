// Moves a ticket between open, pending and solved in Zendesk.
//
// The third and last thing the hub writes. Same rules as the other two: the caller's role
// is checked against their own token, and nothing else on the ticket is touched.
//
// Only three states are settable. `new` is Zendesk's own word for "nobody has replied
// yet" and is not something to hand back to a ticket; `closed` is terminal and set by
// Zendesk's automations, not by people. Naming them here rather than passing through
// whatever arrives keeps both out.
//
// Solving is quiet: checked against CUI's live triggers, nothing emails the requester on
// a status change. Reopening a solved ticket does notify its assignee, which is Zendesk's
// own trigger and the right behaviour.

import { createClient } from "jsr:@supabase/supabase-js@2";

import { json, preflight } from "../_shared/cors.ts";
import { Denied, requireRole } from "../_shared/auth.ts";

const SETTABLE = new Set(["open", "pending", "solved"]);

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  try {
    const { profile } = await requireRole(req, ["admin", "manager"]);

    const { ticket_id: ticketId, status } = await req.json().catch(() => ({}));
    if (!ticketId) return json({ error: "ticket_id is required" }, { status: 400 });
    if (!SETTABLE.has(status)) {
      return json(
        { error: `Status must be one of ${[...SETTABLE].join(", ")}.` },
        { status: 400 },
      );
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: ticket } = await db
      .from("tickets").select("id, client_id, status").eq("id", ticketId).maybeSingle();
    if (!ticket) return json({ error: "unknown ticket" }, { status: 404 });
    if (ticket.status === status) {
      return json({ ticket_id: ticketId, status, unchanged: true });
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
        body: JSON.stringify({ ticket: { status } }),
      },
    );

    if (!res.ok) {
      const detail = await res.text();
      console.error("zendesk status", res.status, detail);
      return json(
        { error: `Zendesk refused the change (${res.status}).` },
        { status: 502 },
      );
    }

    const applied = (await res.json()).ticket?.status ?? status;

    // solved_at drives the 7 day grace window before a ticket drops out of the mirror.
    // Reopening has to clear it, or the ticket disappears while it is being worked on.
    await db.from("tickets").update({
      status: applied,
      solved_at: applied === "solved" ? new Date().toISOString() : null,
      synced_at: new Date().toISOString(),
    }).eq("id", ticketId);

    console.log("set-ticket-status", JSON.stringify({
      ticket: ticketId, from: ticket.status, to: applied, by: profile.email,
    }));

    return json({ ticket_id: ticketId, status: applied });
  } catch (e) {
    if (e instanceof Denied) return json({ error: e.message }, { status: e.status });
    console.error("set-ticket-status", e);
    return json({ error: "Could not change the status." }, { status: 500 });
  }
});
