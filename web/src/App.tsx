import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { pullAll, pushPending, subscribeRealtime } from "./lib/sync";
import type { Profile } from "./lib/types";
import { Login } from "./ui/Login";
import { Owner } from "./ui/Owner";
import { Staff } from "./ui/Staff";
import { ToastHost, toast } from "./ui/Toast";
import { ErrorBoundary } from "./ui/ErrorBoundary";

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [manualOffline, setManualOffline] = useState(false);
  const [navOnline, setNavOnline] = useState(navigator.onLine);
  const online = navOnline && !manualOffline;

  // ---- auth session ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---- load profile ----
  useEffect(() => {
    if (session === undefined) return;
    if (!session) { setProfile(null); return; }
    (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
      setProfile((data as Profile) ?? null);
    })();
  }, [session]);

  // ---- real network listeners ----
  useEffect(() => {
    const on = () => setNavOnline(true);
    const off = () => setNavOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ---- sync: push pending, then pull fresh ----
  const sync = useCallback(async () => {
    if (!profile || !navigator.onLine || manualOffline) return;
    try {
      const n = await pushPending();
      await pullAll(profile);
      if (n > 0) toast(`${n} entr${n === 1 ? "y" : "ies"} synced to Head Office`);
    } catch { /* stays queued, retries next time */ }
  }, [profile, manualOffline]);

  useEffect(() => { if (profile) sync(); }, [profile, sync]);
  useEffect(() => { if (online) sync(); }, [online, sync]);

  // ---- realtime (writes into local store; live UI updates) ----
  useEffect(() => {
    if (!profile) return;
    return subscribeRealtime(() => {});
  }, [profile]);

  const toggleOnline = () => {
    setManualOffline((v) => {
      const next = !v;
      toast(next ? "Offline — entries save on device" : "Back online");
      return next;
    });
  };

  const logout = async () => { await supabase.auth.signOut(); };

  if (session === undefined) return <div className="empty" style={{ marginTop: 80 }}>Loading…</div>;
  if (!session || !profile)
    return (<><Login /><ToastHost /></>);

  // Safety: a staff account with no branch assigned would otherwise crash.
  if (profile.role !== "owner" && !profile.branch_id) {
    return (
      <div className="empty" style={{ marginTop: 90, padding: 24 }}>
        Your account has no branch assigned.<br />Please ask the owner to set your branch, then sign in again.
        <div style={{ marginTop: 18 }}><button className="btn" style={{ maxWidth: 200, margin: "0 auto" }} onClick={logout}>Sign out</button></div>
      </div>
    );
  }

  const shared = { profile, online, onToggleOnline: toggleOnline, onLogout: logout, onSync: sync };
  return (
    <ErrorBoundary>
      {profile.role === "owner" ? <Owner {...shared} /> : <Staff {...shared} />}
      <ToastHost />
    </ErrorBoundary>
  );
}
