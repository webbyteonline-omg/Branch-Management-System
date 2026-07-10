import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  // Helpful during setup — the app still loads and shows the login screen.
  console.warn("Supabase env not set. Copy .env.example → .env and fill it in.");
}

export const supabase = createClient(url ?? "", key ?? "", {
  auth: { persistSession: true, autoRefreshToken: true },
});
