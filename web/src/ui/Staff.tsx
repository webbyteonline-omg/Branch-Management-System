import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localdb, pendingCount } from "../lib/db";
import { Icon } from "../lib/icons";
import { money, dateStr, timeStr, rangeStart } from "../lib/format";
import { toast } from "./Toast";
import { Modal } from "./Modal";
import { LedgerModal } from "./Ledger";
import { EditCustomerModal, EditEntryModal, EditBillModal, EditBillGroupModal } from "./Edits";
import { SyncStatusModal } from "./SyncStatus";
import { addCustomer, addBill, recordPayment, addExpense, softDelete, createSaleBill, createPurchase, computeLineTotal, settleCustomerDues, saveProduct, voidBill, voidSaleGroup, type CartItem } from "../lib/writes";
import { sum, live, forTotals, computeStock, productsForBranch, type SharedProps } from "./shared";
import { BarChart } from "./Charts";
import { downloadExcel } from "../lib/excel";
import type { Purchase, Bill as BillT, Product as ProductT } from "../lib/types";

const confirmDel = (what: string) => window.confirm(`Delete this ${what}? It can be restored by the owner.`);

type Tab = "dashboard" | "sale" | "purchase" | "unpaid" | "previous" | "customers" | "ledger" | "stock" | "products" | "daybook";

