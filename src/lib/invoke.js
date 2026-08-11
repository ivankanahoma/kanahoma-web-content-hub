import { supabase } from "./supabase";

/**
 * `functions.invoke` on its own reports "Edge Function returned a non-2xx status code"
 * and drops the body, so a function that explained exactly what was wrong arrives as a
 * message nobody can act on. The real error is on `error.context`, which is the Response.
 */
export async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  // Some paths return 200 with an error field rather than a status code.
  if (data?.error) throw new Error(data.error);

  return data;
}
