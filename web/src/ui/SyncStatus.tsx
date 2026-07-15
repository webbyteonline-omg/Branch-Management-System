import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { pendingBreakdown } from "../lib/db";
import { timeAgo } from "../lib/format";
import { Icon } from "../lib/icons";
import type { SharedProps } from "./shared";

/** One place that explains exactly what's going on with sync — replaces the
 *  old pair of near-identical "Sync"/"Refresh now" buttons with a single tap
 *  target (the sync pill) that opens this detail view. Shows: online/offline
 *  state, when data last reached Head Office, and (if anything is still
 *  waiting) exactly what and how many, broken down by type. */
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
  const state: "offline" | "error" | "pending" | "synced" =
    !shared.online ? "offline" : shared.syncError ? "error" : totalPending > 0 ? "pending" : "synced";

  const stateCopy: Record<typeof state, { title: string; body: string; color: string }> = {
    offline: { title: "Offline", body: "You're working offline on purpose — everything you save stays safely on this device and will upload automatically the moment you go back online.", color: "var(--red)" },
    error: { title: "Sync problem", body: shared.syncError || "Something didn't reach Head Office. Your data is safe on this device — we'll keep retrying.", color: "var(--red)" },
    pending: { title: "Waiting to sync", body: "Everything below is saved on this device and will upload the next time sync runs (automatically, every ~20 seconds while online).", color: "var(--amber)" },
    synced: { title: "All synced", body: "Everything on this device has reached Head Office.", color: "var(--green)" },
  };
  const copy = stateCopy[state];

  return (
    <Modal title="Sync status" onClose={onClose}>
      <div className="form-grid">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--line)" }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: copy.color + "22", color: copy.color, display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Icon name={state === "synced" ? "check" : state === "offline" ? "warning" : "sync"} size={19} />
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
          <button className="btn ghost" onClick={onClose}>Close</button>
          <button className="btn" disabled={!shared.online || shared.syncing} onClick={shared.onSync}>
            {shared.syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
