import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Modal } from "./Modal";
import { toast } from "./Toast";
import type { Branch, Profile } from "../lib/types";

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
        <div className="field"><label>New password</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Min 6 chars" autoComplete="new-password" /></div>
      </div>
      <div><button className="btn" style={{ width: "auto", padding: "11px 20px" }} onClick={reset} disabled={busy}>{busy ? "Resetting…" : "Reset staff password"}</button></div>
    </div>
  );
}

/** Owner-only: create & list staff accounts, all inside the app. */
export function StaffManager({ branches }: { branches: Branch[] }) {
  const [list, setList] = useState<Profile[]>([]);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [role, setRole] = useState<"staff" | "owner">("staff");
  const [branchId, setBranchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const usable = branches.filter((b) => b.id !== "ho");

  const load = async () => {
    const { data } = await supabase.from("profiles").select("*").order("name");
    if (data) setList(data as Profile[]);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!branchId && usable[0]) setBranchId(usable[0].id); }, [branches]);

  const bmap = Object.fromEntries(branches.map((b) => [b.id, b.name.replace(" Branch", "")]));

  const add = async () => {
    if (!name.trim() || !id.trim()) return toast("Enter name and User ID");
    if (pw.length < 6) return toast("Password must be at least 6 characters");
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-create-staff", {
      body: { name: name.trim(), userId: id.trim(), password: pw, role, branchId: role === "owner" ? "ho" : branchId },
    });
    setBusy(false);
    if (error || (data as any)?.error) return toast((data as any)?.error || "Could not create — is the function deployed?");
    toast(`Staff "${id.trim()}" created`);
    setName(""); setId(""); setPw(""); setShow(false); load();
  };

  return (
    <>
      <div className="card-head" style={{ padding: "0 0 12px" }}>
        <h3 style={{ margin: 0 }}>Staff accounts</h3>
        <button className="add-btn" onClick={() => setShow(true)}>+ Add staff</button>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>User ID</th><th>Branch</th><th className="r">Role</th></tr></thead>
        <tbody>
          {list.length ? list.map((u) => (
            <tr key={u.id}><td>{u.name}</td><td>{u.phone || "—"}</td><td>{bmap[u.branch_id ?? ""] || "—"}</td>
              <td className="r"><span className="badge role">{u.role}</span></td></tr>
          )) : <tr><td colSpan={4}><div className="empty">Loading… (or none yet)</div></td></tr>}
        </tbody>
      </table></div>

      {show && (
        <Modal title="Add staff member" onClose={() => setShow(false)}>
          <div className="form-grid">
            <div className="field"><label>Full name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ravi Kumar" /></div>
            <div className="qty-row">
              <div className="field"><label>Login ID</label><input value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. seppa2" autoCapitalize="none" /></div>
              <div className="field"><label>Password</label><input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Min 6 chars" /></div>
            </div>
            <div className="qty-row">
              <div className="field"><label>Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value as any)}><option value="staff">Staff</option><option value="owner">Owner</option></select></div>
              <div className="field"><label>Branch</label>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={role === "owner"}>
                  {usable.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></div>
            </div>
            <div className="btn-row"><button className="btn ghost" onClick={() => setShow(false)}>Cancel</button><button className="btn" onClick={add} disabled={busy}>{busy ? "Creating…" : "Create staff"}</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}
