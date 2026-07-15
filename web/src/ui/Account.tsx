import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Modal } from "./Modal";
import { toast } from "./Toast";
import type { Branch } from "../lib/types";

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

type Account = { id: string; name: string; role: "owner" | "staff"; branch_id: string | null; loginId: string; isRealEmail: boolean };

/** Owner-only: list every account (name, login ID, branch, role) with a real
 *  login ID pulled from auth.users via the admin-list-accounts function, and
 *  edit (name / login ID / password) any of them — including themselves —
 *  via admin-update-account. Both Edge Functions verify server-side that the
 *  caller is the owner before touching anything; the service-role key never
 *  reaches the browser. */
export function ManageAccounts({ branches, myId }: { branches: Branch[]; myId: string }) {
  const [list, setList] = useState<Account[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [edit, setEdit] = useState<Account | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const usable = branches.filter((b) => b.id !== "ho");
  const bmap = Object.fromEntries(branches.map((b) => [b.id, b.name.replace(" Branch", "")]));

  const load = async () => {
    const { data, error } = await supabase.functions.invoke("admin-list-accounts");
    if (error || (data as any)?.error) { setLoadErr((data as any)?.error || "Could not load accounts — is admin-list-accounts deployed?"); return; }
    setList((data as any).accounts as Account[]);
  };
  useEffect(() => { load(); }, []);

  return (
    <>
      <div className="card-head" style={{ padding: "0 0 12px" }}>
        <h3 style={{ margin: 0 }}>Manage Accounts</h3>
        <button className="add-btn" onClick={() => setAddOpen(true)}>+ Add staff</button>
      </div>
      {loadErr && <p style={{ color: "var(--red)", fontSize: 13, margin: "0 0 12px" }}>{loadErr}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>User ID</th><th>Branch</th><th>Role</th><th className="r"></th></tr></thead>
        <tbody>
          {list === null ? <tr><td colSpan={5}><div className="empty">Loading…</div></td></tr> :
          list.length ? list.map((u) => (
            <tr key={u.id}>
              <td>{u.name}{u.id === myId ? <span className="b-tag" style={{ marginLeft: 6 }}>You</span> : ""}</td>
              <td>{u.loginId}{u.isRealEmail && <div style={{ fontSize: 10.5, color: "var(--faint)" }}>real email · forgot-password works</div>}</td>
              <td>{bmap[u.branch_id ?? ""] || "—"}</td>
              <td><span className="badge role">{u.role}</span></td>
              <td className="r"><button className="edit-btn" onClick={() => setEdit(u)}>Edit</button></td>
            </tr>
          )) : <tr><td colSpan={5}><div className="empty">No accounts yet.</div></td></tr>}
        </tbody>
      </table></div>

      {edit && <EditAccountModal account={edit} isSelf={edit.id === myId} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {addOpen && <AddStaffModal branches={usable} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load(); }} />}
    </>
  );
}

function EditAccountModal({ account, isSelf, onClose, onSaved }: { account: Account; isSelf: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(account.name);
  const [loginId, setLoginId] = useState(account.loginId);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const patch: Record<string, unknown> = { targetId: account.id };
    if (name.trim() && name.trim() !== account.name) patch.name = name.trim();
    if (loginId.trim() && loginId.trim() !== account.loginId) patch.newUserId = loginId.trim();
    if (pw) { if (pw.length < 6) return toast("Password must be at least 6 characters"); patch.newPassword = pw; }
    if (Object.keys(patch).length === 1) return toast("Nothing changed");
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-update-account", { body: patch });
    setBusy(false);
    if (error || (data as any)?.error) return toast((data as any)?.error || "Could not save — is admin-update-account deployed?");
    toast(isSelf && (patch.newUserId || patch.newPassword) ? "Saved — use the new ID/password next time you sign in" : "Account updated");
    onSaved();
  };

  return (
    <Modal title={isSelf ? "Edit my account" : `Edit ${account.name}`} onClose={onClose}>
      <div className="form-grid">
        <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field">
          <label>User ID (login)</label>
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoCapitalize="none" placeholder="e.g. seppa, or a real email" />
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Tip: use a real email address here (e.g. yours@gmail.com) to enable "Forgot password" reset emails for this account.</div>
        </div>
        <div className="field"><label>New password (optional)</label><input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Leave blank to keep current password" /></div>
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
      </div>
    </Modal>
  );
}

function AddStaffModal({ branches, onClose, onSaved }: { branches: Branch[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [role, setRole] = useState<"staff" | "owner">("staff");
  const [branchId, setBranchId] = useState(branches[0]?.id || "");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim() || !id.trim()) return toast("Enter name and User ID");
    if (pw.length < 6) return toast("Password must be at least 6 characters");
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-create-staff", {
      body: { name: name.trim(), userId: id.trim(), password: pw, role, branchId: role === "owner" ? "ho" : branchId },
    });
    setBusy(false);
    if (error || (data as any)?.error) return toast((data as any)?.error || "Could not create — is admin-create-staff deployed?");
    toast(`Staff "${id.trim()}" created`);
    onSaved();
  };

  return (
    <Modal title="Add staff member" onClose={onClose}>
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
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></div>
        </div>
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={add} disabled={busy}>{busy ? "Creating…" : "Create staff"}</button></div>
      </div>
    </Modal>
  );
}
