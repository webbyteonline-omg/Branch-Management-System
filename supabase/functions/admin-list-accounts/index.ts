// Supabase Edge Function: admin-list-accounts
// Returns every account (id, name, role, branch, login ID/email) so the
// owner's "Manage Accounts" screen can show + edit the real login ID —
// which lives on auth.users, not on public.profiles, so the anon client
// can never see it directly. Service-role key never leaves the server.
//
// Deploy:  supabase functions deploy admin-list-accounts --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://branch-management-system-gray.vercel.app",
  "http://localhost:5173",
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

  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json(401, { error: "Not signed in" }, cors);
  const { data: callerProfile } = await caller.from("profiles").select("role").eq("id", user.id).single();
  if (callerProfile?.role !== "owner") return json(403, { error: "Only the owner can view accounts" }, cors);

  const admin = createClient(url, service);
  const { data: profiles, error: pErr } = await admin.from("profiles").select("id,name,role,branch_id").order("name");
  if (pErr) return json(500, { error: pErr.message }, cors);

  // Pull every auth user (paginated) to map id -> email/login id.
  const emailById: Record<string, string> = {};
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return json(500, { error: error.message }, cors);
    for (const u of data.users) emailById[u.id] = u.email ?? "";
    if (data.users.length < 200) break;
  }

  const accounts = (profiles ?? []).map((p: any) => {
    const email = emailById[p.id] || "";
    const loginId = email.endsWith(`@${ID_DOMAIN}`) ? email.slice(0, -(`@${ID_DOMAIN}`.length)) : email;
    return { id: p.id, name: p.name, role: p.role, branch_id: p.branch_id, loginId, isRealEmail: !!email && !email.endsWith(`@${ID_DOMAIN}`) };
  });

  return json(200, { accounts }, cors);
});
