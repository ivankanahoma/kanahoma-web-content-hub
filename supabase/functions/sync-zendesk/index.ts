// Pulls the unsolved Web Team queue from Zendesk into Postgres.
//
// Runs on a schedule (every 10 minutes). Idempotent: safe to re-run at any time.
//
// Comment threads are only re-fetched when Zendesk reports the ticket changed, which
// keeps a normal run at roughly one API call regardless of queue size.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SYSTEM_AUTHOR_ID = -1; // Zendesk uses -1 for trigger-generated comments.

type Ticket = {
  id: number;
  subject: string;
  description: string;
  status: string;
  requester_id: number | null;
  assignee_id: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

type Comment = {
  id: number;
  author_id: number;
  public: boolean;
  body: string;
  plain_body?: string;
  created_at: string;
  via?: { channel?: string; source?: { rel?: string } };
};

type ZendeskUser = { id: number; name: string; email: string | null; role: string };

class Zendesk {
  private auth: string;
  constructor(private subdomain: string, email: string, token: string) {
    this.auth = "Basic " + btoa(`${email}/token:${token}`);
  }

  async get<T>(path: string): Promise<T> {
    const url = path.startsWith("http")
      ? path
      : `https://${this.subdomain}.zendesk.com${path}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(url, { headers: { Authorization: this.auth } });
      if (res.status === 429) {
        const wait = Number(res.headers.get("Retry-After") ?? 30);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (!res.ok) {
        throw new Error(`Zendesk ${res.status} on ${url}: ${await res.text()}`);
      }
      return await res.json() as T;
    }
    throw new Error(`Rate limited repeatedly on ${url}`);
  }

  /** Search caps at 1000 results, which is far above the ~60 open tickets we expect. */
  async searchTickets(query: string): Promise<Ticket[]> {
    const out: Ticket[] = [];
    let page = 1;
    while (true) {
      const res = await this.get<{ results: Ticket[]; next_page: string | null }>(
        `/api/v2/search.json?query=${encodeURIComponent(query)}&per_page=100&page=${page}`,
      );
      out.push(...res.results);
      if (!res.next_page || res.results.length === 0) break;
      page++;
    }
    return out;
  }

  async comments(ticketId: number) {
    return await this.get<{ comments: Comment[]; users: ZendeskUser[] }>(
      `/api/v2/tickets/${ticketId}/comments.json?include=users&page[size]=100`,
    );
  }

  async groupAgents(groupId: number) {
    const res = await this.get<{ users: ZendeskUser[] }>(
      `/api/v2/groups/${groupId}/users.json?page[size]=100`,
    );
    return res.users;
  }

  async findGroup(name: string) {
    const res = await this.get<{ groups: { id: number; name: string }[] }>(
      "/api/v2/groups.json?page[size]=100",
    );
    const group = res.groups.find((g) => g.name === name);
    if (!group) throw new Error(`Zendesk group "${name}" not found`);
    return group;
  }
}

/**
 * Who does this comment belong to?
 *
 * `system` covers the "You'll receive an ETA shortly" autoresponder (a trigger, so
 * author_id is -1) and the notices Zendesk writes when tickets are merged. Neither is a
 * human reply, so both are excluded from every reply-timing calculation.
 *
 * Sides are relative to the ticket, not to the person. Several CUI staff hold an agent
 * or admin role in Zendesk and still file tickets of their own; on those tickets they
 * are the requester, and their messages are what we owe an answer to. Deciding by
 * global role instead flipped such tickets to "waiting on them" while the requester
 * was in fact waiting on us.
 */
function authorSide(
  c: Comment,
  users: Map<number, ZendeskUser>,
  requesterId: number | null,
) {
  if (c.author_id === SYSTEM_AUTHOR_ID) return "system";
  if (c.via?.channel === "rule") return "system";
  if (c.via?.source?.rel === "merge") return "system";
  if (requesterId != null && c.author_id === requesterId) return "requester";
  const role = users.get(c.author_id)?.role;
  return role === "agent" || role === "admin" ? "us" : "requester";
}

function stripHtml(s: string) {
  return (s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

Deno.serve(async () => {
  const started = Date.now();
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: client, error: clientErr } = await db
    .from("clients").select("*").eq("slug", "cui").single();
  if (clientErr || !client) throw new Error("Client 'cui' not configured");

  const zd = new Zendesk(
    client.zendesk_subdomain,
    Deno.env.get("ZENDESK_EMAIL")!,
    Deno.env.get("ZENDESK_TOKEN")!,
  );

  // --- Agents: who counts as "us" ------------------------------------------
  const group = await zd.findGroup(client.zendesk_group_name);
  const agents = await zd.groupAgents(group.id);
  await db.from("zendesk_agents").upsert(
    agents.map((a) => ({
      id: a.id,
      client_id: client.id,
      name: a.name,
      email: a.email,
      role: a.role,
      active: true,
      synced_at: new Date().toISOString(),
    })),
  );

  // --- Open tickets ---------------------------------------------------------
  const open = await zd.searchTickets(
    `type:ticket group:"${client.zendesk_group_name}" status<solved`,
  );

  const { data: known } = await db
    .from("tickets")
    .select("id, zendesk_updated_at, status")
    .eq("client_id", client.id);
  const knownById = new Map((known ?? []).map((t) => [Number(t.id), t]));

  let threadsFetched = 0;

  // Fail loudly. A silently dropped write here means the queue ranks on stale data.
  const check = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`${label}: ${error.message}`);
  };

  for (const t of open) {
    // Compare as instants, not strings: Postgres renders "+00:00" where Zendesk sends
    // "Z", so a string comparison never matches and every run refetches every thread.
    const prev = knownById.get(t.id);
    const unchanged = prev &&
      new Date(prev.zendesk_updated_at).getTime() === new Date(t.updated_at).getTime();

    // The ticket row goes in first: ticket_comments carries an FK to it, so inserting
    // comments for a ticket we have not stored yet is rejected.
    check("upsert ticket", (await db.from("tickets").upsert({
      id: t.id,
      client_id: client.id,
      subject: t.subject,
      description: stripHtml(t.description),
      status: t.status,
      requester_id: t.requester_id,
      assignee_id: t.assignee_id,
      tags: t.tags ?? [],
      zendesk_created_at: t.created_at,
      zendesk_updated_at: t.updated_at,
      solved_at: null,
      synced_at: new Date().toISOString(),
    })).error);

    if (unchanged) continue;

    threadsFetched++;
    const { comments, users } = await zd.comments(t.id);
    const userById = new Map(users.map((u) => [u.id, u]));

    // Requesters are hub-side records: upsert without clobbering the VIP flag.
    const requester = t.requester_id ? userById.get(t.requester_id) : null;
    if (requester) {
      // is_vip and vip_note are omitted from the payload, so they survive the update.
      check("upsert requester", (await db.from("requesters").upsert({
        id: requester.id,
        client_id: client.id,
        name: requester.name,
        email: requester.email,
        synced_at: new Date().toISOString(),
      })).error);
    }

    const rows = comments.map((c) => ({
      id: c.id,
      ticket_id: t.id,
      author_id: c.author_id,
      author_name: userById.get(c.author_id)?.name ?? null,
      author_side: authorSide(c, userById, t.requester_id),
      is_public: c.public,
      body: stripHtml(c.plain_body ?? c.body),
      created_at: c.created_at,
    }));
    check("upsert comments", (await db.from("ticket_comments").upsert(rows)).error);

    // Real, human, customer-visible exchanges only.
    const visible = rows
      .filter((c) => c.is_public && c.author_side !== "system")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const lastComment = visible.at(-1);

    // Unanswered messages we posted in a row. One means the requester went quiet; two or
    // more means we already chased them and got nothing back.
    let trailingAgentMessages = 0;
    for (let i = visible.length - 1; i >= 0; i--) {
      if (visible[i].author_side !== "us") break;
      trailingAgentMessages++;
    }

    check("update ticket reply state", (await db.from("tickets").update({
      first_agent_reply_at:
        visible.find((c) => c.author_side === "us")?.created_at ?? null,
      last_public_comment_at: lastComment?.created_at ?? null,
      last_reply_by: lastComment?.author_side ?? null,
      public_comment_count: visible.length,
      trailing_agent_messages: trailingAgentMessages,
    }).eq("id", t.id)).error);
  }

  // --- Tickets that left the open queue since the last run ------------------
  // Anything we still hold as unsolved but Zendesk no longer returns has been solved or
  // closed. Keep it visible for 7 days, then drop it.
  const openIds = new Set(open.map((t) => t.id));
  const nowIso = new Date().toISOString();
  const justSolved = (known ?? [])
    .filter((t) => t.status !== "solved" && !openIds.has(Number(t.id)))
    .map((t) => Number(t.id));

  if (justSolved.length) {
    await db.from("tickets")
      .update({ status: "solved", solved_at: nowIso })
      .in("id", justSolved);
  }

  await db.from("tickets")
    .delete()
    .eq("status", "solved")
    .lt("solved_at", new Date(Date.now() - 7 * 864e5).toISOString());

  const summary = {
    open_tickets: open.length,
    threads_fetched: threadsFetched,
    newly_solved: justSolved.length,
    agents: agents.length,
    ms: Date.now() - started,
  };
  console.log("sync-zendesk", JSON.stringify(summary));
  return Response.json(summary);
});
