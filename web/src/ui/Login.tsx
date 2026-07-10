import { useState } from "react";
import { supabase } from "../lib/supabase";
import { idToEmail } from "../lib/auth";

export function Login() {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const submit = async () => {
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: idToEmail(userId), password });
    setBusy(false);
    if (error) setErr("Wrong ID or password.");
  };

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
        <button className="btn" onClick={submit} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <div className="err">{err}</div>
        <button className="forgot-link" onClick={() => setShowForgot((v) => !v)}>Forgot password?</button>
        {showForgot && (
          <div className="hint" style={{ textAlign: "left" }}>
            After signing in, anyone can change their own password from the account menu (top-right) — it updates instantly.<br /><br />
            Locked out? Ask the <b>owner</b> to reset it — the owner can set a new password for any staff from <b>Settings → Staff passwords</b> (or the Supabase dashboard). It takes effect immediately.
          </div>
        )}
      </div>
    </div>
  );
}
