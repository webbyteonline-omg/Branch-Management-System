import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { ensureDbReady } from "./lib/db";
import { pullAll, pushPending, subscribeRealtime } from "./lib/sync";
import type { Profile } from "./lib/types";
import { Login } from "./ui/Login";
import { Owner } from "./ui/Owner";
import { Staff } from "./ui/Staff";
import { ToastHost, toast } from "./ui/Toast";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { SplashScreen } from "./ui/Splash";

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [navOnline, setNavOnline] = useState(navigator.onLine);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  // No manual offline toggle — every write already saves to the device first
  // and syncs automatically the instant real network is available. Staff and
  // owner never have to think about "online vs offline" at all.
  const online = navOnline;

  // ---- local database must actually open before anything can safely write
  // to it (full storage / private browsing / a corrupted DB can all make
  // this fail). If it can't, block with a clear message instead of letting
  // every save silently do nothing later. ----
  useEffect(() => {
    ensureDbReady().then((r) => { if (!r.ok) setDbError(r.message); });
  }, []);

  // ---- catch anything that slips past a component's own try/catch (a
  // React ErrorBoundary does NOT catch errors thrown inside event handlers
  // or async functions — only render-time errors) so a bug in a save/delete
  // handler never fails completely silently with no feedback at all. ----
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      console.error("[unhandled]", e.reason);
      toast("Something went wrong — please try that again.");
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

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
  // Tracks the last-seen error signature so a persistent failure (e.g. the
  // app was updated but the database schema wasn't) surfaces once clearly
  // instead of either spamming a toast every 20s or — the old bug — staying
  // completely silent while data never reaches Head Office.
  const lastSyncErrorRef = useRef<string | null>(null);
  const sync = useCallback(async () => {
    if (!profile || !navigator.onLine) return;
    setSyncing(true);
    try {
      const { pushed, errors } = await pushPending();
      if (errors.length > 0) {
        const msg = `${errors[0].table}: ${errors[0].cause?.message || "sync failed"}`;
        setSyncError(msg);
        const sig = errors.map((e) => e.table + ":" + e.message).join("|");
        if (sig !== lastSyncErrorRef.current) {
          lastSyncErrorRef.current = sig;
          toast(`Sync problem: ${errors[0].table} didn't save to Head Office (${errors[0].cause?.message || "unknown error"}). Entry stays saved on this device.`);
        }
      } else {
        setSyncError(null);
        lastSyncErrorRef.current = null;
      }
      await pullAll(profile);
      setLastSyncedAt(new Date().toISOString());
      if (pushed > 0) toast(`${pushed} entr${pushed === 1 ? "y" : "ies"} synced to Head Office`);
    } catch (e) {
      console.error("[sync] unexpected failure:", e);
    } finally {
      setSyncing(false);
    }
  }, [profile]);

  useEffect(() => { if (profile) sync(); }, [profile, sync]);
  useEffect(() => { if (online) sync(); }, [online, sync]);

  // ---- realtime (writes into local store; live UI updates) ----
  useEffect(() => {
    if (!profile) return;
    return subscribeRealtime(() => {});
  }, [profile]);

  // Safety net: mountain internet drops WebSockets silently sometimes, and a
  // dropped Realtime channel doesn't always self-heal. A light background
  // pull every 20s keeps the owner's dashboard correct even if the live
  // socket died, with no visible delay for the user.
  useEffect(() => {
    if (!profile) return;
    const id = setInterval(() => { if (navigator.onLine) sync(); }, 20_000);
    return () => clearInterval(id);
  }, [profile, sync]);

  // Also re-sync whenever the tab regains focus/visibility — covers the
  // common case of switching apps and coming back.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") sync(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [sync]);

  const logout = async () => { await supabase.auth.signOut(); };

  // Local storage genuinely failed to open — every save would silently do
  // nothing from here on, so stop and say so clearly instead.
  if (dbError) {
    return (
      <div className="empty" style={{ marginTop: 90, padding: 24, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: "var(--red)", marginBottom: 8 }}>Couldn't open local storage</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)" }}>This usually means the device is out of storage space, or the browser is in a private/locked-down mode. Free up space or try a normal browser tab, then reload.</div>
        <div style={{ marginTop: 18 }}><button className="btn" style={{ maxWidth: 200, margin: "0 auto" }} onClick={() => location.reload()}>Reload</button></div>
      </div>
    );
  }

  // Still figuring out auth state, or we have a session but the matching
  // profile row hasn't loaded yet — show the splash, never the login form.
  // Without this, a logged-in user sees a 1-2s flash of "Login" every time
  // the app opens, because `profile` resolves slightly after `session`.
  if (session === undefined || (session && !profile)) return <SplashScreen />;
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

  const shared = { profile, online, onLogout: logout, onSync: sync, syncError, syncing, lastSyncedAt };
  return (
    <ErrorBoundary>
      {profile.role === "owner" ? <Owner {...shared} /> : <Staff {...shared} />}
      <ToastHost />
    </ErrorBoundary>
  );
}
