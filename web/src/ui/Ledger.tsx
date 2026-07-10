import { useLiveQuery } from "dexie-react-hooks";
import { localdb } from "../lib/db";
import { money, dateStr } from "../lib/format";
import { live } from "./shared";
import { Modal } from "./Modal";

/** Customer ledger / khata — full purchase & bill history + outstanding. */
export function LedgerModal({ branchId, name, onClose }: { branchId: string; name: string; onClose: () => void }) {
  const lc = name.trim().toLowerCase();
  const sales = live(useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []))
    .filter((s) => (s.customer_name || "").toLowerCase() === lc)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const bills = live(useLiveQuery(() => localdb.bills.where("branch_id").equals(branchId).toArray(), [branchId], []))
    .filter((b) => b.customer_name.toLowerCase() === lc)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const cust = live(useLiveQuery(() => localdb.customers.where("branch_id").equals(branchId).toArray(), [branchId], []))
    .find((c) => c.name.toLowerCase() === lc);

  const totalBought = sales.reduce((a, s) => a + s.total, 0);
  const outstanding = cust?.balance_due ?? bills.filter((b) => b.status === "unpaid").reduce((a, b) => a + b.due_amount, 0);

  // group sales by bill_no for readability
  const byBill = new Map<string, { total: number; date: string; pay: string; items: number }>();
  for (const s of sales) {
    const key = s.bill_no || s.id;
    const g = byBill.get(key) || { total: 0, date: s.created_at, pay: s.payment_mode || "cash", items: 0 };
    g.total += s.total; g.items += 1;
    byBill.set(key, g);
  }
  const billGroups = [...byBill.entries()];

  return (
    <Modal title={`Ledger — ${name}`} onClose={onClose}>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div className="stat" style={{ flex: 1 }}><div className="label">Total bought</div><div className="value" style={{ fontSize: 18 }}>{money(totalBought)}</div></div>
        <div className="stat" style={{ flex: 1 }}><div className="label">Outstanding</div><div className="value" style={{ fontSize: 18, color: outstanding > 0 ? "var(--red)" : "var(--green)" }}>{money(outstanding)}</div></div>
      </div>

      <div style={{ maxHeight: "48vh", overflowY: "auto" }}>
        <div className="t-label" style={{ margin: "4px 0 6px" }}>Bills / purchases</div>
        {billGroups.length ? billGroups.map(([key, g]) => (
          <div className="row" key={key}>
            <div><div className="main">{key.startsWith("B-") ? key : "Sale"} · {g.items} item{g.items === 1 ? "" : "s"}</div>
              <div className="sub">{dateStr(g.date)} · {g.pay.toUpperCase()}</div></div>
            <div className="amt in">{money(g.total)}</div>
          </div>
        )) : <div className="empty">No purchases yet.</div>}

        {bills.length > 0 && <>
          <div className="t-label" style={{ margin: "14px 0 6px" }}>Udhaar bills</div>
          {bills.map((b) => (
            <div className="row" key={b.id}>
              <div><div className="main">{dateStr(b.created_at)}</div><div className="sub">paid {money(b.paid)} of {money(b.amount)}</div></div>
              <div style={{ textAlign: "right" }}><div className={"amt " + (b.due_amount > 0 ? "out" : "in")}>{money(b.due_amount)}</div><span className={"badge " + b.status}>{b.status}</span></div>
            </div>
          ))}
        </>}
      </div>
    </Modal>
  );
}
