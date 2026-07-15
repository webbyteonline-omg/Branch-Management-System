import { useState } from "react";
import { supabase } from "../lib/supabase";
import { idToEmail } from "../lib/auth";

export function Login() {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const [resetSent, setResetSent] = useState(false);

  const sendResetEmail = async () => {
    if (!userId.includes("@")) return;
    const { error } = await supabase.auth.resetPasswordForEmail(userId.trim());
    if (!error) setResetSent(true);
  };

  const submit = async () => {
    if (Date.now() < lockUntil) return;
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: idToEmail(userId), password });
    setBusy(false);
    if (error) {
      const n = fails + 1;
      setFails(n);
      // Brief cooldown after repeated wrong attempts — slows down guessing scripts.
      if (n >= 5) { setLockUntil(Date.now() + 30_000); setErr("Too many attempts. Wait 30 seconds and try again."); }
      else setErr("Wrong ID or password.");
    } else {
      setFails(0);
    }
  };
  const locked = Date.now() < lockUntil;

  return (
    <div className="login">
      <div className="brand"><img src="/icon.svg" alt="" /><b>BranchManager</b></div>
      <div className="login-card">
        <h1>Sign in</h1>
        <p className="sub">Multi-branch sales & tracking system</p>
        <div className="field">
          <label>User ID</label>
          <input value={userId} onChange={(e) => setUserId(e.target.value)}
            type="text" placeholder="e.g. seppa" autoCapitalize="none" autoComplete="username"
            onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <div className="field">
          <label>Password</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)}
            type="password" placeholder="••••••••" autoComplete="current-password"
            onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <button className="btn" onClick={submit} disabled={busy || locked}>{busy ? "Signing in…" : locked ? "Please wait…" : "Sign in"}</button>
        <div className="err">{err}</div>
        <button className="forgot-link" onClick={() => setShowForgot((v) => !v)}>Forgot password?</button>
        {showForgot && (
          <div className="hint" style={{ textAlign: "left" }}>
            After signing in, anyone can change their own password from the account menu (top-right) — it updates instantly.<br /><br />
            Locked out? Ask the <b>owner</b> to reset it — the owner can set a new password for any account from <b>Settings → Manage Accounts</b>. It takes effect immediately.
            {userId.includes("@") && (
              <>
                <br /><br />
                Your ID looks like a real email — {resetSent
                  ? <>a password reset link has been sent to <b>{userId.trim()}</b>. Check your inbox.</>
                  : <>you can also <button type="button" className="forgot-link" style={{ display: "inline", margin: 0, padding: 0, fontSize: 13 }} onClick={sendResetEmail}>send yourself a reset link</button> right now.</>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
