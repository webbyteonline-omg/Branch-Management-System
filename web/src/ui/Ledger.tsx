import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localdb } from "../lib/db";
import { money, dateStr, timeStr } from "../lib/format";
import { live } from "./shared";
import { Modal } from "./Modal";
import { toast } from "./Toast";
import { settleCustomerDues } from "../lib/writes";

/** Simple itemized invoice preview for a bill's linked sales (by bill_no), if any. */
function BillPreviewModal({ branchId, billNo, customerName, onClose }: { branchId: string; billNo?: string | null; customerName: string; onClose: () => void }) {
  const items = live(useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []))
    .filter((s) => billNo && s.bill_no === billNo)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const total = items.filter((s) => !s.void_at).reduce((a, s) => a + s.total, 0);
  return (
    <Modal title={billNo ? `Invoice — ${billNo}` : `Invoice — ${customerName}`} onClose={onClose}>
      {items.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{customerName} · {dateStr(items[0].created_at)} {timeStr(items[0].created_at)}</div>
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-2)" }}>
                  <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12 }}>Item</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12 }}>Qty</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12 }}>Price</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} style={{ opacity: s.void_at ? .55 : 1, borderTop: "1px solid var(--line-2)" }}>
                    <td style={{ padding: "8px 10px", textDecoration: s.void_at ? "line-through" : undefined }}>
                      {s.product_name}
                      {(s.box_qty || s.pcs_qty) ? <div style={{ fontSize: 11, color: "var(--faint)" }}>{s.box_qty ? `${s.box_qty} box` : ""}{s.box_qty && s.pcs_qty ? " + " : ""}{s.pcs_qty ? `${s.pcs_qty} pcs` : ""}</div> : null}
                    </td>
                    <td style={{ textAlign: "right", padding: "8px 10px" }}>{s.qty}</td>
                    <td style={{ textAlign: "right", padding: "8px 10px" }}>{money(s.price)}</td>
                    <td style={{ textAlign: "right", padding: "8px 10px", fontWeight: 700, textDecoration: s.void_at ? "line-through" : undefined }}>{money(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <b>Total</b><b style={{ color: "var(--accent)" }}>{money(total)}</b>
          </div>
        </div>
      ) : <div className="empty">No itemized detail found for this bill (may be an older udhaar entry recorded without linked items).</div>}
    </Modal>
  );
}