export function Staff(p: SharedProps) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [showMenu, setShowMenu] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const branchId = p.profile.branch_id!;
  const branches = useLiveQuery(() => localdb.branches.toArray(), [], []);
  const branchName = branches.find((b) => b.id === branchId)?.name ?? "My Branch";
  const pending = useLiveQuery(() => pendingCount(), [], 0) ?? 0;

  // Bottom bar: the 5 most-used. Everything (incl. these) also lives in the hamburger menu.
  const tabs: [Tab, string, string][] = [
    ["dashboard", "Home", "dashboard"], ["sale", "Billing", "sales"], ["purchase", "Purchase", "cart"],
    ["unpaid", "Unpaid", "warning"], ["previous", "Previous", "bill"],
  ];
  const menuItems: [Tab, string, string][] = [
    ["dashboard", "Dashboard", "dashboard"], ["sale", "Billing / Sell", "sales"], ["purchase", "Purchase", "cart"],
    ["ledger", "Ledger", "book"], ["customers", "Customers", "customers"], ["products", "Products", "boxIcon"],
    ["stock", "Stock", "reports"], ["unpaid", "Unpaid Bills", "warning"], ["previous", "Previous Bills", "bill"],
    ["daybook", "Day Book", "day"],
  ];

  const go = (t: Tab) => { setTab(t); setShowMenu(false); };
  const doLogout = () => {
    setShowMenu(false);
    if (window.confirm("Sign out of this device?")) p.onLogout();
  };

  return (
    <>
      <div className="mobile-top" style={{ background: "var(--surface)" }}>
        <div className="actions">
          <button className="icon-btn" onClick={() => setShowMenu(true)}><Icon name="menu" size={22} /></button>
          <b style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.1 }}>{branchName}</b>
        </div>
        <div className="actions">
          <button className={"sync-pill " + (p.syncError ? "pending" : pending > 0 ? "pending" : "ok")}
            style={{ border: "none" }} onClick={() => setShowSync(true)} title="Sync status">
            <span className="dot" />{p.syncError ? "Sync error" : pending > 0 ? `${pending} pending` : "Synced"}
          </button>
        </div>
      </div>
      {p.syncError && (
        <div style={{ background: "var(--red-soft)", color: "var(--red)", fontSize: 12.5, padding: "8px 16px", textAlign: "center", fontWeight: 600 }}>
          ⚠ Some entries aren't reaching Head Office yet. They're saved safely on this device — {p.syncError}
        </div>
      )}
      <div className="m-content">
        {tab === "dashboard" && <StaffDashboard branchId={branchId} branchName={branchName} shared={p} go={go} />}
        {tab === "sale" && <NewBillForm branchId={branchId} shared={p} branchName={branchName} />}
        {tab === "purchase" && <PurchaseForm branchId={branchId} shared={p} />}
        {tab === "unpaid" && <UnpaidBills branchId={branchId} shared={p} />}
        {tab === "previous" && <PreviousBills branchId={branchId} shared={p} branchName={branchName} />}
        {tab === "customers" && <Customers branchId={branchId} shared={p} />}
        {tab === "products" && <StaffProducts branchId={branchId} shared={p} />}
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
            <div style={{ padding: "20px 18px 16px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--line-2)" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 17 }}>
                {p.profile.name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{p.profile.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{branchName}</div>
              </div>
              <button className="icon-btn" onClick={() => setShowMenu(false)}><Icon name="close" size={18} /></button>
            </div>
            <div className="modal-body" style={{ padding: 10, flex: 1, display: "flex", flexDirection: "column" }}>
              <button className={"net-toggle " + (p.online ? "online" : "offline")} style={{ margin: "0 0 8px", width: "100%", padding: "10px 0" }} onClick={p.onToggleOnline} title={p.online ? "Tap to force offline mode" : "Tap to go back online — will auto-sync"}>
                {p.online ? "Online — tap for offline mode" : "Offline mode — tap to reconnect"}
              </button>
              {menuItems.map(([t, label, ic]) => (
                <button key={t} className={"nav-item" + (tab === t ? " active" : "")} style={{ borderRadius: 999 }} onClick={() => go(t)}>
                  <Icon name={ic} size={19} /><span>{label}</span>
                </button>
              ))}
              <div className="nav-sep" />
              <button className="nav-item" style={{ borderRadius: 999, color: "var(--red)", marginTop: "auto" }} onClick={doLogout}>
                <Icon name="logout" size={19} /><span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {showSync && <SyncStatusModal shared={p} onClose={() => setShowSync(false)} />}
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
  const sales = forTotals(useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const bills = forTotals(useLiveQuery(() => localdb.bills.where("branch_id").equals(branchId).toArray(), [branchId], []));

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

  const recent = [...sales].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 4);

  return (
    <>
      <button className="btn" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "16px", borderRadius: 12, fontSize: 16, fontWeight: 700, marginBottom: 18, boxShadow: "var(--shadow-lg)" }} onClick={() => go("sale")}>
        <Icon name="addCircle" size={22} /> New Bill
      </button>

      <div className="m-stats" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <div className="stat" style={{ textAlign: "center", boxShadow: "var(--shadow-lg)" }}>
          <div className="label" style={{ textTransform: "uppercase" }}>Sold Today</div>
          <div className="value" style={{ color: "var(--accent)", fontSize: 19 }}>{money(sold)}</div>
        </div>
        <div className="stat" style={{ textAlign: "center", boxShadow: "var(--shadow-lg)" }}>
          <div className="label" style={{ textTransform: "uppercase" }}>Received</div>
          <div className="value" style={{ color: "var(--green)", fontSize: 19 }}>{money(receivedToday)}</div>
        </div>
        <div className="stat" style={{ textAlign: "center", boxShadow: "var(--shadow-lg)" }}>
          <div className="label" style={{ textTransform: "uppercase" }}>Due</div>
          <div className="value" style={{ fontSize: 19, color: due > 0 ? "var(--red)" : "var(--green)" }}>{money(due)}</div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 16, boxShadow: "var(--shadow-lg)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Sales — Last 7 Days</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{chartData[0]?.label} – {chartData[6]?.label}</span>
        </div>
        <BarChart data={chartData} color="var(--accent)" />
      </div>

      <div style={{ marginTop: 18 }}>
        <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", margin: "0 0 10px" }}>Recent Activity</h3>
        {recent.length ? recent.map((s) => (
          <div className="row" key={s.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center" }}>
                <Icon name="bill" size={18} />
              </div>
              <div><div className="main">{s.product_name}</div><div className="sub">{s.customer_name || "Walk-in"} • {timeStr(s.created_at)}</div></div>
            </div>
            <span style={{ fontWeight: 700 }}>{money(s.total)}</span>
          </div>
        )) : <div className="empty">No activity yet today.</div>}
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
  const [statusFilter, setStatusFilter] = useState<"" | "out" | "low" | "in">("");

  const allRows = products
    .map((pr) => ({ ...pr, stock: computeStock(pr.id, branchId, sales, purch) }))
    .filter((pr) => pr.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const statusOf = (r: any) => r.stock <= 0 ? "out" : r.stock <= (r.low_stock_at ?? 5) ? "low" : "in";
  const rows = statusFilter ? allRows.filter((r) => statusOf(r) === statusFilter) : allRows;
  const outCount = allRows.filter((r) => statusOf(r) === "out").length;
  const lowCount = allRows.filter((r) => statusOf(r) === "low").length;
  const inCount = allRows.filter((r) => statusOf(r) === "in").length;

  return (
    <>
      <div className="field" style={{ position: "relative", marginBottom: 14 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }}><Icon name="search" size={17} /></span>
        <input style={{ paddingLeft: 38, height: 48, borderRadius: 12 }} placeholder="Search product name…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="m-stats" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginBottom: 16 }}>
        <div className="stat" style={{ textAlign: "center", cursor: "pointer", outline: statusFilter === "in" ? "2px solid var(--green)" : undefined, outlineOffset: -2 }} onClick={() => setStatusFilter(statusFilter === "in" ? "" : "in")}><div className="label">In Stock</div><div className="value" style={{ fontSize: 19, color: "var(--green)" }}>{inCount}</div></div>
        <div className="stat" style={{ textAlign: "center", cursor: "pointer", outline: statusFilter === "low" ? "2px solid var(--amber)" : undefined, outlineOffset: -2 }} onClick={() => setStatusFilter(statusFilter === "low" ? "" : "low")}><div className="label">Low Stock</div><div className="value" style={{ fontSize: 19, color: lowCount > 0 ? "var(--amber)" : "var(--muted)" }}>{lowCount}</div></div>
        <div className="stat" style={{ textAlign: "center", cursor: "pointer", outline: statusFilter === "out" ? "2px solid var(--red)" : undefined, outlineOffset: -2 }} onClick={() => setStatusFilter(statusFilter === "out" ? "" : "out")}><div className="label">Out of Stock</div><div className="value" style={{ fontSize: 19, color: outCount > 0 ? "var(--red)" : "var(--muted)" }}>{outCount}</div></div>
      </div>
      {statusFilter && <button className="btn ghost" style={{ width: "auto", padding: "6px 14px", fontSize: 12.5, marginBottom: 12 }} onClick={() => setStatusFilter("")}>✕ Clear filter</button>}
      {rows.length ? rows.map((pr) => {
        const low = pr.stock <= (pr.low_stock_at ?? 5);
        return (
          <div key={pr.id} className="card card-pad" style={{ marginBottom: 10, borderColor: low ? "var(--red)" : undefined, position: "relative", overflow: "hidden" }}>
            {low && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "var(--red)" }} />}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div className="main" style={{ fontWeight: 700 }}>{pr.name}</div>
              <span className={"status-pill " + (low ? "warn" : "ok")}>{low ? "Low Stock" : "In Stock"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
              <div><div style={{ fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Unit</div><div style={{ fontWeight: 600, fontSize: 13.5 }}>{pr.unit}</div></div>
              <div><div style={{ fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Stock</div><div style={{ fontWeight: 800, fontSize: 16, color: low ? "var(--red)" : "var(--text)" }}>{pr.stock}</div></div>
              <div><div style={{ fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Sale Price</div><div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--accent)" }}>{money(pr.sale_price)}</div></div>
            </div>
          </div>
        );
      }) : <div className="card card-pad"><div className="empty">No products for this branch yet.</div></div>}
    </>
  );
}

/* ---------- Products (add / edit / delete, own branch only) ---------- */
function StaffProducts({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const prodAll = useLiveQuery(() => localdb.products.toArray(), [], []);
  const products = productsForBranch(prodAll, branchId).sort((a, b) => a.name.localeCompare(b.name));
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Partial<ProductT> | null>(null);
  const blank: Partial<ProductT> = { name: "", unit: "pcs", sale_price: 0, cost_price: 0, low_stock_at: 5, branch_id: branchId };
  const rows = products.filter((pr) => pr.name.toLowerCase().includes(q.toLowerCase()));

  const save = async () => {
    if (!edit?.name?.trim()) return toast("Enter a product name");
    // Staff can only own products scoped to their branch — never the shared "all branches" catalog.
    await saveProduct({ ...edit, branch_id: branchId } as any, branchId);
    toast("Product saved" + (shared.online ? "" : " offline")); setEdit(null); shared.onSync();
  };
  const delProd = async (pr: ProductT) => { if (confirmDel("product")) { await softDelete("products", pr.id); toast("Deleted"); shared.onSync(); } };

  return (
    <>
      <div className="field" style={{ position: "relative", marginBottom: 14 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }}><Icon name="search" size={17} /></span>
        <input style={{ paddingLeft: 38, height: 48, borderRadius: 12 }} placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="m-stats" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 16 }}>
        <div className="stat" style={{ textAlign: "center" }}><div className="label">Products</div><div className="value" style={{ fontSize: 19, color: "var(--accent)" }}>{products.length}</div></div>
        <div className="stat" style={{ textAlign: "center" }}><div className="label">Catalog Value</div><div className="value" style={{ fontSize: 19 }}>{money(sum(products, "sale_price"))}</div></div>
      </div>
      {rows.length ? rows.map((pr) => (
        <div key={pr.id} className="card card-pad" style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="main" style={{ fontWeight: 700 }}>{pr.name}{pr._synced === 0 ? " · ⏳" : ""}</div>
            <span className="b-tag">{pr.branch_id ? "This branch" : "All branches"}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: pr.pieces_per_box ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr", gap: 10, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
            <div><div style={{ fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Unit</div><div style={{ fontWeight: 600, fontSize: 13.5 }}>{pr.unit}</div></div>
            <div><div style={{ fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Cost</div><div style={{ fontWeight: 600, fontSize: 13.5 }}>{money(pr.cost_price)}</div></div>
            <div><div style={{ fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Piece Price</div><div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--accent)" }}>{money(pr.sale_price)}</div></div>
            {!!pr.pieces_per_box && (
              <div><div style={{ fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Box Price</div><div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--accent)" }}>{money(pr.box_price || pr.pieces_per_box * pr.sale_price)}</div></div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn ghost" style={{ flex: 1, padding: "9px 0" }} onClick={() => setEdit({ ...pr })}>Edit</button>
            <button className="icon-btn" style={{ width: 40, height: 40, border: "1px solid var(--line)", borderRadius: 10, color: "var(--red)" }} onClick={() => delProd(pr)}><Icon name="trash" size={16} /></button>
          </div>
        </div>
      )) : <div className="card card-pad"><div className="empty">{products.length ? "No products match your search." : "No products yet for this branch."}</div></div>}

      <button className="fab round" onClick={() => setEdit({ ...blank })}><Icon name="plus" size={22} /></button>

      {edit && (
        <Modal title={edit.id ? "Edit product" : "Add product"} onClose={() => setEdit(null)}>
          <div className="form-grid">
            <div className="field"><label>Name</label><input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Product name" /></div>
            <div className="qty-row">
              <div className="field"><label>Unit</label><input value={edit.unit ?? ""} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} placeholder="box / kg" /></div>
              <div className="field"><label>Low-stock alert ≤</label><input type="number" inputMode="numeric" value={edit.low_stock_at ?? 5} onChange={(e) => setEdit({ ...edit, low_stock_at: +e.target.value })} /></div>
            </div>
            <div className="qty-row">
              <div className="field"><label>Cost price (per piece)</label><input type="number" inputMode="numeric" value={edit.cost_price ?? 0} onChange={(e) => setEdit({ ...edit, cost_price: +e.target.value })} /></div>
              <div className="field"><label>Sale price (per piece)</label><input type="number" inputMode="numeric" value={edit.sale_price ?? 0} onChange={(e) => setEdit({ ...edit, sale_price: +e.target.value })} /></div>
            </div>
            <div className="field"><label>Pieces per box (leave blank if not sold by box)</label>
              <input type="number" inputMode="numeric" value={edit.pieces_per_box ?? ""} onChange={(e) => setEdit({ ...edit, pieces_per_box: e.target.value === "" ? null : +e.target.value })} placeholder="e.g. 12" />
            </div>
            {!!edit.pieces_per_box && (
              <div className="qty-row">
                <div className="field"><label>Box cost price (optional)</label><input type="number" inputMode="numeric" value={edit.box_cost_price ?? ""} onChange={(e) => setEdit({ ...edit, box_cost_price: e.target.value === "" ? null : +e.target.value })} placeholder={`default: ${(edit.pieces_per_box || 0) * (edit.cost_price || 0)}`} /></div>
                <div className="field"><label>Box sale price (optional bulk rate)</label><input type="number" inputMode="numeric" value={edit.box_price ?? ""} onChange={(e) => setEdit({ ...edit, box_price: e.target.value === "" ? null : +e.target.value })} placeholder={`default: ${(edit.pieces_per_box || 0) * (edit.sale_price || 0)}`} /></div>
              </div>
            )}
            <div className="btn-row"><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn" onClick={save}>Save product</button></div>
          </div>
        </Modal>
      )}
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

  // "Paid" = customers with no outstanding balance who have at least one bill history entry (voided bills don't count as paid history).
  const paidNames = [...new Set(bills.filter((b) => b.status === "paid" && !b.void_at).map((b) => b.customer_name))]
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

  const exportStatement = () => {
    if (tab === "outstanding") {
      downloadExcel("ledger-outstanding", ["Customer", "Balance due"], outstandingRows.map((c) => [c.name, c.balance_due]));
    } else {
      const rows = paidNames.map((n) => [n, sum(billsFor(n).filter((b) => b.status === "paid" && !b.void_at), "amount")]);
      downloadExcel("ledger-paid", ["Customer", "Total paid"], rows);
    }
  };

  return (
    <>
      <div className="card" style={{ padding: 20, textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".6px", color: "var(--muted)", fontWeight: 700 }}>
          {tab === "outstanding" ? "Total Outstanding" : "Total Settled"}
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "var(--accent)", marginTop: 6 }}>{money(tab === "outstanding" ? totalDue : sum(bills.filter((b) => b.status === "paid" && !b.void_at), "amount"))}</div>
      </div>

      <div className="pill-toggle" style={{ marginBottom: 14 }}>
        <button className={tab === "outstanding" ? "active" : ""} onClick={() => setTab("outstanding")}>Outstanding</button>
        <button className={tab === "paid" ? "active" : ""} onClick={() => setTab("paid")}>Paid</button>
      </div>

      <button className="edit-btn" style={{ marginBottom: 12 }} onClick={exportStatement}>Export statement</button>

      <div className="field" style={{ position: "relative", marginBottom: 12 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }}><Icon name="search" size={16} /></span>
        <input style={{ paddingLeft: 36 }} placeholder="Search customer…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {tab === "outstanding" ? (
        outstandingRows.length ? outstandingRows.map((c) => {
          const isOpen = expanded.has(c.name);
          const cBills = billsFor(c.name).filter((b) => b.status === "unpaid");
          return (
            <div className="card" key={c.id} style={{ marginBottom: 8, overflow: "hidden" }}>
              <div style={{ padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => toggle(c.name)}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--surface-4)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 800 }}>{c.name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}</div>
                  <div><div className="main" style={{ fontWeight: 700 }}>{c.name}</div><div className="sub">{cBills.length} bill{cBills.length === 1 ? "" : "s"} due</div></div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ textAlign: "right" }}><div className="amt out" style={{ fontSize: 15 }}>{money(c.balance_due)}</div></div>
                  <button className="btn" style={{ width: "auto", padding: "8px 16px", borderRadius: 10, fontSize: 13 }} onClick={(e) => { e.stopPropagation(); setPayFor({ name: c.name, due: c.balance_due }); setPayAmt(c.balance_due); }}>Pay</button>
                  <span style={{ color: "var(--faint)", transform: isOpen ? "rotate(180deg)" : undefined, transition: "transform .15s" }}><Icon name="chevronDown" size={18} /></span>
                </div>
              </div>
              {isOpen && (
                <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {cBills.map((b) => (
                    <div key={b.id} style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div><div style={{ fontWeight: 700, fontSize: 12.5 }}>{b.bill_no ? `Bill #${b.bill_no}` : "Udhaar bill"}</div>
                        <div className="sub">{dateStr(b.created_at)} · paid {money(b.paid)} of {money(b.amount)}</div></div>
                      <span style={{ color: "var(--red)", fontSize: 12.5, fontWeight: 700 }}>{money(b.due_amount)}</span>
                    </div>
                  ))}
                  <button className="edit-btn" style={{ alignSelf: "flex-start", marginTop: 2 }} onClick={() => setLedger(c.name)}>Full ledger</button>
                </div>
              )}
            </div>
          );
        }) : <div className="card card-pad"><div className="empty">No outstanding dues. All clear!</div></div>
      ) : (
        paidNames.length ? paidNames.map((name) => {
          const isOpen = expanded.has(name);
          const cBills = billsFor(name).filter((b) => b.status === "paid" && !b.void_at);
          const total = sum(cBills, "amount");
          return (
            <div className="card" key={name} style={{ marginBottom: 8, overflow: "hidden" }}>
              <div style={{ padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => toggle(name)}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--green-soft)", color: "var(--green)", display: "grid", placeItems: "center", fontWeight: 800 }}>{name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}</div>
                  <div><div className="main" style={{ fontWeight: 700 }}>{name}</div><div className="sub" style={{ color: "var(--green)" }}>Fully Paid · {cBills.length} bill{cBills.length === 1 ? "" : "s"}</div></div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="amt in" style={{ fontSize: 15 }}>{money(total)}</div>
                  <span style={{ color: "var(--faint)", transform: isOpen ? "rotate(180deg)" : undefined, transition: "transform .15s" }}><Icon name="chevronDown" size={18} /></span>
                </div>
              </div>
              {isOpen && (
                <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {cBills.map((b) => (
                    <div key={b.id} style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div><div style={{ fontWeight: 700, fontSize: 12.5 }}>{b.bill_no ? `Bill #${b.bill_no}` : "Udhaar bill"}</div><div className="sub">{dateStr(b.created_at)}</div></div>
                      <span className="badge paid">Paid</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }) : <div className="card card-pad"><div className="empty">No settled bills yet.</div></div>
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
// price = per-piece price (used for the pcs portion). boxPrice = independent
// box price (used for the box portion) — falls back to perBox × price when
// the product has no separately-set box price, so bulk-discount pricing is
// optional per product but never required.
type CartLine = CartItem & { box: number; pcs: number; perBox: number; unit: string; boxPrice: number };

function NewBillForm({ branchId, shared, branchName }: { branchId: string; shared: SharedProps; branchName: string }) {
  const products = productsForBranch(useLiveQuery(() => localdb.products.toArray(), [], []), branchId);
  const branchSales = useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []);
  const branchPurch = useLiveQuery(() => localdb.purchases.where("branch_id").equals(branchId).toArray(), [branchId], []);
  const customers = live(useLiveQuery(() => localdb.customers.where("branch_id").equals(branchId).toArray(), [branchId], []));

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
    const boxPrice = pr.box_price || (perBox ? perBox * pr.sale_price : 0);
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
        discountType: undefined, discountValue: 0, box: 0, pcs: 1, perBox, boxPrice, unit: pr.unit,
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
  // Line total = boxes at box rate + loose pieces at piece rate — independent
  // of qty×price, since a box can be priced below pieces_per_box×price.
  const lineAmount = (c: CartLine) => c.box * (c.boxPrice || (c.perBox ? c.perBox * c.price : 0)) + c.pcs * c.price;

  // Bill-level discount (applies as a single line at the bottom, matching
  // the reference design's "Discount: None ▾" under the totals, not per item).
  const [discType, setDiscType] = useState<DiscType>("none");
  const [discCustom, setDiscCustom] = useState(0);
  const [discFlat, setDiscFlat] = useState(0);
  const billDiscountType: "percent" | "flat" | undefined = discType === "flat" ? "flat" : discType === "none" ? undefined : "percent";
  const billDiscountValue = discType === "custom" ? discCustom : discType === "flat" ? discFlat : discType === "none" ? 0 : Number(discType);

  const subtotal = cart.reduce((a, c) => a + lineAmount(c), 0);
  const { lineTotal: cartTotal, discountAmt: billDiscountAmt } = computeLineTotal(1, subtotal, billDiscountType, billDiscountValue);

  // Payment
  const [payMode, setPayMode] = useState<"cash" | "upi" | "both" | "credit">("cash");
  const [cashAmt, setCashAmt] = useState<number | "">("");
  const [upiAmt, setUpiAmt] = useState<number | "">("");
  const [paidFull, setPaidFull] = useState(true);
  const [partialAmt, setPartialAmt] = useState<number | "">("");
  const [saving, setSaving] = useState(false);

  const today = rangeStart("today");
  const todayTotal = sum(forTotals(branchSales).filter((s) => new Date(s.created_at).getTime() >= today), "total");

  const amountPaidNow = payMode === "credit" ? 0
    : paidFull ? cartTotal
    : payMode === "both" ? (Number(cashAmt) || 0) + (Number(upiAmt) || 0)
    : Math.max(0, Number(partialAmt) || 0);
  const dueNow = Math.max(0, cartTotal - amountPaidNow);

  const save = async () => {
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
      const effBoxPrice = c.boxPrice || (c.perBox ? c.perBox * c.price : 0);
      const base: CartItem = {
        product_id: c.product_id, name: c.name, qty: c.qty, price: c.price,
        lineTotalOverride: lineAmount(c), boxQty: c.box, pcsQty: c.pcs, boxPrice: c.box > 0 ? effBoxPrice : undefined,
      };
      if (i !== 0 || !billDiscountAmt) return base;
      return { ...base, discountType: "flat", discountValue: billDiscountAmt };
    });

    const { billNo, due } = await createSaleBill(branchId, shared.profile.id, cust, {
      mode: payMode, amountPaid: amountPaidNow, cashAmount: finalCash, upiAmount: finalUpi,
    }, items);
    setSaving(false);
    toast(`Bill ${billNo} saved` + (due > 0 ? ` — ${money(due)} due` : "") + (shared.online ? "" : " offline"));
    setCart([]); setCust(""); setDiscType("none"); setDiscCustom(0); setDiscFlat(0);
    setPayMode("cash"); setCashAmt(""); setUpiAmt(""); setPaidFull(true); setPartialAmt(""); shared.onSync();
  };

  return (
    <>
      <div className="card card-pad">
        <div style={{ display: "flex", gap: 10 }}>
          <div className="field" style={{ position: "relative", marginBottom: 0, flex: 2 }}>
            <input value={cust} onChange={(e) => { setCust(e.target.value); setShowCustDd(true); }}
              onFocus={() => setShowCustDd(true)} onBlur={() => setTimeout(() => setShowCustDd(false), 150)}
              placeholder="Customer name or mobile" />
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
          <div className="field" style={{ marginBottom: 0, flex: 1 }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ position: "relative", marginBottom: 0, marginTop: 10 }}>
          <input ref={productInputRef} className="search" style={{ width: "100%" }} value={pq}
            onChange={(e) => { setPq(e.target.value); setShowPd(true); setPActive(0); }}
            onFocus={() => setShowPd(true)} onBlur={() => setTimeout(() => setShowPd(false), 150)}
            onKeyDown={onProductKeyDown}
            placeholder="🔍 Search product to add…" />
          {showPd && pMatches.length > 0 && (
            <div className="card" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, maxHeight: 280, overflowY: "auto", marginTop: 4 }}>
              {pMatches.map((pr, i) => (
                <div key={pr.id} className="row" style={{ padding: "10px 14px", cursor: "pointer", background: i === pActive ? "var(--surface-2)" : undefined }}
                  onMouseEnter={() => setPActive(i)} onMouseDown={() => addProduct(pr)}>
                  <div><div className="main">{pr.name}</div><div className="sub">{money(pr.sale_price)}/{pr.unit}{pr.pieces_per_box ? ` · box of ${pr.pieces_per_box} = ${money(pr.box_price || pr.pieces_per_box * pr.sale_price)}` : ""}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Added items */}
      {cart.length > 0 && (
        <h3 style={{ fontSize: 14, color: "var(--muted)", margin: "18px 0 8px" }}>Items ({cart.length})</h3>
      )}
      {cart.length ? cart.map((c, i) => {
        const lt = lineAmount(c);
        const effBoxPrice = c.boxPrice || (c.perBox ? c.perBox * c.price : 0);
        return (
          <div className="card card-pad" key={i} style={{ marginBottom: 10, boxShadow: "var(--shadow)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div className="main" style={{ fontWeight: 700 }}>{c.name}</div>
                <div className="sub">{money(c.price)}/pc{c.perBox ? ` · ${money(effBoxPrice)}/box (${c.perBox} pcs)` : ""}</div>
              </div>
              <button className="del-btn" style={{ background: "transparent", color: "var(--red)", width: 30, height: 30, flexShrink: 0 }} onClick={() => removeItem(i)}><Icon name="trash" size={16} /></button>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 10 }}>
              <div style={{ display: "flex", gap: 10 }}>
                {c.perBox > 0 && (
                  <div>
                    <label style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>BOX</label>
                    <div className="stepper sm" style={{ marginTop: 2 }}>
                      <button onClick={() => bump(i, "box", -1)}><Icon name="minus" size={12} /></button>
                      <span>{c.box}</span>
                      <button onClick={() => bump(i, "box", 1)}><Icon name="plus" size={12} /></button>
                    </div>
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>PCS</label>
                  <div className="stepper sm" style={{ marginTop: 2 }}>
                    <button onClick={() => bump(i, "pcs", -1)}><Icon name="minus" size={12} /></button>
                    <span>{c.pcs}</span>
                    <button onClick={() => bump(i, "pcs", 1)}><Icon name="plus" size={12} /></button>
                  </div>
                </div>
              </div>
              <b style={{ fontSize: 16, color: "var(--accent)", flexShrink: 0 }}>{money(lt)}</b>
            </div>
          </div>
        );
      }) : <div className="card card-pad"><div className="empty">No items yet. Search a product above to add it.</div></div>}

      {cart.length > 0 && (
        <>
          {/* Totals */}
          <div className="card card-pad" style={{ marginTop: 14, background: "var(--surface-3)", border: "none" }}>
            <div className="row" style={{ padding: "6px 0", borderBottom: "none" }}><span className="sub">Subtotal</span><b>{money(subtotal)}</b></div>
            <div className="row" style={{ padding: "6px 0", borderBottom: "none" }}>
              <span className="sub">Discount</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select value={discType} onChange={(e) => setDiscType(e.target.value as DiscType)} style={{ width: "auto", background: "transparent", border: "none", color: "var(--accent)", fontWeight: 600 }}>
                  <option value="none">No Discount</option>
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
              <b style={{ fontSize: 15 }}>Grand Total</b><b style={{ fontSize: 22, color: "var(--accent)" }}>{money(cartTotal)}</b>
            </div>
          </div>

          {/* Payment */}
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>Payment Mode</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
              {([["cash", "wallet", "Cash"], ["upi", "qr", "UPI"], ["both", "splitPay", "Split"], ["credit", "creditCard", "Credit"]] as const).map(([m, ic, label]) => (
                <button key={m} onClick={() => setPayMode(m)}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px 6px", borderRadius: 12,
                    border: payMode === m ? "2px solid var(--accent)" : "1px solid var(--line)",
                    background: payMode === m ? "var(--accent-soft)" : "var(--surface)", color: payMode === m ? "var(--accent)" : "var(--muted)" }}>
                  <Icon name={ic} size={19} /><span style={{ fontSize: 12, fontWeight: 700 }}>{label}</span>
                </button>
              ))}
            </div>

            <div className="card card-pad">
              {payMode !== "credit" && (
                <label className="row" style={{ padding: "4px 0", cursor: "pointer", borderBottom: "none" }}>
                  <span className="main" style={{ fontSize: 14 }}>Paid in full</span>
                  <input type="checkbox" checked={paidFull} onChange={(e) => setPaidFull(e.target.checked)} style={{ width: 22, height: 22 }} />
                </label>
              )}

              {payMode === "both" && (
                <div className="qty-row" style={{ marginTop: 8 }}>
                  <div className="field"><label>Cash ₹</label><input type="number" inputMode="numeric" value={cashAmt} onChange={(e) => setCashAmt(e.target.value === "" ? "" : +e.target.value)} /></div>
                  <div className="field"><label>UPI ₹</label><input type="number" inputMode="numeric" value={upiAmt} onChange={(e) => setUpiAmt(e.target.value === "" ? "" : +e.target.value)} /></div>
                </div>
              )}

              {payMode !== "credit" && !paidFull && payMode !== "both" && (
                <div className="field" style={{ marginTop: 8 }}><label>Amount received now (partial)</label>
                  <input type="number" inputMode="numeric" value={partialAmt} onChange={(e) => setPartialAmt(e.target.value === "" ? "" : +e.target.value)} placeholder="0" />
                </div>
              )}
              {payMode !== "credit" && !paidFull && payMode === "both" && (
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>Cash + UPI entered above is treated as the partial amount received now.</div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line)" }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Balance Due after bill</span>
                <b style={{ fontFamily: "monospace", fontSize: 14, color: dueNow > 0 ? "var(--red)" : "var(--green)" }}>{money(dueNow)}</b>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="btn-row" style={{ marginTop: 16, marginBottom: 4 }}>
        <button className="btn" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={save} disabled={saving || !cart.length}><Icon name="wallet" size={16} /> Save Bill</button>
      </div>
    </>
  );
}

/* Previous Bills — past sales for this branch, grouped by bill_no. */
type BillGroup = { billNo: string; items: any[]; total: number; customer: string; date: string; pay: string; voided: boolean };

function PreviousBills({ branchId, shared }: { branchId: string; shared: SharedProps; branchName?: string }) {
  // Voided bills stay visible (crossed out) — only true soft-deletes drop off screen.
  const sales = live(useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const [q, setQ] = useState("");
  const [view, setView] = useState<BillGroup | null>(null);
  const [editGroup, setEditGroup] = useState<BillGroup | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, BillGroup>();
    for (const s of sales) {
      const key = s.bill_no || s.id;
      if (!map.has(key)) map.set(key, { billNo: key, items: [], total: 0, customer: s.customer_name || "Walk-in", date: s.created_at, pay: s.payment_mode || "cash", voided: false });
      const g = map.get(key)!;
      g.items.push(s);
      if (s.void_at) g.voided = true; else g.total += s.total;
    }
    return [...map.values()]
      .filter((g) => g.billNo.toLowerCase().includes(q.toLowerCase()) || g.customer.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [sales, q]);

  const doVoid = async (g: BillGroup) => {
    if (!window.confirm(`Void bill ${g.billNo}? It stays visible (crossed out) but is removed from totals and the customer's due.`)) return;
    await voidSaleGroup(branchId, g.billNo);
    toast("Bill voided"); shared.onSync();
  };

  return (
    <>
      <div className="card">
        <div className="card-head"><h3>Previous bills</h3><input className="search" placeholder="Search bill # or customer…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="card-pad" style={{ paddingTop: 6 }}>
          {groups.length ? groups.map((g) => (
            <div className="row" key={g.billNo} style={{ opacity: g.voided ? .55 : 1, cursor: "pointer" }} onClick={() => setView(g)}>
              <div>
                <div className="main" style={{ textDecoration: g.voided ? "line-through" : undefined }}>
                  {g.billNo.startsWith(g.customer) ? g.billNo : `Bill #${g.billNo}`}
                  {g.voided && <span className="status-pill warn" style={{ marginLeft: 8, fontSize: 10 }}>VOID</span>}
                </div>
                <div className="sub">{g.customer} · {dateStr(g.date)} · {g.items.length} item{g.items.length === 1 ? "" : "s"} · {g.pay.toUpperCase()}</div>
              </div>
              <b style={{ textDecoration: g.voided ? "line-through" : undefined }}>{money(g.total)}</b>
            </div>
          )) : <div className="empty">No bills yet.</div>}
        </div>
      </div>

      {view && (
        <Modal title={view.billNo.startsWith(view.customer) ? view.billNo : `Bill #${view.billNo}`} onClose={() => setView(null)}>
          <div className="form-grid">
            {view.voided && <div style={{ background: "var(--red-soft)", color: "var(--red)", padding: "8px 12px", borderRadius: 10, fontSize: 13, fontWeight: 700 }}>This bill was voided — it no longer counts toward any totals or the customer's due.</div>}
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>{view.customer} · {dateStr(view.date)} · {view.pay.toUpperCase()}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {view.items.map((it: any) => (
                <div key={it.id} className="row" style={{ opacity: it.void_at ? .55 : 1 }}>
                  <div><div className="main" style={{ textDecoration: it.void_at ? "line-through" : undefined }}>{it.product_name}</div><div className="sub">{it.qty} × {money(it.price)}</div></div>
                  <b style={{ textDecoration: it.void_at ? "line-through" : undefined }}>{money(it.total)}</b>
                </div>
              ))}
            </div>
            <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}><b>Total</b><b style={{ color: "var(--accent)" }}>{money(view.total)}</b></div>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setView(null)}>Close</button>
              {!view.voided && <button className="btn" onClick={() => { setEditGroup(view); setView(null); }}>Edit</button>}
              {!view.voided && <button className="btn" style={{ background: "var(--red)" }} onClick={() => { doVoid(view); setView(null); }}>Void bill</button>}
            </div>
          </div>
        </Modal>
      )}

      {editGroup && <EditBillGroupModal group={editGroup} branchId={branchId} onClose={() => setEditGroup(null)} onSync={shared.onSync} />}
    </>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
        <div>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", fontWeight: 700 }}>Inventory Entry</span>
          <h1 className="page-title" style={{ fontSize: 24, margin: "2px 0 0" }}>New Purchase</h1>
        </div>
        <div style={{ background: "var(--accent-soft)", color: "var(--accent)", padding: "8px 14px", borderRadius: 12, textAlign: "right" }}>
          <div style={{ fontSize: 11, opacity: .85 }}>Computed Total</div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{money((qty || 0) * (cost || 0))}</div>
        </div>
      </div>
      <div className="card card-pad"><div className="form-grid">
        <div className="qty-row">
          <div className="field"><label>Supplier Name</label>
            <input list="sup-list" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Search supplier…" />
            <datalist id="sup-list">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div className="field"><label>Invoice #</label><input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="INV-0000" /></div>
        </div>
        <div className="field"><label>Product Picker</label>
          <select value={selected?.id ?? ""} onChange={(e) => { setPid(e.target.value); const pr = products.find((x) => x.id === e.target.value); if (pr) setCost(pr.cost_price); }}>
            {products.length ? products.map((pr) => <option key={pr.id} value={pr.id}>{pr.name} — cost {money(pr.cost_price)}</option>) : <option>No products — owner must add first</option>}
          </select>
        </div>
        <div className="qty-row">
          <div className="field"><label>Quantity</label>
            <div className="stepper">
              <button onClick={() => setQty((v) => Math.max(1, v - 1))}><Icon name="minus" size={15} /></button>
              <span>{qty}</span>
              <button onClick={() => setQty((v) => v + 1)}><Icon name="plus" size={15} /></button>
            </div>
          </div>
          <div className="field"><label>Cost per Unit</label><input type="number" inputMode="numeric" value={cost} onChange={(e) => setCost(+e.target.value)} /></div>
        </div>
        <div className="field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Payment Method</label>
          <div className="pay-select">
            {(["cash", "credit"] as const).map((m) => <button key={m} className={"pay-opt" + (pay === m ? " active" : "")} onClick={() => setPay(m)}>{m === "credit" ? "Credit" : "Cash"}</button>)}
          </div>
        </div>
        <div className="field"><label>Note (optional)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. damaged 2 pcs" /></div>
        <button className="btn" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={save}><Icon name="cart" size={17} /> Add Purchase Record</button>
      </div></div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 8px" }}>
        <h3 style={{ fontSize: 16, margin: 0 }}>Recent Purchases</h3>
        <span style={{ fontSize: 11, background: "var(--surface-4)", color: "var(--muted)", padding: "4px 10px", borderRadius: 999, fontWeight: 600 }}>Today: {money(todaySpend)}</span>
      </div>
      {allPurch.length ? allPurch.slice(0, 20).map((x) => (
        <div className="card card-pad" key={x.id} style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: "var(--surface-3)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon name="cart" size={18} /></div>
            <div><div className="main">{x.product_name}</div><div className="sub">{x.supplier || "—"} · {dateStr(x.created_at)}{x.invoice_no ? " · #" + x.invoice_no : ""}</div></div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ textAlign: "right" }}>
              <div className="amt out">{money(x.total)}</div>
              <div className="sub">{(x.payment_mode || "cash") === "credit" ? "CREDIT" : "PAID"}{x._synced === 0 ? " · ⏳" : ""}</div>
            </div>
            <button className="del-btn" onClick={() => delPurch(x.id)}><Icon name="trash" size={13} /></button>
          </div>
        </div>
      )) : <div className="card card-pad"><div className="empty">No purchases yet.</div></div>}
    </>
  );
}

/* ---------- Bills / Customers / Daybook ---------- */
/* Unpaid Bills — grouped by customer, due date per bill, per-bill and
 * per-customer "add payment" (per-customer auto-splits oldest-first across
 * that customer's unpaid bills, same as the Ledger's settle flow). */
function UnpaidBills({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const bills = live(useLiveQuery(() => localdb.bills.where("branch_id").equals(branchId).toArray(), [branchId], []))
    .filter((b) => b.status === "unpaid")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); // oldest first within each customer group
  const customers = live(useLiveQuery(() => localdb.customers.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const due = sum(bills, "due_amount");

  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState(""); const [amount, setAmount] = useState(0); const [paidNow, setPaidNow] = useState(0); const [dueDate, setDueDate] = useState("");
  const [payFor, setPayFor] = useState<BillT | null>(null); const [payAmt, setPayAmt] = useState(0);
  const [editBill, setEditBill] = useState<BillT | null>(null);
  const [settleFor, setSettleFor] = useState<string | null>(null); const [settleAmt, setSettleAmt] = useState<number | "">("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (n: string) => setExpanded((s) => { const nx = new Set(s); nx.has(n) ? nx.delete(n) : nx.add(n); return nx; });

  const groups = useMemo(() => {
    const map = new Map<string, BillT[]>();
    for (const b of bills) { const k = b.customer_name; if (!map.has(k)) map.set(k, []); map.get(k)!.push(b); }
    return [...map.entries()].map(([cust, list]) => ({ cust, list, total: sum(list, "due_amount") })).sort((a, b) => b.total - a.total);
  }, [bills]);

  const saveBill = async () => {
    if (!name.trim()) return toast("Enter customer name");
    if (!amount || amount <= 0) return toast("Enter bill amount");
    await addBill(branchId, name, Number(amount), Number(paidNow) || 0, dueDate || null);
    toast("Bill saved" + (shared.online ? "" : " offline"));
    setShowNew(false); setName(""); setAmount(0); setPaidNow(0); setDueDate(""); shared.onSync();
  };
  const savePay = async () => {
    if (!payFor) return;
    if (!payAmt || payAmt <= 0) return toast("Enter amount");
    await recordPayment(payFor, Number(payAmt));
    toast("Payment recorded" + (shared.online ? "" : " offline"));
    setPayFor(null); setPayAmt(0); shared.onSync();
  };
  const doSettle = async () => {
    if (!settleFor) return;
    const amt = Number(settleAmt) || 0;
    if (amt <= 0) return toast("Enter amount");
    const applied = await settleCustomerDues(branchId, settleFor, amt);
    toast(applied > 0 ? `${money(applied)} settled for ${settleFor}` : "No dues to settle");
    setSettleFor(null); setSettleAmt(""); shared.onSync();
  };
  const doVoid = async (b: BillT) => {
    if (!window.confirm(`Void this bill for ${b.customer_name}? It stays visible (crossed out) but is removed from totals and their due.`)) return;
    await voidBill(b); toast("Bill voided"); shared.onSync();
  };

  // Live allocation preview for the customer-level settle modal — same
  // oldest-first math as settleCustomerDues, run client-side just to show
  // "which bills this payment will clear" before confirming.
  const settleBills = settleFor ? (groups.find((g) => g.cust === settleFor)?.list ?? []) : [];
  const settlePreview = useMemo(() => {
    let left = Number(settleAmt) || 0;
    return settleBills.map((b) => { const applied = Math.min(left, b.due_amount); left -= applied; return { b, applied }; });
  }, [settleAmt, settleFor]);

  const exportStatement = () => downloadExcel("unpaid-bills", ["Customer", "Bill", "Date", "Amount", "Paid", "Due", "Due date"],
    bills.map((b) => [b.customer_name, b.bill_no || "Udhaar", dateStr(b.created_at), b.amount, b.paid, b.due_amount, b.due_date ? dateStr(b.due_date) : ""]));

  return (
    <>
      <div className="bento" style={{ marginBottom: 14 }}>
        <div className="glass-card" style={{ borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 88 }}>
          <span style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 5, fontWeight: 600 }}><Icon name="wallet" size={15} /> Total Due</span>
          <div><div style={{ fontSize: 20, fontWeight: 800, color: "var(--accent)" }}>{money(due)}</div></div>
        </div>
        <div className="glass-card" style={{ borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 88 }}>
          <span style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 5, fontWeight: 600 }}><Icon name="bill" size={15} /> Open Bills</span>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{bills.length}</div>
        </div>
      </div>

      <button className="edit-btn" style={{ marginBottom: 12 }} onClick={exportStatement}>Export statement</button>

      {groups.length ? groups.map((g) => {
        const isOpen = expanded.has(g.cust);
        return (
          <div className="card" key={g.cust} style={{ marginBottom: 10, overflow: "hidden" }}>
            <div style={{ padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => toggle(g.cust)}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--surface-4)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 800 }}>{g.cust.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}</div>
                <div><div className="main" style={{ fontWeight: 700 }}>{g.cust}</div><div className="sub">{g.list.length} bill{g.list.length === 1 ? "" : "s"} due</div></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="amt out" style={{ fontSize: 15 }}>{money(g.total)}</div>
                <button className="btn" style={{ width: "auto", padding: "8px 16px", borderRadius: 10, fontSize: 13 }} onClick={(e) => { e.stopPropagation(); setSettleFor(g.cust); setSettleAmt(g.total); }}>Pay</button>
                <span style={{ color: "var(--faint)", transform: isOpen ? "rotate(180deg)" : undefined, transition: "transform .15s" }}><Icon name="chevronDown" size={18} /></span>
              </div>
            </div>
            {isOpen && (
              <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                {g.list.map((b) => {
                  const overdue = b.due_date && new Date(b.due_date).getTime() < Date.now();
                  return (
                    <div key={b.id} className="card card-pad" style={{ background: "var(--surface-2)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div><div style={{ fontWeight: 700, fontSize: 13 }}>{b.bill_no ? `Bill #${b.bill_no}` : "Udhaar bill"}</div>
                          <div className="sub">{dateStr(b.created_at)}{b._synced === 0 ? " · ⏳" : ""}</div>
                          {b.due_date && <div className="sub" style={{ color: overdue ? "var(--red)" : "var(--muted)", fontWeight: overdue ? 700 : 400 }}>Due {dateStr(b.due_date)}{overdue ? " · overdue" : ""}</div>}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--muted)" }}>Paid / Total</div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{money(b.paid)} / {money(b.amount)}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
                        <span style={{ color: "var(--red)", fontWeight: 800, fontSize: 15 }}>{money(b.due_amount)}</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="icon-btn" style={{ background: "var(--surface)", width: 32, height: 32 }} onClick={() => setEditBill(b)}><Icon name="settings" size={14} /></button>
                          <button className="icon-btn" style={{ background: "var(--surface)", width: 32, height: 32, color: "var(--red)" }} onClick={() => doVoid(b)}><Icon name="close" size={14} /></button>
                          <button className="btn" style={{ width: "auto", padding: "7px 14px", borderRadius: 999, fontSize: 12.5 }} onClick={() => { setPayFor(b); setPayAmt(b.due_amount); }}>Pay</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      }) : <div className="card card-pad"><div className="empty">No unpaid bills. All clear!</div></div>}

      <button className="fab" onClick={() => setShowNew(true)}><Icon name="plus" size={18} /> New Bill</button>

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
            <div className="field"><label>Due date (optional)</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
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
      {settleFor && (
        <Modal title={`Pay — ${settleFor}`} onClose={() => setSettleFor(null)}>
          <div className="form-grid">
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>Outstanding: <b style={{ color: "var(--red)" }}>{money(sum(settleBills, "due_amount"))}</b></p>
            <div className="field"><label>Amount received</label><input type="number" inputMode="numeric" value={settleAmt} onChange={(e) => setSettleAmt(e.target.value === "" ? "" : +e.target.value)} /></div>
            {Number(settleAmt) > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="t-label">This payment will clear</div>
                {settlePreview.filter((x) => x.applied > 0).map(({ b, applied }) => (
                  <div key={b.id} className="row" style={{ padding: "6px 0" }}>
                    <span className="sub">{b.bill_no ? `Bill #${b.bill_no}` : "Udhaar bill"} (due {money(b.due_amount)})</span>
                    <b style={{ color: "var(--green)" }}>{money(applied)}</b>
                  </div>
                ))}
              </div>
            )}
            <div className="btn-row"><button className="btn ghost" onClick={() => setSettleFor(null)}>Cancel</button><button className="btn" onClick={doSettle}>Confirm payment</button></div>
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
  const [q, setQ] = useState("");
  const rows = cust.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || (c.phone || "").includes(q));
  const initials = (n: string) => n.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <>
      <div className="field" style={{ position: "relative", marginBottom: 14 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }}><Icon name="search" size={17} /></span>
        <input style={{ paddingLeft: 38, height: 48, borderRadius: 12 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers by name or phone…" />
      </div>
      <div className="bento" style={{ marginBottom: 16 }}>
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--muted)", fontWeight: 700 }}>Total Customers</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--accent)", marginTop: 4 }}>{cust.length}</div>
        </div>
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--muted)", fontWeight: 700 }}>Outstanding</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--red)", marginTop: 4 }}>{money(sum(cust, "balance_due"))}</div>
        </div>
      </div>

      {rows.length ? rows.map((c) => (
        <div className="card" key={c.id} style={{ marginBottom: 10, overflow: "hidden" }}>
          <div style={{ padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 46, height: 46, borderRadius: "50%", background: c.balance_due > 0 ? "var(--accent-soft)" : "var(--green-soft)", color: c.balance_due > 0 ? "var(--accent)" : "var(--green)", display: "grid", placeItems: "center", fontWeight: 800 }}>{initials(c.name)}</div>
              <div><div className="main" style={{ fontWeight: 700 }}>{c.name}</div><div className="sub">{c.phone || "—"}{c._synced === 0 ? " · ⏳" : ""}</div></div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className={"status-pill " + (c.balance_due > 0 ? "warn" : "ok")}>{c.balance_due > 0 ? money(c.balance_due) + " Due" : "Clear"}</span>
            </div>
          </div>
          <div style={{ padding: "0 14px 14px", display: "flex", gap: 8 }}>
            <button className="btn" style={{ flex: 1, padding: "9px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13.5, background: c.balance_due > 0 ? "var(--accent)" : "var(--surface-4)", color: c.balance_due > 0 ? "#fff" : "var(--muted)" }} onClick={() => setLedger(c.name)}>
              <Icon name="bill" size={15} /> Ledger
            </button>
            <button className="icon-btn" style={{ width: 40, height: 40, border: "1px solid var(--line)", borderRadius: 10 }} onClick={() => setEditC(c)}><Icon name="settings" size={16} /></button>
            {c.phone && <a className="icon-btn" style={{ width: 40, height: 40, border: "1px solid var(--line)", borderRadius: 10, textDecoration: "none" }} href={`tel:${c.phone}`}><Icon name="phone" size={16} /></a>}
            <button className="icon-btn" style={{ width: 40, height: 40, border: "1px solid var(--line)", borderRadius: 10, color: "var(--red)" }} onClick={() => delCust(c.id)}><Icon name="trash" size={16} /></button>
          </div>
        </div>
      )) : <div className="card card-pad"><div className="empty">No customers yet.</div></div>}

      <button className="fab round" onClick={() => setShow(true)}><Icon name="customers" size={22} /></button>

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
  const sales = forTotals(useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []));
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
  const net = inT - outP - outE;
  const icons: Record<string, string> = { sale: "bill", purchase: "cart", expense: "wallet" };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <div><h1 className="page-title" style={{ fontSize: 20, margin: 0 }}>Day Book</h1><p className="page-sub" style={{ margin: "2px 0 0" }}>Today, {dateStr(Date.now())}</p></div>
      </div>
      <div className="bento" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 16 }}>
        <div style={{ gridColumn: "1 / -1", background: "var(--accent)", color: "#fff", borderRadius: 14, padding: 18 }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".6px", opacity: .85, fontWeight: 700 }}>Net Balance</span>
          <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{money(net)}</div>
        </div>
        <div className="stat">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="label">Cash In</span>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--green-soft)", color: "var(--green)", display: "grid", placeItems: "center" }}><Icon name="plus" size={13} /></div>
          </div>
          <div className="value" style={{ color: "var(--green)", fontSize: 18, marginTop: 8 }}>{money(inT)}</div>
        </div>
        <div className="stat">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="label">Cash Out</span>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--red-soft)", color: "var(--red)", display: "grid", placeItems: "center" }}><Icon name="minus" size={13} /></div>
          </div>
          <div className="value" style={{ color: "var(--red)", fontSize: 18, marginTop: 8 }}>{money(outP + outE)}</div>
        </div>
      </div>

      <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", margin: "0 0 8px" }}>All Transactions</h3>
      {items.length ? items.map((i) => (
        <div className="card card-pad" key={i.id} style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "var(--surface-3)", color: i.dir === "in" ? "var(--accent)" : "var(--amber)", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Icon name={icons[i.what] || "bill"} size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div className="main" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.label}</div>
              <b style={{ color: i.dir === "in" ? "var(--green)" : "var(--red)", flexShrink: 0 }}>{i.dir === "in" ? "+" : "−"}{money(i.amt)}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              <span className="sub">{dateStr(i.t)} · {timeStr(i.t)}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="edit-btn" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setEditRow({ table: i.table, row: i.row })}>Edit</button>
                <button className="del-btn" style={{ width: 22, height: 22 }} onClick={() => delItem(i.table, i.id, i.what)}><Icon name="trash" size={11} /></button>
              </div>
            </div>
          </div>
        </div>
      )) : <div className="card card-pad"><div className="empty">No entries.</div></div>}

      <button className="fab round" style={{ background: "var(--red)" }} onClick={() => setShow(true)}><Icon name="plus" size={22} /></button>

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
