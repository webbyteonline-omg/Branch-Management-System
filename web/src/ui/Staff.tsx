import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localdb, pendingCount } from "../lib/db";
import { Icon } from "../lib/icons";
import { money, dateStr, timeStr, rangeStart } from "../lib/format";
import { toast } from "./Toast";
import { Modal } from "./Modal";
import { ChangePasswordModal } from "./Account";
import { LedgerModal } from "./Ledger";
import { EditCustomerModal, EditEntryModal, EditBillModal } from "./Edits";
import { addCustomer, addBill, recordPayment, addExpense, softDelete, createSaleBill, createPurchase, computeLineTotal, settleCustomerDues, type CartItem } from "../lib/writes";
import { printInvoice, printItemizedBill } from "../lib/invoice";
import { sum, live, computeStock, productsForBranch, type SharedProps } from "./shared";
import { BarChart } from "./Charts";
import type { Purchase, Bill as BillT } from "../lib/types";

const confirmDel = (what: string) => window.confirm(`Delete this ${what}? It can be restored by the owner.`);

type Tab = "dashboard" | "sale" | "purchase" | "bills" | "customers" | "ledger" | "stock" | "daybook";

export function Staff(p: SharedProps) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [showPw, setShowPw] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const branchId = p.profile.branch_id!;
  const branches = useLiveQuery(() => localdb.branches.toArray(), [], []);
  const branchName = branches.find((b) => b.id === branchId)?.name ?? "My Branch";
  const pending = useLiveQuery(() => pendingCount(), [], 0) ?? 0;

  // Bottom bar: the 5 most-used. Everything (incl. these) also lives in the hamburger menu.
  const tabs: [Tab, string, string][] = [
    ["dashboard", "Home", "dashboard"], ["sale", "Billing", "sales"], ["purchase", "Purchase", "cart"],
    ["bills", "Bills", "bill"], ["customers", "Customers", "customers"],
  ];
  const menuItems: [Tab, string, string][] = [
    ["dashboard", "Dashboard", "dashboard"], ["sale", "Billing / Sell", "sales"], ["purchase", "Purchase", "cart"],
    ["ledger", "Ledger", "book"], ["customers", "Customers", "customers"], ["stock", "Stock", "reports"],
    ["bills", "Bills / Udhaar", "bill"], ["daybook", "Day Book", "day"],
  ];

  const go = (t: Tab) => { setTab(t); setShowMenu(false); };
  const doLogout = () => {
    setShowMenu(false);
    if (window.confirm("Sign out of this device?")) p.onLogout();
  };

  return (
    <>
      <div className="mobile-top">
        <div className="actions">
          <button className="hbtn" style={{ width: 34, height: 34 }} onClick={() => setShowMenu(true)}><Icon name="menu" size={18} /></button>
        </div>
        <div className="who" style={{ textAlign: "center" }}><b>{p.profile.name}</b><span>{branchName}</span></div>
        <div className="actions">
          <span className={"sync-pill " + (p.syncError ? "pending" : pending > 0 ? "pending" : "ok")} title={p.syncError || undefined}>
            <span className="dot" />{p.syncError ? "Sync error" : pending > 0 ? pending : "Synced"}
          </span>
          <button className={"net-toggle " + (p.online ? "online" : "offline")} onClick={p.onToggleOnline}>{p.online ? "Online" : "Offline"}</button>
        </div>
      </div>
      {p.syncError && (
        <div style={{ background: "var(--red-soft)", color: "var(--red)", fontSize: 12.5, padding: "8px 16px", textAlign: "center", fontWeight: 600 }}>
          ⚠ Some entries aren't reaching Head Office yet. They're saved safely on this device — {p.syncError}
        </div>
      )}
      <div className="m-content">
        {tab === "dashboard" && <StaffDashboard branchId={branchId} branchName={branchName} shared={p} go={go} />}
        {tab === "sale" && <BillingForm branchId={branchId} shared={p} branchName={branchName} />}
        {tab === "purchase" && <PurchaseForm branchId={branchId} shared={p} />}
        {tab === "bills" && <Bills branchId={branchId} shared={p} branchName={branchName} />}
        {tab === "customers" && <Customers branchId={branchId} shared={p} />}
        {tab === "ledger" && <StaffLedger branchId={branchId} shared={p} />}
        {tab === "stock" && <StaffStock branchId={branchId} />}
        {tab === "daybook" && <Daybook branchId={branchId} shared={p} />}
      </div>
      <div className="tabbar">
        {tabs.map(([t, label, ic]) => (
          <button key={t} className={"tab" + (tab === t ? " active" : "")} onClick={() => go(t)}>
            <Icon name={ic} size={22} /><span>{label}</span>
          </button>
        ))}
      </div>
      {showMenu && (
        <div className="drawer-scrim" onClick={() => setShowMenu(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div><h3 style={{ margin: 0 }}>{p.profile.name}</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>{branchName}</span></div>
              <button className="hbtn" style={{ width: 30, height: 30 }} onClick={() => setShowMenu(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: 10, flex: 1, display: "flex", flexDirection: "column" }}>
              {menuItems.map(([t, label, ic]) => (
                <button key={t} className={"nav-item" + (tab === t ? " active" : "")} onClick={() => go(t)}>
                  <Icon name={ic} size={19} /><span>{label}</span>
                </button>
              ))}
              <div className="nav-sep" />
              <button className="nav-item" onClick={() => { setShowMenu(false); setShowPw(true); }}>
                <Icon name="settings" size={19} /><span>Change password</span>
              </button>
              <button className="nav-item" style={{ color: "var(--red)", marginTop: "auto" }} onClick={doLogout}>
                <Icon name="logout" size={19} /><span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {showPw && <ChangePasswordModal onClose={() => setShowPw(false)} />}
    </>
  );
}

/* ---------- Dashboard ---------- */
function last7DaysSales(sales: { created_at: string; total: number }[]) {
  const days: { label: string; value: number }[] = [];
  const now = new Date(); now.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const start = now.getTime() - i * 86400000;
    const end = start + 86400000;
    const val = sales.filter((s) => { const t = new Date(s.created_at).getTime(); return t >= start && t < end; }).reduce((a, s) => a + s.total, 0);
    days.push({ label: new Date(start).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), value: val });
  }
  return days;
}

function StaffDashboard({ branchId, branchName, shared, go }: { branchId: string; branchName: string; shared: SharedProps; go: (t: Tab) => void }) {
  const sales = live(useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const bills = live(useLiveQuery(() => localdb.bills.where("branch_id").equals(branchId).toArray(), [branchId], []));

  const today = rangeStart("today");
  const todaySales = sales.filter((s) => new Date(s.created_at).getTime() >= today);
  const sold = sum(todaySales, "total");

  // Money actually received today: a sale with no linked bill (bills.bill_no)
  // was paid in full at billing time, so its full total counts. A sale with
  // a linked bill only contributes what that bill's `paid` tracks (per-line
  // paid amounts aren't stored separately) — summing the bill's `paid` once
  // per bill_no (not per line) avoids double-counting multi-item bills.
  const billNosToday = new Set(bills.filter((b) => new Date(b.created_at).getTime() >= today).map((b) => b.bill_no));
  const fullyPaidToday = sum(todaySales.filter((s) => !billNosToday.has(s.bill_no ?? null)), "total");
  const partialPaidToday = sum(bills.filter((b) => new Date(b.created_at).getTime() >= today), "paid");
  const receivedToday = fullyPaidToday + partialPaidToday;

  const due = sum(bills.filter((b) => b.status === "unpaid"), "due_amount");

  const chartData = last7DaysSales(sales);

  return (
    <>
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => go("sale")}>+ New Bill</button>
      </div>
      <h1 className="page-title" style={{ fontSize: 22 }}>{branchName}</h1>
      <p className="page-sub" style={{ marginBottom: 14 }}>Today's overview</p>
      <div className="m-stats">
        <div className="stat"><div className="label">Sold today</div><div className="value" style={{ color: "var(--green)", fontSize: 18 }}>{money(sold)}</div></div>
        <div className="stat"><div className="label">Received today</div><div className="value" style={{ color: "var(--green)", fontSize: 18 }}>{money(receivedToday)}</div></div>
        <div className="stat" style={{ gridColumn: "1 / -1" }}><div className="label">Due amount</div><div className="value" style={{ fontSize: 18, color: due > 0 ? "var(--red)" : "var(--green)" }}>{money(due)}</div></div>
      </div>

      <div className="card card-pad">
        <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Sales — last 7 days</h3>
        <BarChart data={chartData} color="var(--accent)" />
      </div>
      {!shared && null}
    </>
  );
}

/* ---------- Stock (with Products) ---------- */
function StaffStock({ branchId }: { branchId: string }) {
  const products = productsForBranch(useLiveQuery(() => localdb.products.toArray(), [], []), branchId);
  const sales = live(useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const purch = live(useLiveQuery(() => localdb.purchases.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const [q, setQ] = useState("");

  const rows = products
    .map((pr) => ({ ...pr, stock: computeStock(pr.id, branchId, sales, purch) }))
    .filter((pr) => pr.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const lowCount = rows.filter((r) => r.stock <= (r.low_stock_at ?? 5)).length;

  return (
    <>
      <h1 className="page-title" style={{ fontSize: 22 }}>Stock</h1>
      <div className="m-stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="stat"><div className="label">Products</div><div className="value" style={{ fontSize: 18 }}>{rows.length}</div></div>
        <div className="stat"><div className="label">Low stock</div><div className="value" style={{ fontSize: 18, color: lowCount > 0 ? "var(--red)" : "var(--green)" }}>{lowCount}</div></div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Inventory</h3><input className="search" placeholder="Search product…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="card-pad" style={{ paddingTop: 6 }}>
          {rows.length ? rows.map((pr) => (
            <div className="row" key={pr.id}>
              <div><div className="main">{pr.name}</div><div className="sub">{pr.unit} · sale {money(pr.sale_price)}</div></div>
              <div className={"stock" + (pr.stock <= (pr.low_stock_at ?? 5) ? " low" : "")}>{pr.stock} {pr.unit}</div>
            </div>
          )) : <div className="empty">No products for this branch yet.</div>}
        </div>
      </div>
    </>
  );
}

/* ---------- Ledger (all customers, Outstanding / Paid tabs) ---------- */
function StaffLedger({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const cust = live(useLiveQuery(() => localdb.customers.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const bills = live(useLiveQuery(() => localdb.bills.where("branch_id").equals(branchId).toArray(), [branchId], []))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const [q, setQ] = useState("");
  const [ledger, setLedger] = useState<string | null>(null);
  const [tab, setTab] = useState<"outstanding" | "paid">("outstanding");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [payFor, setPayFor] = useState<{ name: string; due: number } | null>(null);
  const [payAmt, setPayAmt] = useState<number | "">("");

  const toggle = (name: string) => setExpanded((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });

  const outstandingRows = cust.filter((c) => c.balance_due > 0 && c.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.balance_due - a.balance_due);
  const totalDue = sum(outstandingRows, "balance_due");

  // "Paid" = customers with no outstanding balance who have at least one bill history entry.
  const paidNames = [...new Set(bills.filter((b) => b.status === "paid").map((b) => b.customer_name))]
    .filter((n) => !cust.find((c) => c.name === n && c.balance_due > 0))
    .filter((n) => n.toLowerCase().includes(q.toLowerCase()));

  const billsFor = (name: string) => bills.filter((b) => b.customer_name === name);

  const doPay = async () => {
    if (!payFor) return;
    const amt = Number(payAmt) || 0;
    if (amt <= 0) return toast("Enter amount");
    const applied = await settleCustomerDues(branchId, payFor.name, amt);
    toast(applied > 0 ? `${money(applied)} settled for ${payFor.name}` : "No dues to settle");
    setPayFor(null); setPayAmt(""); shared.onSync();
  };

  return (
    <>
      <h1 className="page-title" style={{ fontSize: 22 }}>Ledger</h1>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={tab === "outstanding" ? "active" : ""} onClick={() => setTab("outstanding")}>Outstanding</button>
        <button className={tab === "paid" ? "active" : ""} onClick={() => setTab("paid")}>Paid</button>
      </div>

      {tab === "outstanding" ? (
        <>
          <div className="m-stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="stat"><div className="label">Customers with dues</div><div className="value" style={{ fontSize: 18 }}>{outstandingRows.length}</div></div>
            <div className="stat"><div className="label">Total outstanding</div><div className="value" style={{ fontSize: 18, color: totalDue > 0 ? "var(--red)" : "var(--green)" }}>{money(totalDue)}</div></div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Customer balances</h3><input className="search" placeholder="Search customer…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="card-pad" style={{ paddingTop: 6 }}>
              {outstandingRows.length ? outstandingRows.map((c) => {
                const isOpen = expanded.has(c.name);
                const cBills = billsFor(c.name).filter((b) => b.status === "unpaid");
                return (
                  <div key={c.id}>
                    <div className="row" style={{ cursor: "pointer" }} onClick={() => toggle(c.name)}>
                      <div><div className="main">{c.name}</div><div className="sub">{c.phone || "—"} · {cBills.length} bill{cBills.length === 1 ? "" : "s"} due · {isOpen ? "hide" : "tap to see bills"}</div></div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="amt out">{money(c.balance_due)}</div>
                        <button className="pay-btn" onClick={(e) => { e.stopPropagation(); setPayFor({ name: c.name, due: c.balance_due }); setPayAmt(c.balance_due); }}>Pay</button>
                        <button className="edit-btn" onClick={(e) => { e.stopPropagation(); setLedger(c.name); }}>Full ledger</button>
                      </div>
                    </div>
                    {isOpen && cBills.map((b) => (
                      <div className="row" key={b.id} style={{ paddingLeft: 14, background: "var(--surface-2)" }}>
                        <div><div className="main" style={{ fontSize: 13 }}>{b.bill_no ? `Bill #${b.bill_no}` : "Udhaar bill"}</div>
                          <div className="sub">{dateStr(b.created_at)} · paid {money(b.paid)} of {money(b.amount)}</div></div>
                        <div className="amt out">{money(b.due_amount)}</div>
                      </div>
                    ))}
                  </div>
                );
              }) : <div className="empty">No outstanding dues. All clear!</div>}
            </div>
          </div>
        </>
      ) : (
        <div className="card">
          <div className="card-head"><h3>Paid customers</h3><input className="search" placeholder="Search customer…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="card-pad" style={{ paddingTop: 6 }}>
            {paidNames.length ? paidNames.map((name) => {
              const isOpen = expanded.has(name);
              const cBills = billsFor(name).filter((b) => b.status === "paid");
              const total = sum(cBills, "amount");
              return (
                <div key={name}>
                  <div className="row" style={{ cursor: "pointer" }} onClick={() => toggle(name)}>
                    <div><div className="main">{name}</div><div className="sub">{cBills.length} bill{cBills.length === 1 ? "" : "s"} settled · {isOpen ? "hide" : "tap to see bills"}</div></div>
                    <div className="amt in">{money(total)}</div>
                  </div>
                  {isOpen && cBills.map((b) => (
                    <div className="row" key={b.id} style={{ paddingLeft: 14, background: "var(--surface-2)" }}>
                      <div><div className="main" style={{ fontSize: 13 }}>{b.bill_no ? `Bill #${b.bill_no}` : "Udhaar bill"}</div>
                        <div className="sub">{dateStr(b.created_at)}</div></div>
                      <span className="badge paid">Paid</span>
                    </div>
                  ))}
                </div>
              );
            }) : <div className="empty">No settled bills yet.</div>}
          </div>
        </div>
      )}

      {payFor && (
        <Modal title={`Pay — ${payFor.name}`} onClose={() => setPayFor(null)}>
          <div className="form-grid">
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>Outstanding: <b style={{ color: "var(--red)" }}>{money(payFor.due)}</b></p>
            <div className="field"><label>Amount received</label><input type="number" inputMode="numeric" value={payAmt} onChange={(e) => setPayAmt(e.target.value === "" ? "" : +e.target.value)} /></div>
            <div className="btn-row"><button className="btn ghost" onClick={() => setPayFor(null)}>Cancel</button><button className="btn" onClick={doPay}>Record payment</button></div>
          </div>
        </Modal>
      )}
      {ledger && <LedgerModal branchId={branchId} name={ledger} onClose={() => setLedger(null)} onSync={shared.onSync} />}
    </>
  );
}

/* ---------- Sale (New Bill / Previous Bills) ---------- */
type DiscType = "none" | "5" | "10" | "custom" | "flat";
type CartLine = CartItem & { box: number; pcs: number; perBox: number; unit: string };

function BillingForm({ branchId, shared, branchName }: { branchId: string; shared: SharedProps; branchName: string }) {
  const [billTab, setBillTab] = useState<"new" | "previous">("new");
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h1 className="page-title" style={{ fontSize: 22, margin: 0 }}>New Bill</h1>
      </div>
      <div className="seg" style={{ marginBottom: 14, width: "100%" }}>
        <button className={billTab === "new" ? "active" : ""} style={{ flex: 1 }} onClick={() => setBillTab("new")}>New Bill</button>
        <button className={billTab === "previous" ? "active" : ""} style={{ flex: 1 }} onClick={() => setBillTab("previous")}>Previous Bills</button>
      </div>
      {billTab === "new"
        ? <NewBillForm branchId={branchId} shared={shared} branchName={branchName} />
        : <PreviousBills branchId={branchId} shared={shared} branchName={branchName} />}
    </>
  );
}

function NewBillForm({ branchId, shared, branchName }: { branchId: string; shared: SharedProps; branchName: string }) {
  const products = productsForBranch(useLiveQuery(() => localdb.products.toArray(), [], []), branchId);
  const branchSales = useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []);
  const branchPurch = useLiveQuery(() => localdb.purchases.where("branch_id").equals(branchId).toArray(), [branchId], []);
  const customers = live(useLiveQuery(() => localdb.customers.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const settings = useLiveQuery(() => localdb.settings.get("main"), [], undefined);

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  // Customer — dropdown of saved customers, still free text for new ones.
  const [cust, setCust] = useState("");
  const [showCustDd, setShowCustDd] = useState(false);
  const custMatches = customers.filter((c) => c.name.toLowerCase().includes(cust.trim().toLowerCase())).slice(0, 8);

  // Product search — selecting a match adds it to the bill immediately
  // (1 pc, at its listed price). Box/Pcs and discount are then adjusted
  // per-item in the Added Items list below — no separate "add" step.
  const [pq, setPq] = useState("");
  const [showPd, setShowPd] = useState(false);
  const [pActive, setPActive] = useState(0);
  const productInputRef = useRef<HTMLInputElement>(null);
  const pMatches = products.filter((pr) => pr.name.toLowerCase().includes(pq.toLowerCase())).slice(0, 30);

  const [cart, setCart] = useState<CartLine[]>([]);

  const addProduct = (pr: typeof products[number]) => {
    const perBox = pr.pieces_per_box || 0;
    setCart((c) => {
      // Same product tapped again — just bump its pcs by 1 instead of a duplicate row.
      const idx = c.findIndex((x) => x.product_id === pr.id && !x.discountValue);
      if (idx >= 0) {
        const next = [...c];
        next[idx] = { ...next[idx], pcs: next[idx].pcs + 1, qty: next[idx].qty + 1 };
        return next;
      }
      return [...c, {
        product_id: pr.id, name: pr.name, qty: 1, price: pr.sale_price,
        discountType: undefined, discountValue: 0, box: 0, pcs: 1, perBox, unit: pr.unit,
      }];
    });
    setPq(""); setShowPd(false); setPActive(0);
    setTimeout(() => productInputRef.current?.focus(), 0);
  };
  const onProductKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showPd || pMatches.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setPActive((i) => Math.min(i + 1, pMatches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setPActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); addProduct(pMatches[pActive] ?? pMatches[0]); }
  };

  const setLine = (i: number, patch: Partial<CartLine>) => setCart((c) => c.map((x, k) => k === i ? { ...x, ...patch } : x));
  const bump = (i: number, field: "box" | "pcs", delta: number) => setCart((c) => c.map((x, k) => {
    if (k !== i) return x;
    const box = field === "box" ? Math.max(0, x.box + delta) : x.box;
    const pcs = field === "pcs" ? Math.max(0, x.pcs + delta) : x.pcs;
    return { ...x, box, pcs, qty: box * (x.perBox || 0) + pcs };
  }));
  const removeItem = (i: number) => setCart((c) => c.filter((_, k) => k !== i));

  // Bill-level discount (applies as a single line at the bottom, matching
  // the reference design's "Discount: None ▾" under the totals, not per item).
  const [discType, setDiscType] = useState<DiscType>("none");
  const [discCustom, setDiscCustom] = useState(0);
  const [discFlat, setDiscFlat] = useState(0);
  const billDiscountType: "percent" | "flat" | undefined = discType === "flat" ? "flat" : discType === "none" ? undefined : "percent";
  const billDiscountValue = discType === "custom" ? discCustom : discType === "flat" ? discFlat : discType === "none" ? 0 : Number(discType);

  const subtotal = cart.reduce((a, c) => a + c.qty * c.price, 0);
  const { lineTotal: cartTotal, discountAmt: billDiscountAmt } = computeLineTotal(1, subtotal, billDiscountType, billDiscountValue);

  // Payment
  const [payMode, setPayMode] = useState<"cash" | "upi" | "both" | "credit">("cash");
  const [cashAmt, setCashAmt] = useState<number | "">("");
  const [upiAmt, setUpiAmt] = useState<number | "">("");
  const [paidFull, setPaidFull] = useState(true);
  const [partialAmt, setPartialAmt] = useState<number | "">("");
  const [saving, setSaving] = useState(false);

  const today = rangeStart("today");
  const todayTotal = sum(live(branchSales).filter((s) => new Date(s.created_at).getTime() >= today), "total");

  const amountPaidNow = payMode === "credit" ? 0
    : paidFull ? cartTotal
    : payMode === "both" ? (Number(cashAmt) || 0) + (Number(upiAmt) || 0)
    : Math.max(0, Number(partialAmt) || 0);
  const dueNow = Math.max(0, cartTotal - amountPaidNow);

  const save = async (print: boolean) => {
    if (!cart.length) return toast("Add at least one item");
    if (cart.some((c) => c.qty <= 0)) return toast("Every item needs a quantity greater than 0");
    if (payMode === "both" && (Number(cashAmt) || 0) + (Number(upiAmt) || 0) <= 0) {
      return toast("Enter the cash and/or UPI amount");
    }
    setSaving(true);
    const splitCash = Number(cashAmt) || 0;
    const splitUpi = Number(upiAmt) || 0;
    const finalCash = payMode === "both" ? (paidFull ? Math.max(splitCash, cartTotal - splitUpi) : splitCash) : undefined;
    const finalUpi = payMode === "both" ? splitUpi : undefined;

    // Bill-level discount is folded into the first item so createSaleBill's
    // per-item total still adds up to the discounted grand total exactly.
    const items: CartItem[] = cart.map((c, i) => {
      if (i !== 0 || !billDiscountAmt) return { product_id: c.product_id, name: c.name, qty: c.qty, price: c.price };
      return { product_id: c.product_id, name: c.name, qty: c.qty, price: c.price, discountType: "flat", discountValue: billDiscountAmt };
    });

    const { billNo, due } = await createSaleBill(branchId, shared.profile.id, cust, {
      mode: payMode, amountPaid: amountPaidNow, cashAmount: finalCash, upiAmount: finalUpi,
    }, items);
    setSaving(false);
    if (print) printItemizedBill(billNo, cart.map((c) => ({ name: c.name, qty: c.qty, price: c.price })), cust.trim() || "Walk-in", payMode, settings, branchName, amountPaidNow);
    toast(`Bill ${billNo} saved` + (due > 0 ? ` — ${money(due)} due` : "") + (shared.online ? "" : " offline"));
    setCart([]); setCust(""); setDiscType("none"); setDiscCustom(0); setDiscFlat(0);
    setPayMode("cash"); setCashAmt(""); setUpiAmt(""); setPaidFull(true); setPartialAmt(""); shared.onSync();
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Today: <b style={{ color: "var(--green)" }}>{money(todayTotal)}</b></span>
      </div>

      {/* Customer */}
      <div className="card card-pad">
        <div className="field" style={{ position: "relative" }}>
          <label>Customer</label>
          <input value={cust} onChange={(e) => { setCust(e.target.value); setShowCustDd(true); }}
            onFocus={() => setShowCustDd(true)} onBlur={() => setTimeout(() => setShowCustDd(false), 150)}
            placeholder="Walk-in (or type/select a name)" />
          {showCustDd && custMatches.length > 0 && (
            <div className="card" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, maxHeight: 220, overflowY: "auto", marginTop: 4 }}>
              {custMatches.map((c) => (
                <div key={c.id} className="row" style={{ padding: "10px 14px", cursor: "pointer" }}
                  onMouseDown={() => { setCust(c.name); setShowCustDd(false); }}>
                  <div><div className="main">{c.name}</div><div className="sub">{c.phone || "—"}</div></div>
                  {c.balance_due > 0 && <span className="amt out">{money(c.balance_due)} due</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {/* Product search — tap a result and it's added instantly */}
      <div className="card card-pad">
        <div className="field" style={{ position: "relative", marginBottom: 0 }}>
          <input ref={productInputRef} className="search" style={{ width: "100%" }} value={pq}
            onChange={(e) => { setPq(e.target.value); setShowPd(true); setPActive(0); }}
            onFocus={() => setShowPd(true)} onBlur={() => setTimeout(() => setShowPd(false), 150)}
            onKeyDown={onProductKeyDown}
            placeholder="Search products…" />
          {showPd && pMatches.length > 0 && (
            <div className="card" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, maxHeight: 280, overflowY: "auto", marginTop: 4 }}>
              {pMatches.map((pr, i) => (
                <div key={pr.id} className="row" style={{ padding: "10px 14px", cursor: "pointer", background: i === pActive ? "var(--surface-2)" : undefined }}
                  onMouseEnter={() => setPActive(i)} onMouseDown={() => addProduct(pr)}>
                  <div><div className="main">{pr.name}</div><div className="sub">{money(pr.sale_price)}/{pr.unit}{pr.pieces_per_box ? ` · 1 box = ${pr.pieces_per_box} pcs` : ""}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Added items */}
      <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", margin: "18px 0 8px" }}>Added Items</h3>
      {cart.length ? cart.map((c, i) => {
        const { lineTotal: lt } = computeLineTotal(c.qty, c.price, undefined, 0);
        return (
          <div className="card card-pad" key={i} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div className="main" style={{ fontWeight: 700 }}>{c.name} ({c.qty})</div>
                <div className="sub">Rate: {money(c.price)}{c.perBox ? ` · 1 box = ${c.perBox} pcs` : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <b style={{ color: "var(--accent)" }}>{money(lt)}</b>
                <button className="del-btn" onClick={() => removeItem(i)}><Icon name="trash" size={14} /></button>
              </div>
            </div>
            <div className="qty-row" style={{ gridTemplateColumns: c.perBox ? "1fr 1fr" : "1fr", marginTop: 12 }}>
              {c.perBox > 0 && (
                <div>
                  <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Box</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <button className="edit-btn" style={{ width: 32, height: 32, padding: 0 }} onClick={() => bump(i, "box", -1)}><Icon name="minus" size={14} /></button>
                    <span style={{ minWidth: 24, textAlign: "center", fontWeight: 700 }}>{c.box}</span>
                    <button className="edit-btn" style={{ width: 32, height: 32, padding: 0 }} onClick={() => bump(i, "box", 1)}><Icon name="plus" size={14} /></button>
                  </div>
                </div>
              )}
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Pcs</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <button className="edit-btn" style={{ width: 32, height: 32, padding: 0 }} onClick={() => bump(i, "pcs", -1)}><Icon name="minus" size={14} /></button>
                  <span style={{ minWidth: 24, textAlign: "center", fontWeight: 700 }}>{c.pcs}</span>
                  <button className="edit-btn" style={{ width: 32, height: 32, padding: 0 }} onClick={() => bump(i, "pcs", 1)}><Icon name="plus" size={14} /></button>
                </div>
              </div>
            </div>
          </div>
        );
      }) : <div className="card card-pad"><div className="empty">No items yet. Search a product above to add it.</div></div>}

      {cart.length > 0 && (
        <>
          {/* Totals */}
          <div className="card card-pad">
            <div className="row" style={{ padding: "6px 0" }}><span className="sub">Subtotal</span><b>{money(subtotal)}</b></div>
            <div className="row" style={{ padding: "6px 0" }}>
              <span className="sub">Discount</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select value={discType} onChange={(e) => setDiscType(e.target.value as DiscType)} style={{ width: "auto" }}>
                  <option value="none">None</option>
                  <option value="5">5%</option>
                  <option value="10">10%</option>
                  <option value="custom">Custom %</option>
                  <option value="flat">Flat ₹</option>
                </select>
                {billDiscountAmt > 0 && <span className="amt out">-{money(billDiscountAmt)}</span>}
              </div>
            </div>
            {discType === "custom" && (
              <div className="field" style={{ marginTop: 4 }}><label>Custom discount %</label><input type="number" inputMode="numeric" value={discCustom} onChange={(e) => setDiscCustom(+e.target.value)} /></div>
            )}
            {discType === "flat" && (
              <div className="field" style={{ marginTop: 4 }}><label>Flat discount ₹</label><input type="number" inputMode="numeric" value={discFlat} onChange={(e) => setDiscFlat(+e.target.value)} /></div>
            )}
            <div className="row" style={{ padding: "10px 0 0", borderTop: "1px solid var(--line)", marginTop: 6 }}>
              <b style={{ fontSize: 15 }}>Grand Total</b><b style={{ fontSize: 18, color: "var(--accent)" }}>{money(cartTotal)}</b>
            </div>
          </div>

          {/* Payment */}
          <div className="card card-pad">
            <div className="field"><label>Payment mode</label>
              <div className="pay-select">
                {(["cash", "upi", "both", "credit"] as const).map((m) => (
                  <button key={m} className={"pay-opt" + (payMode === m ? " active" : "")} onClick={() => setPayMode(m)}>{m === "credit" ? "Credit" : m === "both" ? "Cash+UPI" : m.toUpperCase()}</button>
                ))}
              </div>
            </div>

            {payMode !== "credit" && (
              <label className="row" style={{ padding: "6px 0", cursor: "pointer" }}>
                <span className="main" style={{ fontSize: 14 }}>Customer paid the full amount now</span>
                <input type="checkbox" checked={paidFull} onChange={(e) => setPaidFull(e.target.checked)} style={{ width: 20, height: 20 }} />
              </label>
            )}

            {payMode === "both" && (
              <div className="qty-row">
                <div className="field"><label>Cash ₹</label><input type="number" inputMode="numeric" value={cashAmt} onChange={(e) => setCashAmt(e.target.value === "" ? "" : +e.target.value)} /></div>
                <div className="field"><label>UPI ₹</label><input type="number" inputMode="numeric" value={upiAmt} onChange={(e) => setUpiAmt(e.target.value === "" ? "" : +e.target.value)} /></div>
              </div>
            )}

            {payMode !== "credit" && !paidFull && payMode !== "both" && (
              <div className="field"><label>Amount received now (partial)</label>
                <input type="number" inputMode="numeric" value={partialAmt} onChange={(e) => setPartialAmt(e.target.value === "" ? "" : +e.target.value)} placeholder="0" />
              </div>
            )}
            {payMode !== "credit" && !paidFull && payMode === "both" && (
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Cash + UPI entered above is treated as the partial amount received now.</div>
            )}

            {dueNow > 0 && <div style={{ textAlign: "center", color: "var(--red)", fontWeight: 700, fontSize: 14, marginTop: 4 }}>Due after this bill: {money(dueNow)}</div>}
          </div>
        </>
      )}

      <div className="btn-row" style={{ marginTop: 4 }}>
        <button className="btn ghost" onClick={() => save(false)} disabled={saving || !cart.length}>Save Bill</button>
        <button className="btn" onClick={() => save(true)} disabled={saving || !cart.length}><Icon name="bill" size={16} /> Save &amp; Print</button>
      </div>
    </>
  );
}

/* Previous Bills — past sales for this branch, grouped by bill_no, with reprint. */
function PreviousBills({ branchId, shared, branchName }: { branchId: string; shared: SharedProps; branchName: string }) {
  const sales = live(useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const settings = useLiveQuery(() => localdb.settings.get("main"), [], undefined);
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const map = new Map<string, { billNo: string; items: typeof sales; total: number; customer: string; date: string; pay: string }>();
    for (const s of sales) {
      const key = s.bill_no || s.id;
      if (!map.has(key)) map.set(key, { billNo: key, items: [], total: 0, customer: s.customer_name || "Walk-in", date: s.created_at, pay: s.payment_mode || "cash" });
      const g = map.get(key)!;
      g.items.push(s); g.total += s.total;
    }
    return [...map.values()]
      .filter((g) => g.billNo.toLowerCase().includes(q.toLowerCase()) || g.customer.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [sales, q]);

  const reprint = (g: typeof groups[number]) => {
    printItemizedBill(g.billNo, g.items.map((s) => ({ name: s.product_name, qty: s.qty, price: s.price })), g.customer, g.pay, settings, branchName, g.total);
  };

  return (
    <div className="card">
      <div className="card-head"><h3>Previous bills</h3><input className="search" placeholder="Search bill # or customer…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="card-pad" style={{ paddingTop: 6 }}>
        {groups.length ? groups.map((g) => (
          <div className="row" key={g.billNo}>
            <div><div className="main">{g.billNo.startsWith(g.customer) ? g.billNo : `Bill #${g.billNo}`}</div>
              <div className="sub">{g.customer} · {dateStr(g.date)} · {g.items.length} item{g.items.length === 1 ? "" : "s"} · {g.pay.toUpperCase()}</div></div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <b>{money(g.total)}</b>
              <button className="edit-btn" onClick={() => reprint(g)}><Icon name="bill" size={14} /> Print</button>
            </div>
          </div>
        )) : <div className="empty">No bills yet.</div>}
      </div>
      {!shared && null}
    </div>
  );
}

/* ---------- Purchase (professional) ---------- */
function PurchaseForm({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const products = productsForBranch(useLiveQuery(() => localdb.products.toArray(), [], []), branchId);
  const [pid, setPid] = useState("");
  const [supplier, setSupplier] = useState("");
  const [qty, setQty] = useState(1);
  const [cost, setCost] = useState(0);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [pay, setPay] = useState<"cash" | "credit">("cash");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const selected = products.find((x) => x.id === pid) ?? products[0];
  useMemo(() => { if (selected) setCost(selected.cost_price); }, [selected?.id]);

  const allPurch = live(useLiveQuery(() => localdb.purchases.where("branch_id").equals(branchId).toArray(), [branchId], []))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const today = rangeStart("today");
  const todaySpend = sum(allPurch.filter((p) => new Date(p.created_at).getTime() >= today), "total");
  const suppliers = [...new Set(allPurch.map((p) => p.supplier).filter(Boolean))] as string[];
  const delPurch = async (id: string) => { if (confirmDel("purchase")) { await softDelete("purchases", id); toast("Deleted"); shared.onSync(); } };

  const save = async () => {
    if (!selected) return toast("No products for this branch");
    if (!supplier.trim()) return toast("Enter supplier / company");
    if (!qty || qty < 1) return toast("Enter a valid quantity");
    await createPurchase(branchId, shared.profile.id, {
      productId: selected.id, productName: selected.name, supplier, qty, cost,
      invoiceNo, paymentMode: pay, note, date,
    });
    toast("Purchase saved" + (shared.online ? "" : " offline"));
    setQty(1); setInvoiceNo(""); setNote(""); shared.onSync();
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 className="page-title" style={{ fontSize: 22 }}>New Purchase</h1>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Today: <b style={{ color: "var(--red)" }}>{money(todaySpend)}</b></span>
      </div>
      <div className="card card-pad"><div className="form-grid">
        <div className="field"><label>Supplier / Company</label>
          <input list="sup-list" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Guwahati Distributors" />
          <datalist id="sup-list">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <div className="field"><label>Product</label>
          <select value={selected?.id ?? ""} onChange={(e) => { setPid(e.target.value); const pr = products.find((x) => x.id === e.target.value); if (pr) setCost(pr.cost_price); }}>
            {products.length ? products.map((pr) => <option key={pr.id} value={pr.id}>{pr.name} — cost {money(pr.cost_price)}</option>) : <option>No products — owner must add first</option>}
          </select>
        </div>
        <div className="qty-row">
          <div className="field"><label>Quantity</label><input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(+e.target.value)} /></div>
          <div className="field"><label>Cost each</label><input type="number" inputMode="numeric" value={cost} onChange={(e) => setCost(+e.target.value)} /></div>
        </div>
        <div className="qty-row">
          <div className="field"><label>Supplier bill no.</label><input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="optional" /></div>
          <div className="field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="field"><label>Payment to supplier</label>
          <div className="pay-select">
            {(["cash", "credit"] as const).map((m) => <button key={m} className={"pay-opt" + (pay === m ? " active" : "")} onClick={() => setPay(m)}>{m === "credit" ? "Credit (owed)" : "Cash / Paid"}</button>)}
          </div>
        </div>
        <div className="field"><label>Note (optional)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. damaged 2 pcs" /></div>
        <div className="total-preview">{money((qty || 0) * (cost || 0))}</div>
        <button className="btn" onClick={save}>Save Purchase</button>
      </div></div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Recent purchases</h3></div>
        <div className="card-pad" style={{ paddingTop: 6 }}>
          {allPurch.length ? allPurch.slice(0, 20).map((x) => (
            <div className="row" key={x.id}><div><div className="main">{x.supplier || "—"} · {x.product_name} × {x.qty}</div>
              <div className="sub">{dateStr(x.created_at)}{x.invoice_no ? " · #" + x.invoice_no : ""} · {(x.payment_mode || "cash") === "credit" ? "CREDIT" : "PAID"}{x._synced === 0 ? " · ⏳" : ""}</div></div>
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
      {ledger && <LedgerModal branchId={branchId} name={ledger} onClose={() => setLedger(null)} onSync={shared.onSync} />}
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
