import { useState } from "react";
import { Modal } from "./Modal";
import { toast } from "./Toast";
import { money } from "../lib/format";
import { productsForBranch } from "./shared";
import { addCustomer, addExpense, createPurchase } from "../lib/writes";
import type { Branch, Product } from "../lib/types";

const branchOpts = (branches: Branch[]) => branches.filter((b) => b.id !== "ho");

export function AddCustomerModal({ branches, onClose, onSync }: { branches: Branch[]; onClose: () => void; onSync: () => void }) {
  const brs = branchOpts(branches);
  const [branchId, setBranchId] = useState(brs[0]?.id || "");
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const save = async () => {
    if (!name.trim()) return toast("Enter name");
    if (!branchId) return toast("Pick a branch");
    await addCustomer(branchId, name, phone); toast("Customer added"); onClose(); onSync();
  };
  return (
    <Modal title="Add customer" onClose={onClose}>
      <div className="form-grid">
        <div className="field"><label>Branch</label><select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{brs.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" /></div>
        <div className="field"><label>Phone (optional)</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Add</button></div>
      </div>
    </Modal>
  );
}

export function AddExpenseModal({ branches, userId, onClose, onSync }: { branches: Branch[]; userId: string; onClose: () => void; onSync: () => void }) {
  const brs = branchOpts(branches);
  const [branchId, setBranchId] = useState(brs[0]?.id || "");
  const [cat, setCat] = useState("General"); const [note, setNote] = useState(""); const [amt, setAmt] = useState(0);
  const cats = ["General", "Transport", "Rent", "Salary", "Electricity", "Tea/Food", "Repair"];
  const save = async () => {
    if (!amt || amt <= 0) return toast("Enter amount");
    await addExpense(branchId, userId, cat, note, Number(amt)); toast("Expense added"); onClose(); onSync();
  };
  return (
    <Modal title="Add expense" onClose={onClose}>
      <div className="form-grid">
        <div className="qty-row">
          <div className="field"><label>Branch</label><select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{brs.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <div className="field"><label>Category</label><select value={cat} onChange={(e) => setCat(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select></div>
        </div>
        <div className="field"><label>Note (optional)</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="field"><label>Amount</label><input type="number" inputMode="numeric" value={amt || ""} onChange={(e) => setAmt(+e.target.value)} /></div>
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Add</button></div>
      </div>
    </Modal>
  );
}

export function AddPurchaseModal({ branches, products, userId, onClose, onSync }: { branches: Branch[]; products: Product[]; userId: string; onClose: () => void; onSync: () => void }) {
  const brs = branchOpts(branches);
  const [branchId, setBranchId] = useState(brs[0]?.id || "");
  const list = productsForBranch(products, branchId);
  const [pid, setPid] = useState("");
  const [supplier, setSupplier] = useState("");
  const [qty, setQty] = useState(1); const [cost, setCost] = useState(0);
  const [invoiceNo, setInvoiceNo] = useState(""); const [pay, setPay] = useState<"cash" | "credit">("cash");
  const [note, setNote] = useState(""); const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const selected = list.find((x) => x.id === pid) ?? list[0];

  const save = async () => {
    if (!selected) return toast("No products for this branch");
    if (!supplier.trim()) return toast("Enter supplier");
    if (!qty || qty < 1) return toast("Enter quantity");
    await createPurchase(branchId, userId, { productId: selected.id, productName: selected.name, supplier, qty, cost, invoiceNo, paymentMode: pay, note, date });
    toast("Purchase added"); onClose(); onSync();
  };
  return (
    <Modal title="Add purchase" onClose={onClose}>
      <div className="form-grid">
        <div className="qty-row">
          <div className="field"><label>Branch</label><select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPid(""); }}>{brs.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <div className="field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="field"><label>Supplier / Company</label><input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" /></div>
        <div className="field"><label>Product</label>
          <select value={selected?.id ?? ""} onChange={(e) => { setPid(e.target.value); const pr = list.find((x) => x.id === e.target.value); if (pr) setCost(pr.cost_price); }}>
            {list.length ? list.map((pr) => <option key={pr.id} value={pr.id}>{pr.name} — cost {money(pr.cost_price)}</option>) : <option>No products for this branch</option>}
          </select>
        </div>
        <div className="qty-row">
          <div className="field"><label>Quantity</label><input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(+e.target.value)} /></div>
          <div className="field"><label>Cost each</label><input type="number" inputMode="numeric" value={cost} onChange={(e) => setCost(+e.target.value)} /></div>
        </div>
        <div className="qty-row">
          <div className="field"><label>Bill no.</label><input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="optional" /></div>
          <div className="field"><label>Payment</label><select value={pay} onChange={(e) => setPay(e.target.value as any)}><option value="cash">Cash / Paid</option><option value="credit">Credit (owed)</option></select></div>
        </div>
        <div className="field"><label>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></div>
        <div className="total-preview">{money((qty || 0) * (cost || 0))}</div>
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Add purchase</button></div>
      </div>
    </Modal>
  );
}
