import { useState } from "react";
import { supabase } from "../lib/supabase";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr("Wrong email or password.");
  };

  return (
    <div className="login">
      <div className="brand"><img src="/icon.svg" alt="" /><b>BranchManager</b></div>
      <div className="login-card">
        <h1>Sign in</h1>
        <p className="sub">Multi-branch sales & tracking system</p>
        <div className="field">
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)}
            type="email" placeholder="you@shop.com" autoComplete="username"
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
        <div className="hint">Staff accounts are created by the owner in Settings. Forgot password? Ask the owner to reset it.</div>
      </div>
    </div>
  );
}
