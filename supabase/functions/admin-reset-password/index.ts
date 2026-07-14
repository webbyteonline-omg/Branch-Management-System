// Supabase Edge Function: admin-reset-password
// Lets the OWNER set a new password for any staff member by their User ID.
// The service-role key never leaves the server. The caller's JWT is checked
// to confirm they are an owner before anything happens.
//
// Deploy:  supabase functions deploy admin-reset-password
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Only these origins may call this function from a browser.
const ALLOWED_ORIGINS = [
  "https://branch-management-system-gray.vercel.app",
  "http://localhost:5173", // local dev
];
const corsFor = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (status: number, body: unknown, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ID_DOMAIN = "branch.local";

Deno.serve(async (req) => {
  const cors = corsFor(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. Identify the caller from their JWT and confirm they are an owner.
  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json(401, { error: "Not signed in" }, cors);

  const { data: profile } = await caller.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "owner") return json(403, { error: "Only the owner can reset passwords" }, cors);

  // 2. Validate input.
  const { userId, newPassword } = await req.json().catch(() => ({}));
  if (!userId || !newPassword || String(newPassword).length < 6)
    return json(400, { error: "userId and newPassword (min 6 chars) required" }, cors);
  const email = String(userId).includes("@") ? String(userId) : `${userId}@${ID_DOMAIN}`;

  // 3. Find the target user and update the password with the service role.
  const admin = createClient(url, service);
  let target: { id: string } | undefined;
  for (let page = 1; page <= 20 && !target; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return json(500, { error: error.message }, cors);
    target = data.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (data.users.length < 200) break;
  }
  if (!target) return json(404, { error: `No user found for "${userId}"` }, cors);

  const { error: updErr } = await admin.auth.admin.updateUserById(target.id, { password: String(newPassword) });
  if (updErr) return json(500, { error: updErr.message }, cors);

  return json(200, { ok: true }, cors);
});
