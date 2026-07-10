// Supabase Edge Function: admin-create-staff
// The OWNER creates staff accounts from inside the app — no Supabase
// dashboard needed. The owner assigns the branch & role (so staff can't
// self-grant access). Service-role key stays on the server.
//
// Deploy:  supabase functions deploy admin-create-staff
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ID_DOMAIN = "branch.local";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Confirm the caller is an owner.
  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json(401, { error: "Not signed in" });
  const { data: profile } = await caller.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "owner") return json(403, { error: "Only the owner can add staff" });

  // Validate input.
  const { name, userId, password, role, branchId } = await req.json().catch(() => ({}));
  if (!name || !userId || !password || String(password).length < 6 || !branchId)
    return json(400, { error: "name, userId, password (min 6), branchId required" });
  const finalRole = role === "owner" ? "owner" : "staff";
  const email = String(userId).includes("@") ? String(userId) : `${userId}@${ID_DOMAIN}`;

  const admin = createClient(url, service);
  const { error } = await admin.auth.admin.createUser({
    email,
    password: String(password),
    email_confirm: true,
    user_metadata: { name, role: finalRole, branch_id: branchId },
  });
  if (error) return json(400, { error: error.message.includes("already") ? `User ID "${userId}" already exists` : error.message });

  return json(200, { ok: true });
});
