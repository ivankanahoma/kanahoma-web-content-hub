// Who is calling, and are they allowed to?
//
// Edge Functions run as the service role and bypass RLS entirely. For a function that
// only reads, that is fine. For one that writes to Zendesk it is not: every signed-in
// account, including a viewer or a student worker, reaches the same endpoint with a valid
// JWT. RLS is not protecting anything here, so the check has to be written out.
//
// The token is verified by calling getUser with it rather than by decoding it locally. A
// JWT is trivially forgeable if nobody checks the signature, and decoding is not checking.

import { createClient } from "jsr:@supabase/supabase-js@2";

export class Denied extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
  }
}

/**
 * Resolve the caller and assert their hub role. Throws Denied, which the caller turns
 * into a response.
 */
export async function requireRole(req: Request, allowed: string[]) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Denied("Not signed in.", 401);

  const auth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  const { data: { user }, error } = await auth.auth.getUser();
  if (error || !user) throw new Denied("Not signed in.", 401);

  // Read the role with the service key: app_users is behind RLS and a content_editor
  // cannot read the users table at all, which would look identical to having no role.
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: profile } = await db
    .from("app_users").select("role, full_name, email").eq("id", user.id).maybeSingle();

  if (!profile || !allowed.includes(profile.role)) {
    throw new Denied(
      `This needs ${allowed.join(" or ")}. Your account is ${profile?.role ?? "unassigned"}.`,
    );
  }

  return { user, profile };
}
