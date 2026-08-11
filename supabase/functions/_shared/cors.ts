// CORS for the functions the browser calls directly.
//
// `supabase.functions.invoke` sends an Authorization header, which makes it a non-simple
// request, so the browser fires an OPTIONS preflight first. A function that answers that
// preflight with anything other than 2xx and these headers is unreachable from the SPA:
// the call fails in the browser before the function ever runs, and the error surfaces as
// a bare "Failed to send a request to the Edge Function" with nothing in the logs.
//
// Functions driven by pg_cron (sync-zendesk, enrich-tickets) never need this. Only the
// ones invoked from the page do.

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** Answer the preflight before doing anything else, including reading the body. */
export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS"
    ? new Response(null, { status: 204, headers: CORS_HEADERS })
    : null;
}

/** Drop-in for Response.json that keeps the headers on every path, errors included. */
export function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...CORS_HEADERS, "content-type": "application/json", ...init.headers },
  });
}
