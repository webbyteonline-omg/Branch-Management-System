import { useState } from "react";
import { Modal } from "./Modal";
import { toast } from "./Toast";
import { saveEdit, syncLinkedBillTotal, bumpCustomerBalanceFor } from "../lib/writes";
import { money } from "../lib/format";
import type { Customer, Sale, Purchase, Expense, Bill } from "../lib/types";

export function EditCustomerModal({ customer, onClose, onSync }: { customer: Customer; onClose: () => void; onSync: () => void }) {
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone || "");
  const [bal, setBal] = useState(customer.balance_due);
  const save = async () => {
    if (!name.trim()) return toast("Enter a name");
    await saveEdit("customers", { ...customer, name: name.trim(), phone: phone.trim() || null, balance_due: Number(bal) || 0 });
    toast("Customer updated"); onClose(); onSync();
  };
  return (
    <Modal title="Edit customer" onClose={onClose}>
      <div className="form-grid">
        <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="field"><label>Balance due (₹)</label><input type="number" inputMode="numeric" value={bal} onChange={(e) => setBal(+e.target.value)} /></div>
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}

type EntryKind = "sales" | "purchases" | "expenses";
export function EditEntryModal({ table, row, onClose, onSync }: { table: EntryKind; row: any; onClose: () => void; onSync: () => void }) {
  const [qty, setQty] = useState(row.qty ?? 1);
  const [rate, setRate] = useState(table === "sales" ? row.price : row.cost);
  const [category, setCategory] = useState(row.category ?? "General");
  const [amount, setAmount] = useState(row.amount ?? 0);

  const save = async () => {
    if (table === "expenses") {
      if (!amount || amount <= 0) return toast("Enter amount");
      await saveEdit("expenses", { ...(row as Expense), category, amount: Number(amount) });
    } else if (table === "sales") {
      if (!qty || qty < 1) return toast("Enter quantity");
      await saveEdit("sales", { ...(row as Sale), qty: Number(qty), price: Number(rate), total: Number(qty) * Number(rate) });
    } else {
      if (!qty || qty < 1) return toast("Enter quantity");
      await saveEdit("purchases", { ...(row as Purchase), qty: Number(qty), cost: Number(rate), total: Number(qty) * Number(rate) });
    }
    toast("Updated"); onClose(); onSync();
  };

  return (
    <Modal title={`Edit ${table === "expenses" ? "expense" : table === "sales" ? "sale" : "purchase"}`} onClose={onClose}>
      <div className="form-grid">
        {table === "expenses" ? (
          <>
            <div className="field"><label>Category</label><input value={category} onChange={(e) => setCategory(e.target.value)} /></div>
            <div className="field"><label>Amount</label><input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(+e.target.value)} /></div>
          </>
        ) : (
          <>
            <div className="field" style={{ color: "var(--muted)", fontSize: 13 }}>{row.product_name}</div>
            <div className="qty-row">
              <div className="field"><label>Quantity</label><input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(+e.target.value)} /></div>
              <div className="field"><label>{table === "sales" ? "Price each" : "Cost each"}</label><input type="number" inputMode="numeric" value={rate} onChange={(e) => setRate(+e.target.value)} /></div>
            </div>
            <div className="total-preview">{money((qty || 0) * (rate || 0))}</div>
          </>
        )}
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}

/** Edit a whole POS bill (all sales rows sharing one bill_no) — lets staff
 *  fix each item's qty/price after the fact. Recomputes each line's total,
 *  and if this bill has a linked unpaid/partial udhaar entry, rescales that
 *  bill's amount/due and the customer's balance to match (see
 *  syncLinkedBillTotal) so editing never lets the ledger drift silently.
 *  Customer name isn't editable here — rename via "Edit customer" instead,
 *  since renaming here would need to move the linked bill's balance across
 *  two customer records and is safer done as its own explicit action. */
export function EditBillGroupModal({ group, branchId, onClose, onSync }: { group: { billNo: string; items: Sale[] }; branchId: string; onClose: () => void; onSync: () => void }) {
  const customer = group.items[0]?.customer_name || "Walk-in";
  const [lines, setLines] = useState(group.items.map((s) => ({ id: s.id, name: s.product_name, qty: s.qty, price: s.price, row: s })));

  const setLine = (i: number, patch: Partial<{ qty: number; price: number }>) =>
    setLines((ls) => ls.map((l, k) => k === i ? { ...l, ...patch } : l));

  const save = async () => {
    if (!lines.length) return;
    if (lines.some((l) => l.qty <= 0)) return toast("Every item needs a quantity greater than 0");
    for (const l of lines) {
      await saveEdit("sales", { ...l.row, qty: Number(l.qty), price: Number(l.price), total: Number(l.qty) * Number(l.price) });
    }
    const newTotal = lines.reduce((a, l) => a + Number(l.qty) * Number(l.price), 0);
    await syncLinkedBillTotal(branchId, group.billNo, newTotal);
    toast("Bill updated"); onClose(); onSync();
  };

  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);

  return (
    <Modal title={`Edit bill ${group.billNo}`} onClose={onClose}>
      <div className="form-grid">
        <div className="field" style={{ color: "var(--muted)", fontSize: 13 }}>Customer: <b style={{ color: "var(--text)" }}>{customer}</b></div>
        {lines.map((l, i) => (
          <div key={l.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 6, fontWeight: 600 }}>{l.name}</div>
            <div className="qty-row">
              <div className="field"><label>Qty</label><input type="number" inputMode="numeric" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: +e.target.value })} /></div>
              <div className="field"><label>Price</label><input type="number" inputMode="numeric" value={l.price} onChange={(e) => setLine(i, { price: +e.target.value })} /></div>
            </div>
          </div>
        ))}
        <div className="total-preview">Total: {money(total)}</div>
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Save changes</button></div>
      </div>
    </Modal>
  );
}

export function EditBillModal({ bill, onClose, onSync }: { bill: Bill; onClose: () => void; onSync: () => void }) {
  const [amount, setAmount] = useState(bill.amount);
  const [paid, setPaid] = useState(bill.paid);
  const [dueDate, setDueDate] = useState(bill.due_date ? bill.due_date.slice(0, 10) : "");
  const save = async () => {
    if (!amount || amount <= 0) return toast("Enter amount");
    const due = Math.max(0, Number(amount) - Number(paid));
    const delta = due - bill.due_amount; // keep the customer's balance_due in sync with this hand-edit
    await saveEdit("bills", { ...bill, amount: Number(amount), paid: Number(paid), due_amount: due, status: due <= 0 ? "paid" : "unpaid", due_date: dueDate || null });
    if (delta !== 0) await bumpCustomerBalanceFor(bill.branch_id, bill.customer_name, delta);
    toast("Bill updated"); onClose(); onSync();
  };
  return (
    <Modal title={`Edit bill — ${bill.customer_name}`} onClose={onClose}>
      <div className="form-grid">
        <div className="qty-row">
          <div className="field"><label>Bill amount</label><input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(+e.target.value)} /></div>
          <div className="field"><label>Paid</label><input type="number" inputMode="numeric" value={paid} onChange={(e) => setPaid(+e.target.value)} /></div>
        </div>
        <div className="field"><label>Due date</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        <div className="total-preview">Due: {money(Math.max(0, (amount || 0) - (paid || 0)))}</div>
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}
