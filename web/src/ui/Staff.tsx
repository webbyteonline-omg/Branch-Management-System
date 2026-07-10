import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localdb, pendingCount } from "../lib/db";
import { Icon } from "../lib/icons";
import { money, dateStr, timeStr, rangeStart } from "../lib/format";
import { toast } from "./Toast";
import { Modal } from "./Modal";
import { ChangePasswordModal } from "./Account";
import { LedgerModal } from "./Ledger";
import { EditCustomerModal, EditEntryModal, EditBillModal } from "./Edits";
import { addCustomer, addBill, recordPayment, addExpense, softDelete, createSaleBill, type CartItem } from "../lib/writes";
import { printInvoice, printItemizedBill } from "../lib/invoice";
import { sum, live, computeStock, type SharedProps } from "./shared";
import type { Purchase, Bill as BillT } from "../lib/types";

const confirmDel = (what: string) => window.confirm(`Delete this ${what}? It can be restored by the owner.`);

type Tab = "sale" | "purchase" | "bills" | "customers" | "daybook";

export function Staff(p: SharedProps) {
  const [tab, setTab] = useState<Tab>("sale");
  const [showAccount, setShowAccount] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const branchId = p.profile.branch_id!;
  const branches = useLiveQuery(() => localdb.branches.toArray(), [], []);
  const branchName = branches.find((b) => b.id === branchId)?.name ?? "My Branch";
  const pending = useLiveQuery(() => pendingCount(), [], 0) ?? 0;

  const tabs: [Tab, string, string][] = [
    ["sale", "Billing", "sales"], ["purchase", "Purchase", "cart"],
    ["bills", "Bills", "bill"], ["customers", "Customers", "customers"], ["daybook", "Day Book", "day"],
  ];

  return (
    <>
      <div className="mobile-top">
        <div className="who"><b>{p.profile.name}</b><span>{branchName}</span></div>
        <div className="actions">
          <span className={"sync-pill " + (pending > 0 ? "pending" : "ok")}><span className="dot" />{pending > 0 ? pending : "Synced"}</span>
          <button className={"net-toggle " + (p.online ? "online" : "offline")} onClick={p.onToggleOnline}>{p.online ? "Online" : "Offline"}</button>
          <button className="hbtn" style={{ width: 34, height: 34 }} onClick={() => setShowAccount(true)}><Icon name="settings" size={16} /></button>
        </div>
      </div>
      <div className="m-content">
        {tab === "sale" && <BillingForm branchId={branchId} shared={p} branchName={branchName} />}
        {tab === "purchase" && <PurchaseForm branchId={branchId} shared={p} />}
        {tab === "bills" && <Bills branchId={branchId} shared={p} branchName={branchName} />}
        {tab === "customers" && <Customers branchId={branchId} shared={p} />}
        {tab === "daybook" && <Daybook branchId={branchId} shared={p} />}
      </div>
      <div className="tabbar">
        {tabs.map(([t, label, ic]) => (
          <button key={t} className={"tab" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>
            <Icon name={ic} size={22} /><span>{label}</span>
          </button>
        ))}
      </div>
      {showAccount && (
        <Modal title="Account" onClose={() => setShowAccount(false)}>
          <div className="form-grid">
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>Signed in as <b>{p.profile.name}</b></p>
            <button className="btn ghost" onClick={() => { setShowAccount(false); setShowPw(true); }}>Change password</button>
            <button className="btn" style={{ background: "var(--red)" }} onClick={p.onLogout}>Sign out</button>
          </div>
        </Modal>
      )}
      {showPw && <ChangePasswordModal onClose={() => setShowPw(false)} />}
    </>
  );
}

/* ---------- Sale ---------- */
function BillingForm({ branchId, shared, branchName }: { branchId: string; shared: SharedProps; branchName: string }) {
  const products = live(useLiveQuery(() => localdb.products.toArray(), [], []));
  const branchSales = useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []);
  const branchPurch = useLiveQuery(() => localdb.purchases.where("branch_id").equals(branchId).toArray(), [branchId], []);
  const customers = live(useLiveQuery(() => localdb.customers.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const settings = useLiveQuery(() => localdb.settings.get("main"), [], undefined);

  const [pid, setPid] = useState("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cust, setCust] = useState("");
  const [pay, setPay] = useState<"cash" | "upi" | "credit">("cash");
  const [saving, setSaving] = useState(false);

  const selected = products.find((x) => x.id === pid) ?? products[0];
  useMemo(() => { if (selected) setPrice(selected.sale_price); }, [selected?.id]);
  const stock = selected ? computeStock(selected.id, branchId, branchSales, branchPurch) : 0;
  const cartTotal = cart.reduce((a, c) => a + c.qty * c.price, 0);

  const today = rangeStart("today");
  const todayTotal = sum(live(branchSales).filter((s) => new Date(s.created_at).getTime() >= today), "total");

  const addItem = () => {
    if (!selected) return toast("No products");
    if (!qty || qty < 1) return toast("Enter quantity");
    setCart((c) => {
      const found = c.find((x) => x.product_id === selected.id && x.price === price);
      if (found) return c.map((x) => x === found ? { ...x, qty: x.qty + qty } : x);
      return [...c, { product_id: selected.id, name: selected.name, qty, price }];
    });
    setQty(1);
  };
  const removeItem = (i: number) => setCart((c) => c.filter((_, k) => k !== i));

  const save = async (print: boolean) => {
    if (!cart.length) return toast("Add at least one item");
    setSaving(true);
    const { billNo } = await createSaleBill(branchId, shared.profile.id, cust, pay, cart);
    setSaving(false);
    if (print) printItemizedBill(billNo, cart.map((c) => ({ name: c.name, qty: c.qty, price: c.price })), cust.trim() || "Walk-in", pay, settings, branchName);
    toast(`Bill ${billNo} saved` + (shared.online ? "" : " offline"));
    setCart([]); setCust(""); setPay("cash"); shared.onSync();
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 className="page-title" style={{ fontSize: 22 }}>New Bill</h1>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Today: <b style={{ color: "var(--green)" }}>{money(todayTotal)}</b></span>
      </div>
      <div className="card card-pad">
        <div className="form-grid">
          <div className="field"><label>Product</label>
            <select value={selected?.id ?? ""} onChange={(e) => { setPid(e.target.value); const pr = products.find((x) => x.id === e.target.value); if (pr) setPrice(pr.sale_price); }}>
              {products.map((pr) => <option key={pr.id} value={pr.id}>{pr.name} — {money(pr.sale_price)}/{pr.unit}</option>)}
            </select>
            {selected && <div className="stock-hint">In stock: <b className={stock <= (selected.low_stock_at ?? 5) ? "low" : ""}>{stock} {selected.unit}</b></div>}
          </div>
          <div className="qty-row">
            <div className="field"><label>Quantity</label><input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(+e.target.value)} /></div>
            <div className="field"><label>Price each</label><input type="number" inputMode="numeric" value={price} onChange={(e) => setPrice(+e.target.value)} /></div>
          </div>
          <button className="btn ghost" onClick={addItem}>+ Add item to bill</button>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Bill items ({cart.length})</h3><b>{money(cartTotal)}</b></div>
        <div className="card-pad" style={{ paddingTop: 6 }}>
          {cart.length ? cart.map((c, i) => (
            <div className="row" key={i}><div><div className="main">{c.name} × {c.qty}</div><div className="sub">{money(c.price)} each</div></div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div className="amt in">{money(c.qty * c.price)}</div><button className="del-btn" onClick={() => removeItem(i)}>✕</button></div></div>
          )) : <div className="empty">No items yet. Add products above.</div>}
        </div>
      </div>

      {cart.length > 0 && (
        <div className="card card-pad">
          <div className="form-grid">
            <div className="field"><label>Customer (optional)</label>
              <input list="cust-list" value={cust} onChange={(e) => setCust(e.target.value)} placeholder="Walk-in" />
              <datalist id="cust-list">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
            </div>
            <div className="field"><label>Payment</label>
              <div className="pay-select">
                {(["cash", "upi", "credit"] as const).map((m) => (
                  <button key={m} className={"pay-opt" + (pay === m ? " active" : "")} onClick={() => setPay(m)}>{m === "credit" ? "Credit / Udhaar" : m.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <div className="total-preview">{money(cartTotal)}</div>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => save(false)} disabled={saving}>Save</button>
              <button className="btn" onClick={() => save(true)} disabled={saving}>Save &amp; Print</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Purchase ---------- */
function PurchaseForm({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const products = useLiveQuery(() => localdb.products.toArray(), [], []);
  const [pid, setPid] = useState("");
  const [supplier, setSupplier] = useState("");
  const [qty, setQty] = useState(1);
  const [cost, setCost] = useState(0);
  const selected = products.find((x) => x.id === pid) ?? products[0];
  useMemo(() => { if (selected) setCost(selected.cost_price); }, [selected?.id]);

  const recent = live(useLiveQuery(
    () => localdb.purchases.where("branch_id").equals(branchId).toArray(), [branchId], []
  )).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 15);
  const delPurch = async (id: string) => { if (confirmDel("purchase")) { await softDelete("purchases", id); toast("Deleted"); shared.onSync(); } };

  const save = async () => {
    if (!selected) return toast("No products loaded");
    if (!qty || qty < 1) return toast("Enter a valid quantity");
    const row: Purchase = {
      id: crypto.randomUUID(), branch_id: branchId, created_by: shared.profile.id,
      product_id: selected.id, product_name: selected.name, supplier: supplier.trim(),
      qty: Number(qty), cost: Number(cost), total: Number(qty) * Number(cost),
      created_at: new Date().toISOString(), _synced: 0,
    };
    await localdb.purchases.add(row);
    toast("Purchase saved" + (shared.online ? "" : " offline"));
    setQty(1); setSupplier("");
    shared.onSync();
  };

  return (
    <>
      <h1 className="page-title" style={{ fontSize: 22 }}>New Purchase</h1>
      <div className="card card-pad"><div className="form-grid">
        <div className="field"><label>Product</label>
          <select value={selected?.id ?? ""} onChange={(e) => { setPid(e.target.value); const pr = products.find((x) => x.id === e.target.value); if (pr) setCost(pr.cost_price); }}>
            {products.map((pr) => <option key={pr.id} value={pr.id}>{pr.name} — cost {money(pr.cost_price)}</option>)}
          </select>
        </div>
        <div className="field"><label>Supplier</label><input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" /></div>
        <div className="qty-row">
          <div className="field"><label>Quantity</label><input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(+e.target.value)} /></div>
          <div className="field"><label>Cost each</label><input type="number" inputMode="numeric" value={cost} onChange={(e) => setCost(+e.target.value)} /></div>
        </div>
        <div className="total-preview">{money((qty || 0) * (cost || 0))}</div>
        <button className="btn" onClick={save}>Save Purchase</button>
      </div></div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Recent purchases</h3></div>
        <div className="card-pad" style={{ paddingTop: 6 }}>
          {recent.length ? recent.map((x) => (
            <div className="row" key={x.id}><div><div className="main">{x.product_name} × {x.qty}</div><div className="sub">{x.supplier} · {dateStr(x.created_at)}{x._synced === 0 ? " · ⏳" : ""}</div></div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div className="amt out">{money(x.total)}</div><button className="del-btn" onClick={() => delPurch(x.id)}>✕</button></div></div>
          )) : <div className="empty">No purchases yet.</div>}
        </div>
      </div>
    </>
  );
}

/* ---------- Bills / Customers / Daybook ---------- */
function Bills({ branchId, shared, branchName }: { branchId: string; shared: SharedProps; branchName: string }) {
  const bills = live(useLiveQuery(() => localdb.bills.where("branch_id").equals(branchId).toArray(), [branchId], []))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const customers = live(useLiveQuery(() => localdb.customers.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const settings = useLiveQuery(() => localdb.settings.get("main"), [], undefined);
  const due = sum(bills.filter((b) => b.status === "unpaid"), "due_amount");
  const delBill = async (id: string) => { if (confirmDel("bill")) { await softDelete("bills", id); toast("Deleted"); shared.onSync(); } };

  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState(""); const [amount, setAmount] = useState(0); const [paidNow, setPaidNow] = useState(0);
  const [payFor, setPayFor] = useState<BillT | null>(null); const [payAmt, setPayAmt] = useState(0);
  const [editBill, setEditBill] = useState<BillT | null>(null);

  const saveBill = async () => {
    if (!name.trim()) return toast("Enter customer name");
    if (!amount || amount <= 0) return toast("Enter bill amount");
    await addBill(branchId, name, Number(amount), Number(paidNow) || 0);
    toast("Bill saved" + (shared.online ? "" : " offline"));
    setShowNew(false); setName(""); setAmount(0); setPaidNow(0); shared.onSync();
  };
  const savePay = async () => {
    if (!payFor) return;
    if (!payAmt || payAmt <= 0) return toast("Enter amount");
    await recordPayment(payFor, Number(payAmt));
    toast("Payment recorded" + (shared.online ? "" : " offline"));
    setPayFor(null); setPayAmt(0); shared.onSync();
  };

  return (
    <><h1 className="page-title" style={{ fontSize: 22 }}>Bills / Udhaar</h1>
      <div className="m-stats">
        <div className="stat"><div className="label">Total due</div><div className="value" style={{ color: "var(--red)" }}>{money(due)}</div></div>
        <div className="stat"><div className="label">Open bills</div><div className="value">{bills.filter((b) => b.status === "unpaid").length}</div></div>
      </div>
      <div className="card">
        <div className="card-head"><h3>All bills</h3><button className="add-btn" onClick={() => setShowNew(true)}>+ New bill</button></div>
        <div className="card-pad" style={{ paddingTop: 6 }}>
          {bills.length ? bills.map((b) => (
            <div className="row" key={b.id}>
              <div><div className="main">{b.customer_name}</div><div className="sub">{dateStr(b.created_at)} · paid {money(b.paid)} of {money(b.amount)}{b._synced === 0 ? " · ⏳" : ""}</div></div>
              <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
                <div><div className="amt out">{money(b.due_amount)}</div><span className={"badge " + b.status}>{b.status}</span></div>
                {b.status === "unpaid" && <button className="pay-btn" onClick={() => { setPayFor(b); setPayAmt(b.due_amount); }}>Pay</button>}
                <button className="edit-btn" onClick={() => setEditBill(b)}>Edit</button>
                <button className="edit-btn" title="Print invoice" onClick={() => printInvoice(b, settings, branchName)}>🖨</button>
                <button className="del-btn" onClick={() => delBill(b.id)}>✕</button>
              </div>
            </div>
          )) : <div className="empty">No bills yet.</div>}
        </div>
      </div>

      {showNew && (
        <Modal title="New bill (udhaar)" onClose={() => setShowNew(false)}>
          <div className="form-grid">
            <div className="field"><label>Customer</label>
              <input list="cust-list" value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
              <datalist id="cust-list">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
            </div>
            <div className="qty-row">
              <div className="field"><label>Bill amount</label><input type="number" inputMode="numeric" value={amount || ""} onChange={(e) => setAmount(+e.target.value)} /></div>
              <div className="field"><label>Paid now</label><input type="number" inputMode="numeric" value={paidNow || ""} onChange={(e) => setPaidNow(+e.target.value)} placeholder="0" /></div>
            </div>
            <div className="total-preview">Due: {money(Math.max(0, (amount || 0) - (paidNow || 0)))}</div>
            <div className="btn-row"><button className="btn ghost" onClick={() => setShowNew(false)}>Cancel</button><button className="btn" onClick={saveBill}>Save bill</button></div>
          </div>
        </Modal>
      )}
      {payFor && (
        <Modal title={`Payment — ${payFor.customer_name}`} onClose={() => setPayFor(null)}>
          <div className="form-grid">
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>Outstanding: <b style={{ color: "var(--red)" }}>{money(payFor.due_amount)}</b></p>
            <div className="field"><label>Amount received</label><input type="number" inputMode="numeric" value={payAmt || ""} onChange={(e) => setPayAmt(+e.target.value)} /></div>
            <div className="btn-row"><button className="btn ghost" onClick={() => setPayFor(null)}>Cancel</button><button className="btn" onClick={savePay}>Record payment</button></div>
          </div>
        </Modal>
      )}
      {editBill && <EditBillModal bill={editBill} onClose={() => setEditBill(null)} onSync={shared.onSync} />}
    </>
  );
}
function Customers({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const cust = live(useLiveQuery(() => localdb.customers.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const [show, setShow] = useState(false);
  const [ledger, setLedger] = useState<string | null>(null);
  const [editC, setEditC] = useState<any>(null);
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const save = async () => {
    if (!name.trim()) return toast("Enter customer name");
    await addCustomer(branchId, name, phone);
    toast("Customer added" + (shared.online ? "" : " offline"));
    setShow(false); setName(""); setPhone(""); shared.onSync();
  };
  const delCust = async (id: string) => { if (confirmDel("customer")) { await softDelete("customers", id); toast("Deleted"); shared.onSync(); } };
  return (
    <><h1 className="page-title" style={{ fontSize: 22 }}>Customers</h1>
      <div className="card">
        <div className="card-head"><h3>{cust.length} customer{cust.length === 1 ? "" : "s"}</h3><button className="add-btn" onClick={() => setShow(true)}>+ Add</button></div>
        <div className="card-pad" style={{ paddingTop: 6 }}>
          {cust.length ? cust.map((c) => (
            <div className="row" key={c.id}><div onClick={() => setLedger(c.name)} style={{ cursor: "pointer" }}><div className="main">{c.name}</div><div className="sub">{c.phone}{c._synced === 0 ? " · ⏳" : ""} · tap for ledger</div></div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div className={"amt " + (c.balance_due > 0 ? "out" : "in")}>{c.balance_due > 0 ? money(c.balance_due) + " due" : "Clear"}</div><button className="pay-btn" onClick={() => setLedger(c.name)}>Ledger</button><button className="edit-btn" onClick={() => setEditC(c)}>Edit</button><button className="del-btn" onClick={() => delCust(c.id)}>✕</button></div></div>
          )) : <div className="empty">No customers yet.</div>}
        </div>
      </div>
      {ledger && <LedgerModal branchId={branchId} name={ledger} onClose={() => setLedger(null)} />}
      {editC && <EditCustomerModal customer={editC} onClose={() => setEditC(null)} onSync={shared.onSync} />}
      {show && (
        <Modal title="Add customer" onClose={() => setShow(false)}>
          <div className="form-grid">
            <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" /></div>
            <div className="field"><label>Phone (optional)</label><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Mobile number" /></div>
            <div className="btn-row"><button className="btn ghost" onClick={() => setShow(false)}>Cancel</button><button className="btn" onClick={save}>Add customer</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}
function Daybook({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const today = rangeStart("today");
  const sales = live(useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const purch = live(useLiveQuery(() => localdb.purchases.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const expenses = live(useLiveQuery(() => localdb.expenses.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const inT = sum(sales.filter((s) => new Date(s.created_at).getTime() >= today), "total");
  const outP = sum(purch.filter((s) => new Date(s.created_at).getTime() >= today), "total");
  const outE = sum(expenses.filter((s) => new Date(s.created_at).getTime() >= today), "amount");

  const [show, setShow] = useState(false);
  const [editRow, setEditRow] = useState<{ table: "sales" | "purchases" | "expenses"; row: any } | null>(null);
  const [cat, setCat] = useState("General"); const [note, setNote] = useState(""); const [amt, setAmt] = useState(0);
  const saveExp = async () => {
    if (!amt || amt <= 0) return toast("Enter amount");
    await addExpense(branchId, shared.profile.id, cat, note, Number(amt));
    toast("Expense saved" + (shared.online ? "" : " offline"));
    setShow(false); setNote(""); setAmt(0); setCat("General"); shared.onSync();
  };
  const delItem = async (table: "sales" | "purchases" | "expenses", id: string, what: string) => {
    if (confirmDel(what)) { await softDelete(table, id); toast("Deleted"); shared.onSync(); }
  };

  const items = [
    ...sales.map((s) => ({ table: "sales" as const, id: s.id, row: s, t: s.created_at, label: `Sale · ${s.product_name} × ${s.qty}`, amt: s.total, dir: "in", what: "sale" })),
    ...purch.map((x) => ({ table: "purchases" as const, id: x.id, row: x, t: x.created_at, label: `Purchase · ${x.product_name} × ${x.qty}`, amt: x.total, dir: "out", what: "purchase" })),
    ...expenses.map((x) => ({ table: "expenses" as const, id: x.id, row: x, t: x.created_at, label: `Expense · ${x.category}${x.note ? " (" + x.note + ")" : ""}`, amt: x.amount, dir: "out", what: "expense" })),
  ].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime()).slice(0, 50);

  const cats = ["General", "Transport", "Rent", "Salary", "Electricity", "Tea/Food", "Repair"];
  return (
    <><h1 className="page-title" style={{ fontSize: 22 }}>Day Book</h1>
      <div className="m-stats" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <div className="stat"><div className="label">In</div><div className="value" style={{ color: "var(--green)", fontSize: 18 }}>{money(inT)}</div></div>
        <div className="stat"><div className="label">Out</div><div className="value" style={{ color: "var(--red)", fontSize: 18 }}>{money(outP + outE)}</div></div>
        <div className="stat"><div className="label">Net</div><div className="value" style={{ fontSize: 18 }}>{money(inT - outP - outE)}</div></div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Today & recent</h3><button className="add-btn" onClick={() => setShow(true)}>+ Expense</button></div>
        <div className="card-pad" style={{ paddingTop: 6 }}>
          {items.length ? items.map((i) => (
            <div className="row" key={i.id}><div><div className="main">{i.label}</div><div className="sub">{dateStr(i.t)} · {timeStr(i.t)}</div></div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div className={"amt " + i.dir}>{i.dir === "in" ? "+" : "−"}{money(i.amt)}</div><button className="edit-btn" onClick={() => setEditRow({ table: i.table, row: i.row })}>Edit</button><button className="del-btn" onClick={() => delItem(i.table, i.id, i.what)}>✕</button></div></div>
          )) : <div className="empty">No entries.</div>}
        </div>
      </div>
      {editRow && <EditEntryModal table={editRow.table} row={editRow.row} onClose={() => setEditRow(null)} onSync={shared.onSync} />}
      {show && (
        <Modal title="Add expense" onClose={() => setShow(false)}>
          <div className="form-grid">
            <div className="field"><label>Category</label>
              <select value={cat} onChange={(e) => setCat(e.target.value)}>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div className="field"><label>Note (optional)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sumo fare to Seppa" /></div>
            <div className="field"><label>Amount</label><input type="number" inputMode="numeric" value={amt || ""} onChange={(e) => setAmt(+e.target.value)} /></div>
            <div className="btn-row"><button className="btn ghost" onClick={() => setShow(false)}>Cancel</button><button className="btn" onClick={saveExp}>Save expense</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}
