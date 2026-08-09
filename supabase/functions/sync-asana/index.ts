// Mirrors the incomplete Asana tasks assigned to the token's owner.
//
// Read-only: the hub never writes back to Asana. A task that stops coming back from the
// API has been completed, reassigned or deleted, so it is removed from the mirror.

import { createClient } from "jsr:@supabase/supabase-js@2";

const API = "https://app.asana.com/api/1.0";

const FIELDS = [
  "name",
  "notes",
  "due_on",
  "due_at",
  "modified_at",
  "permalink_url",
  "assignee.gid",
  "projects.name",
].join(",");

type AsanaTask = {
  gid: string;
  name: string;
  notes?: string;
  due_on?: string | null;
  due_at?: string | null;
  modified_at?: string;
  permalink_url?: string;
  assignee?: { gid: string } | null;
  projects?: { name: string }[];
};

async function asana<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Asana ${res.status} on ${path}: ${await res.text()}`);
  }
  const body = await res.json();
  return body.data as T;
}

Deno.serve(async () => {
  const started = Date.now();
  const token = Deno.env.get("ASANA_TOKEN");
  if (!token) {
    return Response.json(
      { error: "ASANA_TOKEN is not set as an Edge Function secret" },
      { status: 400 },
    );
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const me = await asana<{ gid: string; name: string; workspaces: { gid: string; name: string }[] }>(
    "/users/me?opt_fields=name,workspaces.name",
    token,
  );

  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];

  for (const workspace of me.workspaces ?? []) {
    // `completed_since=now` is Asana's documented way of asking for incomplete tasks
    // only. `assignee` requires `workspace` alongside it.
    const tasks = await asana<AsanaTask[]>(
      `/tasks?assignee=${me.gid}&workspace=${workspace.gid}` +
      `&completed_since=now&limit=100&opt_fields=${FIELDS}`,
      token,
    );

    for (const t of tasks) {
      seen.add(t.gid);
      rows.push({
        gid: t.gid,
        workspace_gid: workspace.gid,
        name: t.name,
        notes: (t.notes ?? "").slice(0, 4000),
        permalink_url: t.permalink_url ?? null,
        due_on: t.due_on ?? null,
        due_at: t.due_at ?? null,
        project_names: (t.projects ?? []).map((p) => p.name),
        assignee_gid: t.assignee?.gid ?? me.gid,
        modified_at: t.modified_at ?? null,
        synced_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length) {
    const { error } = await db.from("asana_tasks").upsert(rows);
    if (error) throw new Error(`upsert tasks: ${error.message}`);
  }

  // Anything we hold that Asana no longer returns is done or no longer ours.
  const { data: stored } = await db.from("asana_tasks").select("gid");
  const stale = (stored ?? []).map((r) => r.gid).filter((gid) => !seen.has(gid));
  if (stale.length) await db.from("asana_tasks").delete().in("gid", stale);

  const summary = {
    user: me.name,
    workspaces: (me.workspaces ?? []).length,
    open_tasks: rows.length,
    removed: stale.length,
    ms: Date.now() - started,
  };
  console.log("sync-asana", JSON.stringify(summary));
  return Response.json(summary);
});
