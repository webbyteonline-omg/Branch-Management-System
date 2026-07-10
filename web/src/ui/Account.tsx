import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Modal } from "./Modal";
import { toast } from "./Toast";

/** Any logged-in user can change their own password. Updates instantly. */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (pw.length < 6) return toast("Password must be at least 6 characters");
    if (pw !== pw2) return toast("Passwords don't match");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast("Could not update — sign in again and retry");
    toast("Password changed");
    onClose();
  };

  return (
    <Modal title="Change my password" onClose={onClose}>
      <div className="form-grid">
        <div className="field"><label>New password</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 6 characters" /></div>
        <div className="field"><label>Confirm new password</label><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Update password"}</button></div>
      </div>
    </Modal>
  );
}

/** Owner-only: reset any staff member's password by their User ID.
 *  Calls a secure Edge Function (service-role stays on the server). */
export function ResetStaffPassword() {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    if (!id.trim()) return toast("Enter the staff User ID");
    if (pw.length < 6) return toast("Password must be at least 6 characters");
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-reset-password", {
      body: { userId: id.trim(), newPassword: pw },
    });
    setBusy(false);
    if (error || (data as any)?.error) return toast((data as any)?.error || "Reset failed — check the ID");
    toast(`Password reset for ${id.trim()}`);
    setId(""); setPw("");
  };

  return (
    <div className="form-grid">
      <div className="qty-row">
        <div className="field"><label>Staff User ID</label><input value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. seppa" autoCapitalize="none" /></div>
        <div className="field"><label>New password</label><input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Min 6 chars" /></div>
      </div>
      <div><button className="btn" style={{ width: "auto", padding: "11px 20px" }} onClick={reset} disabled={busy}>{busy ? "Resetting…" : "Reset staff password"}</button></div>
    </div>
  );
}
