import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localdb } from "../lib/db";
import { Icon } from "../lib/icons";
import { money, dateStr, timeStr } from "../lib/format";
import { live, forTotals, sum, type SharedProps } from "./shared";
import { Modal } from "./Modal";
import { toast } from "./Toast";
import { settleCustomerDues, recordBillPayment } from "../lib/writes";
import { downloadExcel } from "../lib/excel";
import type { Bill } from "../lib/types";

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

/** Add Payment modal — Cash + UPI split against ONE specific bill (Part 3's
 *  exact pattern, reused here so pending-bill taps in the full-page ledger
 *  and Settled page behave identically to Unpaid Bills' Pay Now). */
function AddPaymentModal({ branchId, shared, bill, onClose, onDone }: { branchId: string; shared: SharedProps; bill: Bill; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"cash" | "upi" | "both">("cash");
  const [cashAmt, setCashAmt] = useState<number | "">(bill.due_amount);
  const [upiAmt, setUpiAmt] = useState<number | "">("");
  const total = mode === "both" ? (Number(cashAmt) || 0) + (Number(upiAmt) || 0)
    : mode === "cash" ? (Number(cashAmt) || 0) : (Number(upiAmt) || 0);

  const save = async () => {
    if (!total || total <= 0) return toast("Enter amount");
    await recordBillPayment(branchId, shared.profile.id, bill, {
      amount: total, mode,
      cashAmount: mode === "both" ? Number(cashAmt) || 0 : undefined,
      upiAmount: mode === "both" ? Number(upiAmt) || 0 : undefined,
    });
    toast("Payment recorded" + (shared.online ? "" : " offline"));
    onDone();
  };

  return (
    <Modal title={`Add Payment — ${bill.bill_no ? `Bill #${bill.bill_no}` : "Udhaar bill"}`} onClose={onClose}>
      <div className="form-grid">
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>Due: <b style={{ color: "var(--red)" }}>{money(bill.due_amount)}</b></p>
        <div className="pay-select">
          {(["cash", "upi", "both"] as const).map((m) => (
            <button key={m} className={"pay-opt" + (mode === m ? " active" : "")} onClick={() => setMode(m)}>
              {m === "both" ? "Split" : m.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="qty-row">
          <div className="field"><label>Cash (₹)</label><input type="number" inputMode="numeric" value={cashAmt} onChange={(e) => setCashAmt(e.target.value === "" ? "" : +e.target.value)} disabled={mode === "upi"} /></div>
          <div className="field"><label>UPI (₹)</label><input type="number" inputMode="numeric" value={upiAmt} onChange={(e) => setUpiAmt(e.target.value === "" ? "" : +e.target.value)} disabled={mode === "cash"} /></div>
        </div>
        <div className="total-preview">Total: {money(total)}</div>
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Record payment</button></div>
      </div>
    </Modal>
  );
}

/** Full-page customer ledger — Select Customer + accent hero summary +
 *  Pending Bills (tap a bill → Add Payment against THAT bill specifically,
 *  never an auto-split) + Payment History + Export. Reached from
 *  StaffLedger's "Full ledger" button. A "Settled" button switches to the
 *  paid-bills + full payment-history view (Part 5) for the same customer. */
export function CustomerLedgerPage({ branchId, shared, initialCustomer, onBack }: { branchId: string; shared: SharedProps; initialCustomer?: string; onBack: () => void }) {
  const [view, setView] = useState<"pending" | "settled">("pending");
  const [payBill, setPayBill] = useState<Bill | null>(null);

  const customersRaw = live(useLiveQuery(() => localdb.customers.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const sales = forTotals(useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const bills = live(useLiveQuery(() => localdb.bills.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const payments = live(useLiveQuery(() => localdb.payments.where("branch_id").equals(branchId).toArray(), [branchId], []))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Every customer ever billed at this branch, not just those with an
  // outstanding balance — union of the customers table and any customer_name
  // seen on sales/bills (older/walk-in-turned-repeat entries with no row).
  const allNames = useMemo(() => {
    const names = new Set<string>();
    customersRaw.forEach((c) => names.add(c.name));
    sales.forEach((s) => { if (s.customer_name && s.customer_name.toLowerCase() !== "walk-in") names.add(s.customer_name); });
    bills.forEach((b) => { if (!b.void_at) names.add(b.customer_name); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [customersRaw, sales, bills]);

  const [selected, setSelected] = useState(initialCustomer && allNames.includes(initialCustomer) ? initialCustomer : (allNames[0] || ""));
  const name = selected || allNames[0] || "";
  const lc = name.trim().toLowerCase();

  const custRow = customersRaw.find((c) => c.name.toLowerCase() === lc);
  const custSales = sales.filter((s) => (s.customer_name || "").toLowerCase() === lc);
  const custBills = bills.filter((b) => b.customer_name.toLowerCase() === lc && !b.void_at);
  const custPayments = payments.filter((p) => p.customer_name.toLowerCase() === lc);
  const pendingBills = custBills.filter((b) => b.status === "unpaid")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const settledBills = custBills.filter((b) => b.status === "paid")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const totalPurchases = sum(custSales, "total");
  const outstanding = custRow?.balance_due ?? sum(pendingBills, "due_amount");
  // Judgement call: there's no explicit "opening balance" concept in this
  // app. Treat it as 0 unless the customer's stored balance_due diverges
  // from the sum of their unpaid bills' due_amount (which can only happen
  // from a manual balance adjustment elsewhere) — in that case the gap is
  // shown as the opening balance so the hero card still reconciles.
  const unpaidDueSum = sum(pendingBills, "due_amount");
  const openingBalance = Math.round(((custRow?.balance_due ?? unpaidDueSum) - unpaidDueSum) * 100) / 100;
  // Judgement call: Total Paid = Total Purchases − Outstanding. This is the
  // simplest robust figure (always reconciles with the hero card) rather
  // than summing localdb.payments, since payments only exist going forward
  // from this feature and older paid-in-full bills never created a payments
  // row — summing payments alone would understate history for existing data.
  const totalPaid = Math.max(0, totalPurchases - outstanding);

  const [sortDesc, setSortDesc] = useState(true);
  const sortedPending = useMemo(() => [...pendingBills].sort((a, b) =>
    sortDesc ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime() : new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  ), [pendingBills, sortDesc]);

  const exportStatement = () => {
    const rows = [
      ...custBills.map((b) => [dateStr(b.created_at), b.bill_no || "Udhaar", "Bill", b.amount, b.paid, b.due_amount, b.status]),
      ...custPayments.map((p) => [dateStr(p.created_at), p.bill_id || "", "Payment", p.amount, p.cash_amount || 0, p.upi_amount || 0, p.mode]),
    ];
    downloadExcel(`ledger-${name || "customer"}`, ["Date", "Ref", "Type", "Amount", "Cash/Paid", "UPI/Due", "Mode/Status"], rows as any);
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button className="back" onClick={onBack}><span style={{ display: "inline-flex", transform: "rotate(90deg)" }}><Icon name="chevronDown" size={16} /></span> Back</button>
        <button className={view === "settled" ? "btn" : "btn ghost"} style={{ width: "auto", padding: "8px 16px" }} onClick={() => setView(view === "settled" ? "pending" : "settled")}>
          {view === "settled" ? "Pending" : "Settled"}
        </button>
      </div>
      <h2 style={{ fontSize: 19, fontWeight: 800, margin: "0 0 14px" }}>Customer Ledger</h2>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Select Customer</label>
          <select value={name} onChange={(e) => setSelected(e.target.value)}>
            {allNames.length ? allNames.map((n) => <option key={n} value={n}>{n}</option>) : <option value="">No customers yet</option>}
          </select>
        </div>
      </div>

      {name ? (
        <>
          <div style={{ background: "var(--accent)", color: "#fff", borderRadius: 14, padding: 18, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".6px", opacity: .85, fontWeight: 700 }}>
                {outstanding > 0 ? "Total Outstanding" : "Settled"}
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 999, background: outstanding > 0 ? "rgba(255,255,255,.18)" : "var(--green)", color: "#fff" }}>
                {outstanding > 0 ? "OUTSTANDING" : "SETTLED"}
              </span>
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>{money(outstanding)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,.25)" }}>
              <div><div style={{ fontSize: 10.5, opacity: .8 }}>OPENING BAL.</div><div style={{ fontSize: 14.5, fontWeight: 700, marginTop: 2 }}>{money(openingBalance)}</div></div>
              <div><div style={{ fontSize: 10.5, opacity: .8 }}>TOTAL PURCHASES</div><div style={{ fontSize: 14.5, fontWeight: 700, marginTop: 2 }}>{money(totalPurchases)}</div></div>
              <div><div style={{ fontSize: 10.5, opacity: .8 }}>TOTAL PAID</div><div style={{ fontSize: 14.5, fontWeight: 700, marginTop: 2 }}>{money(totalPaid)}</div></div>
            </div>
          </div>

          {view === "pending" ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div className="t-label" style={{ margin: 0 }}>Pending Bills ({pendingBills.length})</div>
                <button className="edit-btn" onClick={() => setSortDesc((s) => !s)}><Icon name="filter" size={13} /> Filter</button>
              </div>
              {sortedPending.length ? sortedPending.map((b) => (
                <div key={b.id} className="card card-pad tappable" style={{ marginBottom: 8, cursor: "pointer" }} onClick={() => setPayBill(b)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div><div className="main" style={{ fontWeight: 700 }}>{b.bill_no ? `Bill #${b.bill_no}` : "Udhaar bill"}</div><div className="sub">{dateStr(b.created_at)}</div></div>
                    <div style={{ textAlign: "right" }}>
                      <div className="sub">{money(b.amount)}</div>
                      <div style={{ color: "var(--red)", fontWeight: 800, fontSize: 15 }}>DUE: {money(b.due_amount)}</div>
                    </div>
                  </div>
                </div>
              )) : <div className="card card-pad"><div className="empty">No pending bills for {name}.</div></div>}

              <div className="t-label" style={{ margin: "18px 0 8px" }}>Payment History</div>
              {custPayments.length ? custPayments.slice(0, 20).map((p) => (
                <div className="row" key={p.id}>
                  <div><div className="main">{dateStr(p.created_at)} {timeStr(p.created_at)}</div>
                    <div className="sub">{p.mode === "both" ? `Cash ${money(p.cash_amount || 0)} + UPI ${money(p.upi_amount || 0)}` : p.mode.toUpperCase()}</div></div>
                  <b className="amt in">{money(p.amount)}</b>
                </div>
              )) : <div className="empty">No payments recorded yet.</div>}
            </>
          ) : (
            <>
              <div className="t-label" style={{ margin: "4px 0 8px" }}>Settled Bills ({settledBills.length})</div>
              {settledBills.length ? settledBills.map((b) => (
                <div className="row" key={b.id}>
                  <div><div className="main">{b.bill_no ? `Bill #${b.bill_no}` : "Udhaar bill"}</div><div className="sub">{dateStr(b.created_at)}</div></div>
                  <div style={{ textAlign: "right" }}><b className="amt in">{money(b.amount)}</b><div><span className="badge paid">Paid</span></div></div>
                </div>
              )) : <div className="card card-pad"><div className="empty">No settled bills yet for {name}.</div></div>}

              <div className="t-label" style={{ margin: "18px 0 8px" }}>Payment History</div>
              {custPayments.length ? custPayments.map((p) => (
                <div className="row" key={p.id}>
                  <div><div className="main">{dateStr(p.created_at)} {timeStr(p.created_at)}</div>
                    <div className="sub">{p.mode === "both" ? `Cash ${money(p.cash_amount || 0)} + UPI ${money(p.upi_amount || 0)}` : p.mode.toUpperCase()}{p.bill_id ? ` · bill ${p.bill_id.slice(0, 8)}` : ""}</div></div>
                  <b className="amt in">{money(p.amount)}</b>
                </div>
              )) : <div className="empty">No payments recorded yet.</div>}
            </>
          )}

          <button className="edit-btn" style={{ marginTop: 16, width: "100%", padding: "10px 0" }} onClick={exportStatement}>Download Statement</button>
        </>
      ) : <div className="card card-pad"><div className="empty">No customers billed yet at this branch.</div></div>}

      {payBill && (
        <AddPaymentModal
          branchId={branchId} shared={shared} bill={payBill}
          onClose={() => setPayBill(null)}
          onDone={() => { setPayBill(null); shared.onSync(); }}
        />
      )}
    </>
  );
}
