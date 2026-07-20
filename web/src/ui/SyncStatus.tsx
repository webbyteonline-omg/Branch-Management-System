import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { pendingBreakdown } from "../lib/db";
import { timeAgo } from "../lib/format";
import { Icon } from "../lib/icons";
import type { SharedProps } from "./shared";

/** Only ever opened from the header's "Sync issue" warning — routine sync
 *  state is invisible by design (writes are always saved locally first and
 *  upload automatically in the background). This just explains what's wrong
 *  and shows exactly what hasn't reached the server yet. */
export function SyncStatusModal({ shared, onClose }: { shared: SharedProps; onClose: () => void }) {
  const [breakdown, setBreakdown] = useState<{ table: string; label: string; count: number }[]>([]);
  useEffect(() => {
    let stop = false;
    const load = () => pendingBreakdown().then((b) => { if (!stop) setBreakdown(b); });
    load();
    const id = setInterval(load, 3000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  const totalPending = breakdown.reduce((a, b) => a + b.count, 0);
  const state: "error" | "pending" | "synced" =
    shared.syncError ? "error" : totalPending > 0 ? "pending" : "synced";

  const stateCopy: Record<typeof state, { title: string; body: string; color: string }> = {
    error: { title: "Sync problem", body: shared.syncError || "Something didn't reach the server. Your data is safe on this device — we'll keep retrying automatically.", color: "var(--red)" },
    pending: { title: "Catching up", body: "This is saved safely on this device and is uploading now.", color: "var(--amber)" },
    synced: { title: "All good now", body: "Everything on this device has reached the server.", color: "var(--green)" },
  };
  const copy = stateCopy[state];

  return (
    <Modal title="Sync status" onClose={onClose}>
      <div className="form-grid">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--line)" }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: copy.color + "22", color: copy.color, display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Icon name={state === "synced" ? "check" : "sync"} size={19} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: copy.color }}>{copy.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{copy.body}</div>
          </div>
        </div>

        <div className="row" style={{ padding: "8px 0" }}>
          <span className="sub">Last synced</span>
          <b style={{ fontSize: 13 }}>{shared.syncing ? "Syncing…" : timeAgo(shared.lastSyncedAt)}</b>
        </div>

        {breakdown.length > 0 && (
          <div>
            <div className="t-label" style={{ margin: "4px 0 6px" }}>Waiting to upload</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {breakdown.map((b) => (
                <div key={b.table} className="row" style={{ padding: "8px 12px", background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--line)" }}>
                  <span className="sub">{b.label}</span>
                  <span className="status-pill pending">{b.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={() => onClose()}>Close</button>
          <button type="button" className="btn" disabled={!shared.online || shared.syncing} onClick={() => shared.onSync()}>
            {shared.syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