/** Customer ledger / khata — full purchase & bill history + outstanding. */
export function LedgerModal({ branchId, name, onClose, onSync }: { branchId: string; name: string; onClose: () => void; onSync?: () => void }) {
  const [payAmt, setPayAmt] = useState<number | "">("");
  const [preview, setPreview] = useState<string | null>(null);
  const lc = name.trim().toLowerCase();
  const sales = live(useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []))
    .filter((s) => (s.customer_name || "").toLowerCase() === lc)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const bills = live(useLiveQuery(() => localdb.bills.where("branch_id").equals(branchId).toArray(), [branchId], []))
    .filter((b) => b.customer_name.toLowerCase() === lc)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const cust = live(useLiveQuery(() => localdb.customers.where("branch_id").equals(branchId).toArray(), [branchId], []))
    .find((c) => c.name.toLowerCase() === lc);

  const totalBought = sales.filter((s) => !s.void_at).reduce((a, s) => a + s.total, 0);
  const unpaidBills = bills.filter((b) => b.status === "unpaid" && !b.void_at);
  const outstanding = cust?.balance_due ?? unpaidBills.reduce((a, b) => a + b.due_amount, 0);

  const settle = async () => {
    const amt = Number(payAmt) || 0;
    if (amt <= 0) return toast("Enter amount");
    const applied = await settleCustomerDues(branchId, name, amt);
    toast(applied > 0 ? `${money(applied)} settled` : "No dues to settle");
    setPayAmt(""); onSync?.();
  };

  // group sales by bill_no for readability. Voided bills stay in the list
  // (crossed out) but don't add to the group total.
  const byBill = new Map<string, { total: number; date: string; pay: string; items: number; voided: boolean }>();
  for (const s of sales) {
    const key = s.bill_no || s.id;
    const g = byBill.get(key) || { total: 0, date: s.created_at, pay: s.payment_mode || "cash", items: 0, voided: false };
    if (s.void_at) g.voided = true; else g.total += s.total;
    g.items += 1;
    byBill.set(key, g);
  }
  const billGroups = [...byBill.entries()];

  return (
    <Modal title={`Ledger — ${name}`} onClose={onClose}>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div className="stat" style={{ flex: 1 }}><div className="label">Total bought</div><div className="value" style={{ fontSize: 18 }}>{money(totalBought)}</div></div>
        <div className="stat" style={{ flex: 1 }}><div className="label">Outstanding</div><div className="value" style={{ fontSize: 18, color: outstanding > 0 ? "var(--red)" : "var(--green)" }}>{money(outstanding)}</div></div>
      </div>

      {onSync && outstanding > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input className="search" style={{ flex: 1, width: "auto" }} type="number" inputMode="numeric" placeholder="Settle dues amount" value={payAmt} onChange={(e) => setPayAmt(e.target.value === "" ? "" : +e.target.value)} />
          <button className="btn" style={{ width: "auto", padding: "9px 16px" }} onClick={() => setPayAmt(outstanding)}>All</button>
          <button className="btn" style={{ width: "auto", padding: "9px 16px" }} onClick={settle}>Settle</button>
        </div>
      )}

      {unpaidBills.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="t-label" style={{ margin: "4px 0 6px", color: "var(--red)" }}>Bills due ({unpaidBills.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {unpaidBills.map((b) => (
              <div key={b.id} className="card card-pad" style={{ background: "var(--surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div className="main" style={{ fontWeight: 700 }}>{b.bill_no ? `Bill #${b.bill_no}` : "Udhaar bill"}</div>
                  <div className="sub">{dateStr(b.created_at)} · paid {money(b.paid)} of {money(b.amount)}{b.due_date ? ` · due ${dateStr(b.due_date)}` : ""}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <b className="amt out">{money(b.due_amount)}</b>
                  <button className="edit-btn" onClick={() => setPreview(b.bill_no || b.id)}>Preview</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ maxHeight: "44vh", overflowY: "auto" }}>
        <div className="t-label" style={{ margin: "4px 0 6px" }}>Bills / purchases</div>
        {billGroups.length ? billGroups.map(([key, g]) => (
          <div className="row" key={key} style={{ opacity: g.voided ? .55 : 1 }}>
            <div><div className="main" style={{ textDecoration: g.voided ? "line-through" : undefined }}>{key.startsWith("B-") ? key : "Sale"} · {g.items} item{g.items === 1 ? "" : "s"}{g.voided ? " · VOID" : ""}</div>
              <div className="sub">{dateStr(g.date)} · {g.pay.toUpperCase()}</div></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="amt in" style={{ textDecoration: g.voided ? "line-through" : undefined }}>{money(g.total)}</div>
              <button className="edit-btn" onClick={() => setPreview(key)}>Preview</button>
            </div>
          </div>
        )) : <div className="empty">No purchases yet.</div>}

        {bills.length > 0 && <>
          <div className="t-label" style={{ margin: "14px 0 6px" }}>Udhaar bills</div>
          {bills.map((b) => (
            <div className="row" key={b.id} style={{ opacity: b.void_at ? .55 : 1 }}>
              <div><div className="main" style={{ textDecoration: b.void_at ? "line-through" : undefined }}>{dateStr(b.created_at)}{b.void_at ? " · VOID" : ""}</div><div className="sub">paid {money(b.paid)} of {money(b.amount)}</div></div>
              <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
                <div><div className={"amt " + (b.due_amount > 0 ? "out" : "in")}>{money(b.due_amount)}</div><span className={"badge " + b.status}>{b.void_at ? "void" : b.status}</span></div>
                {b.bill_no && <button className="edit-btn" onClick={() => setPreview(b.bill_no!)}>Preview</button>}
              </div>
            </div>
          ))}
        </>}
      </div>
      {preview && <BillPreviewModal branchId={branchId} billNo={preview} customerName={name} onClose={() => setPreview(null)} />}
    </Modal>
  );
}
