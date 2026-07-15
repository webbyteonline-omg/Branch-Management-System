// Supabase Edge Function: admin-update-account
// Lets the OWNER update any account's name, User ID (login email), and/or
// password — including their own — all from inside the app. Also used for
// self-service edits (owner editing their own row goes through the same
// path, still checked server-side). Service-role key never leaves the server.
//
// Deploy:  supabase functions deploy admin-update-account --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
const toEmail = (input: string) => (String(input).includes("@") ? String(input) : `${input}@${ID_DOMAIN}`);

Deno.serve(async (req) => {
  const cors = corsFor(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. Identify the caller and confirm they are an owner.
  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json(401, { error: "Not signed in" }, cors);
  const { data: callerProfile } = await caller.from("profiles").select("role").eq("id", user.id).single();
  if (callerProfile?.role !== "owner") return json(403, { error: "Only the owner can edit accounts" }, cors);

  // 2. Validate input. targetUserId = the profile id (uuid) being edited —
  //    the owner can pass their own id to edit themselves.
  const { targetId, name, newUserId, newPassword } = await req.json().catch(() => ({}));
  if (!targetId) return json(400, { error: "targetId required" }, cors);
  if (!name && !newUserId && !newPassword) return json(400, { error: "Nothing to update" }, cors);
  if (newPassword && String(newPassword).length < 6) return json(400, { error: "Password must be at least 6 characters" }, cors);

  const admin = createClient(url, service);

  // 3. Apply auth-level changes (email/password) via the admin API.
  const authUpdate: Record<string, unknown> = {};
  if (newUserId) authUpdate.email = toEmail(newUserId);
  if (newPassword) authUpdate.password = String(newPassword);
  if (Object.keys(authUpdate).length > 0) {
    const { error } = await admin.auth.admin.updateUserById(targetId, authUpdate as any);
    if (error) return json(400, { error: error.message.includes("already") ? `That User ID is already taken` : error.message }, cors);
  }

  // 4. Apply profile-level changes (display name) directly — RLS is
  //    bypassed here since we're on the service-role client and we've
  //    already confirmed the caller is the owner above.
  if (name) {
    const { error } = await admin.from("profiles").update({ name: String(name).trim() }).eq("id", targetId);
    if (error) return json(400, { error: error.message }, cors);
  }

  return json(200, { ok: true }, cors);
});
