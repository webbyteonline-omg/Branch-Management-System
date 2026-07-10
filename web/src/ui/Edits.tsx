import { useState } from "react";
import { Modal } from "./Modal";
import { toast } from "./Toast";
import { saveEdit } from "../lib/writes";
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

export function EditBillModal({ bill, onClose, onSync }: { bill: Bill; onClose: () => void; onSync: () => void }) {
  const [amount, setAmount] = useState(bill.amount);
  const [paid, setPaid] = useState(bill.paid);
  const save = async () => {
    if (!amount || amount <= 0) return toast("Enter amount");
    const due = Math.max(0, Number(amount) - Number(paid));
    await saveEdit("bills", { ...bill, amount: Number(amount), paid: Number(paid), due_amount: due, status: due <= 0 ? "paid" : "unpaid" });
    toast("Bill updated"); onClose(); onSync();
  };
  return (
    <Modal title={`Edit bill — ${bill.customer_name}`} onClose={onClose}>
      <div className="form-grid">
        <div className="qty-row">
          <div className="field"><label>Bill amount</label><input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(+e.target.value)} /></div>
          <div className="field"><label>Paid</label><input type="number" inputMode="numeric" value={paid} onChange={(e) => setPaid(+e.target.value)} /></div>
        </div>
        <div className="total-preview">Due: {money(Math.max(0, (amount || 0) - (paid || 0)))}</div>
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}
