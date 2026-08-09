import { createClient } from "@supabase/supabase-js";

// Public by design. The publishable key only permits what RLS allows, and every view is
// security_invoker, so an unauthenticated session reads nothing.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_KEY,
);
