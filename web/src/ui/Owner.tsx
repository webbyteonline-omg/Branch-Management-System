import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localdb, pendingCount } from "../lib/db";
import { Icon } from "../lib/icons";
import { money, dateStr, timeStr, initials, rangeStart, prevRange, rangeLabel, pctDelta } from "../lib/format";
import type { Range, Product, Settings } from "../lib/types";
import { sum, topItems, shortBranch, live, deletedOnly, computeStock, forTotals, type SharedProps } from "./shared";
import { Modal } from "./Modal";
import { toast } from "./Toast";
import { ChangePasswordModal, ResetStaffPassword, StaffManager } from "./Account";
import { saveProduct, softDelete, restoreRow, saveSettings, addStockAdjustment } from "../lib/writes";
import { LedgerModal } from "./Ledger";
import { EditCustomerModal, EditEntryModal } from "./Edits";
import { downloadExcel } from "../lib/excel";
import { supabase } from "../lib/supabase";
import { BarChart, Donut } from "./Charts";
import { AddCustomerModal, AddExpenseModal, AddPurchaseModal } from "./OwnerAdd";
import { SyncStatusModal } from "./SyncStatus";

type View = "dashboard" | "branch" | "customers" | "ledger" | "purchases" | "inventory" | "products" | "saleshistory" | "daybook" | "reports" | "settings";
type ORange = Range | "custom";
const between = (rows: any[], from: number, to: number) => rows.filter((r) => { const t = new Date(r.created_at).getTime(); return t >= from && t <= to; });
const inRange = (rows: any[], from: number) => rows.filter((r) => new Date(r.created_at).getTime() >= from);
const confirmDelete = (what: string) => window.confirm(`Delete this ${what}? It moves to deleted items and can be restored.`);

// Owner app is desktop-first, but on a phone (or the app's own mobile
// drawer breakpoint) several screens swap their table layout for the
// card-based mobile layout used throughout the Staff app.
function useIsMobile(breakpoint = 900) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= breakpoint);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return isMobile;
}

function last14Days(sales: any[]) {
  const days: { label: string; value: number }[] = [];
  const now = new Date(); now.setHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) {
    const start = now.getTime() - i * 86400000;
    const end = start + 86400000;
    const val = sales.filter((s) => { const t = new Date(s.created_at).getTime(); return t >= start && t < end; }).reduce((a, s) => a + s.total, 0);
    days.push({ label: new Date(start).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), value: val });
  }
  return days;
}

export function Owner(p: SharedProps) {
  const isMobile = useIsMobile();
  const [range, setRange] = useState<ORange>("today");
  const [cFrom, setCFrom] = useState(new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [cTo, setCTo] = useState(new Date().toISOString().slice(0, 10));
  const [view, setView] = useState<View>("dashboard");
  const [branchId, setBranchId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showSync, setShowSync] = useState(false);

  const branches = useLiveQuery(() => localdb.branches.toArray(), [], []);
  const salesAll = useLiveQuery(() => localdb.sales.toArray(), [], []);
  const purchAll = useLiveQuery(() => localdb.purchases.toArray(), [], []);
  const billsAll = useLiveQuery(() => localdb.bills.toArray(), [], []);
  const custAll = useLiveQuery(() => localdb.customers.toArray(), [], []);
  const prodAll = useLiveQuery(() => localdb.products.toArray(), [], []);
  const expAll = useLiveQuery(() => localdb.expenses.toArray(), [], []);
  const settings = useLiveQuery(() => localdb.settings.get("main"), [], undefined);
  const pending = useLiveQuery(() => pendingCount(), [], 0) ?? 0;
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});
  useEffect(() => { supabase.from("profiles").select("id,name").then(({ data }) => { if (data) setStaffMap(Object.fromEntries(data.map((u: any) => [u.id, u.name]))); }); }, []);

  const isCustom = range === "custom";
  const from = isCustom ? new Date(cFrom).setHours(0, 0, 0, 0) : rangeStart(range as Range);
  const to = isCustom ? new Date(cTo).setHours(23, 59, 59, 999) : 8640000000000000;
  const rangeText = isCustom ? `${dateStr(from)} – ${dateStr(to)}` : rangeLabel(range as Range);
  const sales = useMemo(() => live(salesAll), [salesAll]);
  const purchases = useMemo(() => live(purchAll), [purchAll]);
  const bills = useMemo(() => live(billsAll), [billsAll]);
  const expenses = useMemo(() => live(expAll), [expAll]);
  const products = useMemo(() => live(prodAll), [prodAll]);
  const rSales = useMemo(() => between(sales, from, to), [sales, from, to]);
  const rPurch = useMemo(() => between(purchases, from, to), [purchases, from, to]);
  const rExp = useMemo(() => between(expenses, from, to), [expenses, from, to]);
  // "Totals-safe" variants: same as sales/bills but voided rows stripped out —
  // use these for any sum/KPI/chart. Use the plain sales/bills/rSales for
  // screens that need to keep voided rows visible (crossed out) like Sales
  // History / Previous Bills, doing their own per-row exclusion when summing.
  const salesT = useMemo(() => forTotals(salesAll), [salesAll]);
  const billsT = useMemo(() => forTotals(billsAll), [billsAll]);
  const rSalesT = useMemo(() => between(salesT, from, to), [salesT, from, to]);
  const bmap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, shortBranch(b.name)])), [branches]);
  const go = (v: View, b: string | null = null) => { setView(v); setBranchId(b); setOpen(false); };

  const navItems: [string, string, string][] = [
    ["dashboard", "Dashboard", "dashboard"],
    ["branch:seppa", "Seppa Branch", "branch"],
    ["branch:dirang", "Dirang Branch", "pin"],
    ["saleshistory", "Sell / Bills", "sales"],
    ["purchases", "Purchases", "cart"],
    ["ledger", "Ledger", "book"],
    ["customers", "Customers", "customers"],
    ["inventory", "Stock", "reports"],
    ["products", "Products", "bill"],
    ["daybook", "Day Book", "day"],
    ["reports", "Reports", "reports"],
    ["settings", "Settings", "settings"],
  ];
  const activeKey = view === "branch" ? "branch:" + branchId : view;

  return (
    <div className="shell">
      <aside className={"sidebar pt-sidebar" + (open ? " open" : "")}>
        <div className="brand-pt"><b>{settings?.company || "ProTrade POS"}</b><span>Admin Dashboard</span></div>
        <nav className="pt-nav">
          {navItems.map(([key, label, ic], i) => (
            <button key={key} className={"pt-nav-item" + (activeKey === key ? " active" : "")}
              onClick={() => key.startsWith("branch:") ? go("branch", key.split(":")[1]) : go(key as View)}>
              <Icon name={ic} size={19} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="pt-nav-foot">
          <div className="avatar" style={{ width: 34, height: 34, fontSize: 12 }}>{initials(p.profile.name)}</div>
          <div><b>{p.profile.name}</b><span>{p.profile.role === "owner" ? "Owner" : "Staff"}</span></div>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main pt-main">
        <div className="header pt-header">
          <div className="pt-header-search hide-mobile">
            <Icon name="search" size={17} />
            <input placeholder="Search orders, stock, or customers…" />
          </div>
          <button className="hbtn hide-desktop" onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <div className="header-right">
            <button className={"sync-pill " + (p.syncError ? "pending" : pending > 0 ? "pending" : "ok")} style={{ border: "none" }} onClick={() => setShowSync(true)} title="Sync status">
              <span className="dot" /><span className="hide-mobile">{p.syncError ? "Sync error" : pending > 0 ? `${pending} to sync` : "All synced"}</span>
            </button>
            <button className={"net-toggle " + (p.online ? "online" : "offline")} onClick={p.onToggleOnline}><span className="hide-mobile">{p.online ? "Online" : "Offline"}</span><span className="show-mobile-inline"><Icon name={p.online ? "cloud" : "warning"} size={15} /></span></button>
            <button className="btn" style={{ width: "auto", padding: "9px 14px", borderRadius: 999, flexShrink: 0 }} onClick={p.onLogout}>Logout</button>
          </div>
        </div>

        <div className="content pt-content">
          <div className="pt-content-head">
            <div>
              <h2 className="pt-page-title">{
                { dashboard: "Global Overview", branch: "Branch Detail", customers: "Customers", ledger: "Ledger",
                  purchases: "Purchase Register", inventory: "Stock & Inventory", products: "Products",
                  saleshistory: "Sales History", daybook: "Day Book", reports: "Reports", settings: "Settings" }[view]
              }</h2>
              <p className="pt-page-sub">{view === "dashboard" ? "Aggregated data from all operational branches" : rangeText}</p>
            </div>
            <div className="seg">
              {(["today", "week", "month"] as Range[]).map((r) => (
                <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>{rangeLabel(r)}</button>
              ))}
              <button className={isCustom ? "active" : ""} onClick={() => setRange("custom")}>Custom</button>
            </div>
            {isCustom && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input className="search" style={{ width: "auto" }} type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} />
                <span style={{ color: "var(--muted)" }}>–</span>
                <input className="search" style={{ width: "auto" }} type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} />
              </div>
            )}
          </div>
          {view === "dashboard" && <Dashboard {...{ range, isCustom, label: rangeText, branches, rSales: rSalesT, rPurch, rExp, bills: billsT, sales: salesT, purchases, products, bmap, go, isMobile }} />}
          {view === "branch" && branchId && <BranchDetail {...{ range: rangeText, branchId, branches, rSales: rSalesT, rPurch, rExp, bills: billsT, bmap, go, onSync: p.onSync, isMobile }} />}
          {view === "customers" && <CustomersPage custAll={custAll} bmap={bmap} branches={branches} onSync={p.onSync} />}
          {view === "ledger" && <LedgerPage custAll={custAll} bmap={bmap} onSync={p.onSync} isMobile={isMobile} />}
          {view === "purchases" && <PurchasesPage rPurch={rPurch} purchAll={purchAll} bmap={bmap} label={rangeText} branches={branches} products={products} userId={p.profile.id} onSync={p.onSync} isMobile={isMobile} />}
          {view === "inventory" && <InventoryPage products={products} sales={sales} purchases={purchases} branches={branches} userId={p.profile.id} onSync={p.onSync} isMobile={isMobile} />}
          {view === "products" && <ProductsPage prodAll={prodAll} online={p.online} branches={branches} onSync={p.onSync} />}
          {view === "saleshistory" && <SalesHistoryPage sales={rSales} bmap={bmap} branches={branches} staffMap={staffMap} isMobile={isMobile} />}
          {view === "daybook" && <DaybookPage rSales={rSalesT} rPurch={rPurch} rExp={rExp} bmap={bmap} range={rangeText} branches={branches} userId={p.profile.id} onSync={p.onSync} />}
          {view === "reports" && <ReportsPage rSales={rSalesT} range={rangeText} staffMap={staffMap} />}
          {view === "settings" && <SettingsPage settings={settings} onSync={p.onSync} branches={branches} />}
        </div>
      </div>
    </div>
  );
}

/* ---------- dashboard ---------- */
function Dashboard({ range, isCustom, label, branches, rSales, rPurch, rExp, bills, sales, purchases, products, bmap, go, isMobile }: any) {
  const openBills = bills.filter((b: any) => b.status === "unpaid");
  const totalDue = sum(openBills, "due_amount");
  const custNames = new Set(rSales.map((s: any) => s.customer_name).filter((n: string) => n && n !== "Walk-in"));
  const pr = isCustom ? null : prevRange(range);
  const pSales = pr ? sales.filter((s: any) => { const t = new Date(s.created_at).getTime(); return t >= pr.from && t < pr.to; }) : [];
  const pPurch = pr ? purchases.filter((s: any) => { const t = new Date(s.created_at).getTime(); return t >= pr.from && t < pr.to; }) : [];
  const dS = pr ? pctDelta(sum(rSales, "total"), sum(pSales, "total")) : { cls: "flat", txt: "selected period" };
  const dP = pr ? pctDelta(sum(rPurch, "total"), sum(pPurch, "total")) : { cls: "flat", txt: "selected period" };
  const paySplit = {
    cash: sum(rSales.filter((s: any) => (s.payment_mode || "cash") === "cash"), "total"),
    upi: sum(rSales.filter((s: any) => s.payment_mode === "upi"), "total"),
    credit: sum(rSales.filter((s: any) => s.payment_mode === "credit"), "total"),
  };

  if (isMobile) {
    const realBranches = branches.filter((b: any) => b.id !== "ho");
    const recent = [
      ...rSales.map((s: any) => ({ t: s.created_at, br: s.branch_id, amt: s.total, synced: s._synced })),
    ].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime()).slice(0, 5);
    return (
      <>
        <div className="m-stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="stat"><div className="label">Total Sales</div><div className="value" style={{ fontSize: 19, color: "var(--accent)" }}>{money(sum(rSales, "total"))}</div>
            <div className={"delta " + dS.cls}>{dS.txt}</div></div>
          <div className="stat"><div className="label">Unpaid Bills</div><div className="value" style={{ fontSize: 19 }}>{openBills.length}</div>
            <div className="delta down">{money(totalDue)} due</div></div>
          <div className="stat"><div className="label">Purchases</div><div className="value" style={{ fontSize: 19 }}>{money(sum(rPurch, "total"))}</div>
            <div className={"delta " + dP.cls}>{dP.txt}</div></div>
          <div className="stat"><div className="label">Customers</div><div className="value" style={{ fontSize: 19 }}>{custNames.size}</div>
            <div className="delta up">active this period</div></div>
        </div>

        <div className="card card-pad" style={{ marginTop: 14 }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Sales trend</h3>
          <BarChart data={last14Days(sales)} color="var(--accent)" />
        </div>

        <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", margin: "18px 0 8px" }}>Branch Performance</h3>
        {realBranches.map((b: any) => {
          const bs = rSales.filter((s: any) => s.branch_id === b.id);
          const tops = topItems(bs);
          return (
            <div key={b.id} className="card card-pad" style={{ marginBottom: 10 }} onClick={() => go("branch", b.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="main" style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}><span className="status-dot" />{shortBranch(b.name)}</div>
                <b style={{ color: "var(--green)" }}>{money(sum(bs, "total"))}</b>
              </div>
              <div className="sub" style={{ marginTop: 4 }}>Top: {tops[0] || "No sales yet"}</div>
            </div>
          );
        })}

        <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", margin: "18px 0 8px" }}>Recent Transactions</h3>
        {recent.length ? recent.map((r, i) => (
          <div className="row" key={i} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", marginBottom: 6 }}>
            <div><div className="main">{bmap[r.br] || r.br}</div><div className="sub">{timeStr(r.t)}</div></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <b>{money(r.amt)}</b>
              <span className={"badge " + (r.synced === 0 ? "unpaid" : "done")}>{r.synced === 0 ? "Pending" : "Synced"}</span>
            </div>
          </div>
        )) : <div className="card card-pad"><div className="empty">No transactions yet.</div></div>}
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">Head Office Overview</h1>
      <p className="page-sub">Aggregated data across both branches for {String(label).toLowerCase()}.</p>

      <div className="kpi-grid">
        <Kpi label="Total Sales" value={money(sum(rSales, "total"))} delta={dS} icon="sales" color="var(--accent)" bg="var(--accent-soft)" />
        <Kpi label="Unpaid Bills" value={money(totalDue)} delta={{ cls: "down", txt: openBills.length + " open" }} icon="bill" color="var(--red)" bg="var(--red-soft)" />
        <Kpi label="Purchases + Expenses" value={money(sum(rPurch, "total") + sum(rExp, "amount"))} delta={dP} icon="cart" color="var(--amber)" bg="var(--amber-soft, #fff3d9)" />
        <Kpi label="Active Customers" value={String(custNames.size)} delta={{ cls: "up", txt: "this period" }} icon="customers" color="var(--green)" bg="var(--green-soft)" />
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Sales — last 14 days</h3>
          <BarChart data={last14Days(sales)} color="var(--accent)" />
        </div>
        <div className="card card-pad">
          <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Payment split · {String(label).toLowerCase()}</h3>
          <Donut rows={[
            { label: "Cash", value: paySplit.cash, color: "#059669" },
            { label: "UPI", value: paySplit.upi, color: "#4f46e5" },
            { label: "Credit", value: paySplit.credit, color: "#d97706" },
          ]} />
        </div>
      </div>

      <h4 style={{ margin: "22px 0 12px", fontSize: 16, fontWeight: 700 }}>Branch Performance</h4>
      <div className="grid-2">
        {branches.filter((b: any) => b.id !== "ho").map((b: any) => {
          const bs = rSales.filter((s: any) => s.branch_id === b.id);
          const tops = topItems(bs);
          return (
            <div className="branch-card" key={b.id}>
              <div className="thumb"><Icon name="branch" size={30} /></div>
              <div className="bc-body">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{b.name}</h3>
                  <span className="online-pill">Online</span>
                </div>
                <div className="branch-metrics">
                  <div className="metric"><div className="m-label">Sales · {label}</div><div className="m-value green">{money(sum(bs, "total"))}</div></div>
                  <div className="metric"><div className="m-label">Active staff</div><div className="m-value">{b.active_staff}</div></div>
                </div>
                <div className="topitems">
                  <div className="t-label">Top selling items</div>
                  <div className="chips">
                    {tops.length ? tops.map((t, i) => <span className="chip" key={t}><span className="rank">{i + 1}</span>{t}</span>) : <span className="chip">No sales yet</span>}
                  </div>
                </div>
                <button className="link" style={{ marginTop: 10 }} onClick={() => go("branch", b.id)}>View details →</button>
              </div>
            </div>
          );
        })}
      </div>
      <TxnTable rSales={rSales} rPurch={rPurch} bmap={bmap} />
    </>
  );
}

function Kpi({ label, value, delta, icon, color, bg }: { label: string; value: string; delta: { cls: string; txt: string }; icon: string; color: string; bg: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <div className="kpi-ic" style={{ background: bg, color }}><Icon name={icon} size={19} /></div>
        <span className={"kpi-badge " + delta.cls}>{delta.txt}</span>
      </div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function Stat({ label, value, delta, icon }: { label: string; value: string; delta: { cls: string; txt: string }; icon: string }) {
  return (
    <div className="stat">
      <div className="ic"><Icon name={icon} size={20} /></div>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className={"delta " + delta.cls}>{delta.txt}</div>
    </div>
  );
}

function TxnTable({ rSales, rPurch, bmap }: any) {
  const [q, setQ] = useState("");
  let rows = [
    ...rSales.map((s: any) => ({ t: s.created_at, br: s.branch_id, type: s.payment_mode ? `Sale · ${String(s.payment_mode).toUpperCase()}` : "Sale", who: s.customer_name || "Walk-in", amt: s.total, dir: "in", synced: s._synced })),
    ...rPurch.map((x: any) => ({ t: x.created_at, br: x.branch_id, type: "Purchase", who: x.supplier || "—", amt: x.total, dir: "out", synced: x._synced })),
  ].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime());
  if (q.trim()) rows = rows.filter((r) => (r.who + r.type + (bmap[r.br] || "")).toLowerCase().includes(q.toLowerCase()));
  rows = rows.slice(0, 12);
  return (
    <div className="card">
      <div className="card-head"><h3>Recent Transactions — Both Branches</h3>
        <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Branch</th><th>Type</th><th>Customer / Supplier</th><th className="r">Amount</th><th className="r">Status</th><th className="r">Sync</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((r, i) => (
              <tr key={i}>
                <td>{timeStr(r.t)}<div style={{ color: "var(--faint)", fontSize: 11 }}>{dateStr(r.t)}</div></td>
                <td><span className="b-tag">{bmap[r.br] || r.br}</span></td>
                <td>{r.type}</td>
                <td>{r.who}</td>
                <td className={"r amt " + r.dir}>{r.dir === "in" ? "+" : "−"}{money(r.amt)}</td>
                <td className="r"><span className={"badge " + (r.dir === "in" ? "paid" : "role")}>{r.dir === "in" ? "Paid" : "Purchase"}</span></td>
                <td className="r" style={{ color: r.synced === 0 ? "var(--amber)" : "var(--green)" }}>
                  <Icon name={r.synced === 0 ? "sync" : "cloud"} size={16} />
                </td>
              </tr>
            )) : <tr><td colSpan={7}><div className="empty">No transactions.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- branch detail ---------- */
function BranchDetail({ range, branchId, branches, rSales, rPurch, rExp, bills, bmap, go, onSync, isMobile }: any) {
  const b = branches.find((x: any) => x.id === branchId);
  const bs = rSales.filter((s: any) => s.branch_id === branchId);
  const bp = rPurch.filter((s: any) => s.branch_id === branchId);
  const be = rExp.filter((s: any) => s.branch_id === branchId);
  const due = sum(bills.filter((x: any) => x.branch_id === branchId && x.status === "unpaid"), "due_amount");
  const del = async (table: any, id: string, what: string) => { if (confirmDelete(what)) { await softDelete(table, id); toast("Deleted"); onSync(); } };
  const items = [
    ...bs.map((s: any) => ({ id: s.id, table: "sales", t: s.created_at, label: `Sale · ${s.product_name} × ${s.qty}`, who: s.customer_name, amt: s.total, dir: "in", what: "sale" })),
    ...bp.map((x: any) => ({ id: x.id, table: "purchases", t: x.created_at, label: `Purchase · ${x.product_name} × ${x.qty}`, who: x.supplier, amt: x.total, dir: "out", what: "purchase" })),
    ...be.map((x: any) => ({ id: x.id, table: "expenses", t: x.created_at, label: `Expense · ${x.category}${x.note ? " (" + x.note + ")" : ""}`, who: "", amt: x.amount, dir: "out", what: "expense" })),
  ].sort((a, b2) => new Date(b2.t).getTime() - new Date(a.t).getTime()).slice(0, 60);
  const [q, setQ] = useState("");
  const filtered = q.trim() ? items.filter((i) => (i.label + i.who).toLowerCase().includes(q.toLowerCase())) : items;
  if (!b) return <div className="empty">Branch not found.</div>;

  if (isMobile) {
    return (
      <>
        <button className="back" onClick={() => go("dashboard")}>‹ Back</button>
        <h1 className="page-title" style={{ fontSize: 20 }}>{b.name}</h1>
        <div className="m-stats" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 10 }}>
          <div className="stat"><div className="label">Sales</div><div className="value" style={{ color: "var(--green)", fontSize: 18 }}>{money(sum(bs, "total"))}</div></div>
          <div className="stat"><div className="label">Purchases</div><div className="value" style={{ fontSize: 18 }}>{money(sum(bp, "total"))}</div></div>
          <div className="stat"><div className="label">Expenses</div><div className="value" style={{ color: "var(--red)", fontSize: 18 }}>{money(sum(be, "amount"))}</div></div>
          <div className="stat"><div className="label">Unpaid dues</div><div className="value" style={{ color: "var(--red)", fontSize: 18 }}>{money(due)}</div></div>
        </div>
        <h3 style={{ fontSize: 15, margin: "18px 0 8px" }}>Day Book</h3>
        <input className="search" style={{ width: "100%", marginBottom: 10 }} placeholder="Search transactions…" value={q} onChange={(e) => setQ(e.target.value)} />
        {filtered.length ? filtered.map((i) => (
          <div className="card card-pad" key={i.id} style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div><div className="main">{i.label}</div><div className="sub">{i.who ? i.who + " · " : ""}{timeStr(i.t)}</div></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <b className={"amt " + i.dir}>{i.dir === "in" ? "+" : "−"}{money(i.amt)}</b>
              <button className="del-btn" onClick={() => del(i.table, i.id, i.what)}><Icon name="trash" size={13} /></button>
            </div>
          </div>
        )) : <div className="card card-pad"><div className="empty">No entries.</div></div>}
      </>
    );
  }

  return (
    <>
      <button className="back" onClick={() => go("dashboard")}>‹ Back to overview</button>
      <h1 className="page-title">{b.name}</h1>
      <p className="page-sub">{b.location} · {rangeLabel(range).toLowerCase()}</p>
      <div className="kpi-grid">
        <Kpi label="Sales" value={money(sum(bs, "total"))} delta={{ cls: "up", txt: bs.length + " orders" }} icon="sales" color="var(--green)" bg="var(--green-soft)" />
        <Kpi label="Purchases" value={money(sum(bp, "total"))} delta={{ cls: "down", txt: bp.length + " entries" }} icon="cart" color="var(--accent)" bg="var(--accent-soft)" />
        <Kpi label="Expenses" value={money(sum(be, "amount"))} delta={{ cls: "down", txt: be.length + " entries" }} icon="wallet" color="var(--red)" bg="var(--red-soft)" />
        <Kpi label="Unpaid dues" value={money(due)} delta={{ cls: "down", txt: "outstanding" }} icon="bill" color="var(--amber)" bg="var(--amber-soft)" />
      </div>
      <div className="card">
        <div className="card-head"><h3>Day Book — money in & out</h3></div>
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Detail</th><th>Party</th><th className="r">Amount</th><th className="r"></th></tr></thead>
          <tbody>
            {items.length ? items.map((i: any) => (
              <tr key={i.id}><td>{dateStr(i.t)} {timeStr(i.t)}</td><td>{i.label}</td><td>{i.who}</td>
                <td className={"r amt " + i.dir}>{i.dir === "in" ? "+" : "−"}{money(i.amt)}</td>
                <td className="r"><button className="del-btn" title="Delete" onClick={() => del(i.table, i.id, i.what)}>✕</button></td></tr>
            )) : <tr><td colSpan={5}><div className="empty">No entries.</div></td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

/* ---------- customers ---------- */
function CustomersPage({ custAll, bmap, branches, onSync }: any) {
  const [showDeleted, setShowDeleted] = useState(false);
  const [q, setQ] = useState("");
  const [ledger, setLedger] = useState<{ branchId: string; name: string } | null>(null);
  const [editC, setEditC] = useState<any>(null);
  const [addC, setAddC] = useState(false);
  let rows = showDeleted ? deletedOnly(custAll) : live(custAll);
  if (q.trim()) rows = rows.filter((c: any) => (c.name + (c.phone || "")).toLowerCase().includes(q.toLowerCase()));
  const exportCsv = () => downloadExcel("customers", ["Name", "Phone", "Branch", "Balance due"], rows.map((c: any) => [c.name, c.phone || "", bmap[c.branch_id] || "", c.balance_due]));
  const act = async (c: any) => {
    if (showDeleted) { await restoreRow("customers", c.id); toast("Restored"); }
    else if (confirmDelete("customer")) { await softDelete("customers", c.id); toast("Deleted"); }
    onSync();
  };
  return (
    <><h1 className="page-title">Customers</h1><p className="page-sub">All customers across both branches.</p>
      <div className="card">
        <div className="card-head">
          <h3>{rows.length} {showDeleted ? "deleted" : "customer" + (rows.length === 1 ? "" : "s")}</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="edit-btn" onClick={exportCsv}>Export Excel</button>
            <button className="edit-btn" onClick={() => setShowDeleted((v) => !v)}>{showDeleted ? "← Active" : "Deleted"}</button>
            {!showDeleted && <button className="add-btn" onClick={() => setAddC(true)}>+ Add customer</button>}
          </div>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Phone</th><th>Branch</th><th className="r">Balance due</th><th className="r"></th></tr></thead>
          <tbody>{rows.length ? rows.map((c: any) => (
            <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td><span className="b-tag">{bmap[c.branch_id]}</span></td>
              <td className={"r amt " + (c.balance_due > 0 ? "out" : "in")}>{c.balance_due > 0 ? money(c.balance_due) : "Clear"}</td>
              <td className="r" style={{ whiteSpace: "nowrap" }}>
                {!showDeleted && <><button className="edit-btn" onClick={() => setLedger({ branchId: c.branch_id, name: c.name })}>Ledger</button>{" "}
                <button className="edit-btn" onClick={() => setEditC(c)}>Edit</button>{" "}</>}
                <button className={showDeleted ? "pay-btn" : "del-btn"} onClick={() => act(c)}>{showDeleted ? "Restore" : "✕"}</button></td></tr>
          )) : <tr><td colSpan={5}><div className="empty">Nothing here.</div></td></tr>}</tbody>
        </table></div>
      </div>
      {ledger && <LedgerModal branchId={ledger.branchId} name={ledger.name} onClose={() => setLedger(null)} onSync={onSync} />}
      {editC && <EditCustomerModal customer={editC} onClose={() => setEditC(null)} onSync={onSync} />}
      {addC && <AddCustomerModal branches={branches} onClose={() => setAddC(false)} onSync={onSync} />}</>
  );
}

/* ---------- ledger (all customers, head-office wide) ---------- */
function LedgerPage({ custAll, bmap, onSync, isMobile }: any) {
  const [q, setQ] = useState("");
  const [ledger, setLedger] = useState<{ branchId: string; name: string } | null>(null);
  let rows = live(custAll);
  if (q.trim()) rows = rows.filter((c: any) => (c.name + (c.phone || "")).toLowerCase().includes(q.toLowerCase()));
  rows = [...rows].sort((a: any, b: any) => b.balance_due - a.balance_due);
  const totalDue = sum(rows as any[], "balance_due" as any);
  const withDue = rows.filter((c: any) => c.balance_due > 0).length;
  const initials2 = (n: string) => n.split(" ").map((s: string) => s[0]).slice(0, 2).join("").toUpperCase();

  if (isMobile) {
    return (
      <>
        <h1 className="page-title" style={{ fontSize: 20 }}>Master Ledger</h1>
        <div className="bento" style={{ marginBottom: 14 }}>
          <div className="stat"><div className="label">Total Customers</div><div className="value" style={{ fontSize: 19 }}>{rows.length}</div></div>
          <div className="stat"><div className="label">Total Outstanding</div><div className="value" style={{ fontSize: 19, color: totalDue > 0 ? "var(--red)" : "var(--green)" }}>{money(totalDue)}</div></div>
        </div>
        <input className="search" style={{ width: "100%", marginBottom: 14 }} placeholder="Search customers by name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ fontSize: 15, margin: 0 }}>Customer Balances</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{withDue} with dues</span>
        </div>
        {rows.length ? rows.map((c: any) => (
          <div key={c.id} className="card card-pad" style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
            onClick={() => setLedger({ branchId: c.branch_id, name: c.name })}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", background: c.balance_due > 0 ? "var(--accent-soft)" : "var(--surface-4)", color: c.balance_due > 0 ? "var(--accent)" : "var(--muted)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13 }}>{initials2(c.name)}</div>
              <div><div className="main" style={{ fontWeight: 700 }}>{c.name}</div><div className="sub">{c.phone || "—"} · {bmap[c.branch_id]}</div></div>
            </div>
            <b className={c.balance_due > 0 ? "amt out" : "amt in"}>{c.balance_due > 0 ? money(c.balance_due) : "Clear"}</b>
          </div>
        )) : <div className="card card-pad"><div className="empty">No customers yet.</div></div>}
        {ledger && <LedgerModal branchId={ledger.branchId} name={ledger.name} onClose={() => setLedger(null)} onSync={onSync} />}
      </>
    );
  }

  return (
    <><h1 className="page-title">Ledger</h1><p className="page-sub">Customer balances (udhaar) across both branches.</p>
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <Kpi label="Customers" value={String(rows.length)} delta={{ cls: "up", txt: "all branches" }} icon="customers" color="var(--accent)" bg="var(--accent-soft)" />
        <Kpi label="With dues" value={String(withDue)} delta={{ cls: withDue > 0 ? "down" : "up", txt: "need follow-up" }} icon="bill" color="var(--amber)" bg="var(--amber-soft)" />
        <Kpi label="Total outstanding" value={money(totalDue)} delta={{ cls: totalDue > 0 ? "down" : "up", txt: "across ledger" }} icon="book" color="var(--red)" bg="var(--red-soft)" />
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Customer balances</h3>
          <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Phone</th><th>Branch</th><th className="r">Balance due</th><th className="r"></th></tr></thead>
          <tbody>{rows.length ? rows.map((c: any) => (
            <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td><span className="b-tag">{bmap[c.branch_id]}</span></td>
              <td className={"r amt " + (c.balance_due > 0 ? "out" : "in")}>{c.balance_due > 0 ? money(c.balance_due) : "Clear"}</td>
              <td className="r"><button className="edit-btn" onClick={() => setLedger({ branchId: c.branch_id, name: c.name })}>View ledger</button></td></tr>
          )) : <tr><td colSpan={5}><div className="empty">No customers yet.</div></td></tr>}</tbody>
        </table></div>
      </div>
      {ledger && <LedgerModal branchId={ledger.branchId} name={ledger.name} onClose={() => setLedger(null)} onSync={onSync} />}</>
  );
}

/* ---------- products (catalog & pricing) ---------- */
function ProductsPage({ prodAll, online, branches, onSync }: any) {
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [q, setQ] = useState("");
  const blank: Partial<Product> = { name: "", unit: "pcs", sale_price: 0, cost_price: 0, low_stock_at: 5 };
  let rows: Product[] = showDeleted ? deletedOnly(prodAll) : live(prodAll);
  if (q.trim()) rows = rows.filter((pr) => pr.name.toLowerCase().includes(q.toLowerCase()));

  const save = async () => {
    if (!edit?.name?.trim()) return toast("Enter a product name");
    await saveProduct(edit as any);
    toast("Product saved" + (online ? "" : " offline")); setEdit(null); onSync();
  };
  const delProd = async (pr: Product) => { if (confirmDelete("product")) { await softDelete("products", pr.id); toast("Deleted"); onSync(); } };
  const restoreProd = async (pr: Product) => { await restoreRow("products", pr.id); toast("Restored"); onSync(); };
  const exportCsv = () => downloadExcel("products", ["Name", "Branch", "Unit", "Cost", "Sale price", "Pieces/box", "Box price", "Low stock at"],
    rows.map((pr) => [pr.name, pr.branch_id ? (branches.find((b: any) => b.id === pr.branch_id)?.name.replace(" Branch", "") || pr.branch_id) : "All", pr.unit, pr.cost_price, pr.sale_price, pr.pieces_per_box || "", pr.box_price || "", pr.low_stock_at ?? 5]));

  return (
    <><h1 className="page-title">Products</h1><p className="page-sub">Catalog, pricing & branch assignment.</p>
      <div className="card">
        <div className="card-head"><h3>{rows.length} {showDeleted ? "deleted" : "product" + (rows.length === 1 ? "" : "s")}</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="edit-btn" onClick={exportCsv}>Export Excel</button>
            <button className="edit-btn" onClick={() => setShowDeleted((v) => !v)}>{showDeleted ? "← Active" : "Deleted"}</button>
            {!showDeleted && <button className="add-btn" onClick={() => setEdit({ ...blank })}>+ Add product</button>}
          </div>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Product</th><th>Branch</th><th>Unit</th><th className="r">Cost</th><th className="r">Piece price</th><th className="r">Box price</th><th className="r">Low ≤</th><th className="r"></th></tr></thead>
          <tbody>
            {rows.length ? rows.map((pr: Product) => (
              <tr key={pr.id}>
                <td>{pr.name}</td>
                <td><span className="b-tag">{pr.branch_id ? (branches.find((b: any) => b.id === pr.branch_id)?.name.replace(" Branch", "") || pr.branch_id) : "All"}</span></td>
                <td>{pr.unit}</td>
                <td className="r">{money(pr.cost_price)}</td>
                <td className="r amt in">{money(pr.sale_price)}</td>
                <td className="r">{pr.pieces_per_box ? (pr.box_price ? money(pr.box_price) : <span style={{ color: "var(--faint)" }}>—</span>) : <span style={{ color: "var(--faint)" }}>n/a</span>}</td>
                <td className="r">{pr.low_stock_at ?? 5}</td>
                <td className="r">{showDeleted
                  ? <button className="pay-btn" onClick={() => restoreProd(pr)}>Restore</button>
                  : <><button className="edit-btn" onClick={() => setEdit({ ...pr })}>Edit</button> <button className="del-btn" onClick={() => delProd(pr)}>✕</button></>}</td>
              </tr>
            )) : <tr><td colSpan={8}><div className="empty">Nothing here.</div></td></tr>}
          </tbody>
        </table></div>
      </div>
      {edit && (
        <Modal title={edit.id ? "Edit product" : "Add product"} onClose={() => setEdit(null)}>
          <div className="form-grid">
            <div className="field"><label>Name</label><input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Product name" /></div>
            <div className="field"><label>Branch (which branch sells this)</label>
              <select value={edit.branch_id ?? ""} onChange={(e) => setEdit({ ...edit, branch_id: e.target.value || null })}>
                <option value="">All branches</option>
                {branches.filter((b: any) => b.id !== "ho").map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
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

/* ---------- purchases (professional) ---------- */
function PurchasesPage({ rPurch, purchAll, bmap, label, branches, products, userId, onSync, isMobile }: any) {
  const [showDeleted, setShowDeleted] = useState(false);
  const [branchF, setBranchF] = useState("all");
  const [q, setQ] = useState("");
  const [editRow, setEditRow] = useState<any>(null);
  const [addP, setAddP] = useState(false);
  const brs = branches.filter((b: any) => b.id !== "ho");

  let rows: any[] = showDeleted ? deletedOnly(purchAll) : rPurch;
  if (branchF !== "all") rows = rows.filter((x: any) => x.branch_id === branchF);
  if (q.trim()) rows = rows.filter((x: any) => ((x.supplier || "") + x.product_name + (x.invoice_no || "")).toLowerCase().includes(q.toLowerCase()));
  rows = [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const total = rows.reduce((a, x) => a + x.total, 0);
  const credit = rows.filter((x) => (x.payment_mode || "cash") === "credit").reduce((a, x) => a + x.total, 0);
  // supplier-wise summary
  const bySup: Record<string, number> = {};
  rows.forEach((x) => { const s = x.supplier || "—"; bySup[s] = (bySup[s] || 0) + x.total; });
  const supTop = Object.entries(bySup).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const act = async (x: any) => {
    if (showDeleted) { await restoreRow("purchases", x.id); toast("Restored"); }
    else if (confirmDelete("purchase")) { await softDelete("purchases", x.id); toast("Deleted"); }
    onSync();
  };
  const exportXls = () => downloadExcel("purchases", ["Date", "Branch", "Supplier", "Item", "Qty", "Cost each", "Total", "Bill no", "Payment", "Note"],
    rows.map((x) => [dateStr(x.created_at), bmap[x.branch_id] || "", x.supplier || "", x.product_name, x.qty, x.cost, x.total, x.invoice_no || "", (x.payment_mode || "cash").toUpperCase(), x.note || ""]));

  if (isMobile) {
    return (
      <>
        <h1 className="page-title" style={{ fontSize: 20 }}>Purchase Register</h1>
        <p className="page-sub" style={{ margin: "2px 0 14px" }}>Manage inventory inflows and credit.</p>
        <div className="bento" style={{ marginBottom: 14 }}>
          <div className="stat"><div className="label">Total Purchases</div><div className="value" style={{ fontSize: 18, color: "var(--red)" }}>{money(total)}</div></div>
          <div className="stat"><div className="label">Outstanding</div><div className="value" style={{ fontSize: 18 }}>{money(credit)}</div></div>
        </div>
        {supTop.length > 0 && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 14, paddingBottom: 2 }}>
            {supTop.map(([s, v]) => <span className="chip" key={s} style={{ flexShrink: 0 }}>{s} · <b>{money(v)}</b></span>)}
          </div>
        )}
        <input className="search" style={{ width: "100%", marginBottom: 14 }} placeholder="Search invoices…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ fontSize: 15, margin: 0 }}>Recent Purchases</h3>
          <button className="edit-btn" onClick={() => setShowDeleted((v: boolean) => !v)}>{showDeleted ? "← Active" : "Deleted"}</button>
        </div>
        {rows.length ? rows.slice(0, 100).map((x: any) => (
          <div className="card card-pad" key={x.id} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span className="b-tag">{bmap[x.branch_id]}</span>
              <div style={{ textAlign: "right" }}>
                <b style={{ fontSize: 16, color: "var(--accent)" }}>{money(x.total)}</b>
                <div><span className="badge role">{(x.payment_mode || "cash").toUpperCase()}</span></div>
              </div>
            </div>
            <div className="main" style={{ fontWeight: 700, marginTop: 6 }}>{x.product_name}</div>
            <div className="sub">{x.supplier || "—"} · {dateStr(x.created_at)}{x.invoice_no ? " · #" + x.invoice_no : ""}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {!showDeleted && <button className="edit-btn" onClick={() => setEditRow(x)}>Edit</button>}
              <button className={showDeleted ? "pay-btn" : "del-btn"} onClick={() => act(x)}>{showDeleted ? "Restore" : <Icon name="trash" size={13} />}</button>
            </div>
          </div>
        )) : <div className="card card-pad"><div className="empty">Nothing here.</div></div>}
        <button className="fab round" onClick={() => setAddP(true)}><Icon name="plus" size={22} /></button>
        {editRow && <EditEntryModal table="purchases" row={editRow} onClose={() => setEditRow(null)} onSync={onSync} />}
        {addP && <AddPurchaseModal branches={branches} products={products} userId={userId} onClose={() => setAddP(false)} onSync={onSync} />}
      </>
    );
  }

  return (
    <><h1 className="page-title">Purchases</h1><p className="page-sub">What each branch bought, from whom, when · {showDeleted ? "deleted items" : String(label).toLowerCase()}.</p>
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <Kpi label="Total purchases" value={money(total)} delta={{ cls: "down", txt: "outflow" }} icon="cart" color="var(--red)" bg="var(--red-soft)" />
        <Kpi label="On credit (owed)" value={money(credit)} delta={{ cls: "down", txt: "to suppliers" }} icon="wallet" color="var(--amber)" bg="var(--amber-soft)" />
        <Kpi label="Records" value={String(rows.length)} delta={{ cls: "up", txt: "purchase entries" }} icon="truck" color="var(--accent)" bg="var(--accent-soft)" />
      </div>

      {supTop.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>Top suppliers</h3>
          <div className="chips">{supTop.map(([s, v]) => <span className="chip" key={s}>{s} · <b>{money(v)}</b></span>)}</div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select className="search" style={{ width: "auto" }} value={branchF} onChange={(e) => setBranchF(e.target.value)}>
              <option value="all">All branches</option>{brs.map((b: any) => <option key={b.id} value={b.id}>{shortBranch(b.name)}</option>)}
            </select>
            <input className="search" placeholder="Search supplier / item / bill…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="edit-btn" onClick={exportXls}>Export Excel</button>
            <button className="edit-btn" onClick={() => setShowDeleted((v) => !v)}>{showDeleted ? "← Active" : "Deleted"}</button>
            {!showDeleted && <button className="add-btn" onClick={() => setAddP(true)}>+ Add purchase</button>}
          </div>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Branch</th><th>Supplier</th><th>Item</th><th className="r">Qty</th><th className="r">Total</th><th>Bill no</th><th>Pay</th><th className="r"></th></tr></thead>
          <tbody>{rows.length ? rows.slice(0, 300).map((x: any) => (
            <tr key={x.id}><td>{dateStr(x.created_at)}</td><td><span className="b-tag">{bmap[x.branch_id]}</span></td>
              <td>{x.supplier || "—"}</td><td>{x.product_name}{x.note ? <div style={{ color: "var(--faint)", fontSize: 11 }}>{x.note}</div> : null}</td>
              <td className="r">{x.qty}</td><td className="r amt out">{money(x.total)}</td>
              <td>{x.invoice_no || "—"}</td><td><span className="badge role">{(x.payment_mode || "cash").toUpperCase()}</span></td>
              <td className="r" style={{ whiteSpace: "nowrap" }}>{!showDeleted && <button className="edit-btn" onClick={() => setEditRow(x)}>Edit</button>}{" "}
                <button className={showDeleted ? "pay-btn" : "del-btn"} onClick={() => act(x)}>{showDeleted ? "Restore" : "✕"}</button></td></tr>
          )) : <tr><td colSpan={9}><div className="empty">Nothing here.</div></td></tr>}</tbody>
        </table></div>
      </div>
      {editRow && <EditEntryModal table="purchases" row={editRow} onClose={() => setEditRow(null)} onSync={onSync} />}
      {addP && <AddPurchaseModal branches={branches} products={products} userId={userId} onClose={() => setAddP(false)} onSync={onSync} />}</>
  );
}

/* ---------- inventory ---------- */
function InventoryPage({ products, sales, purchases, branches, userId, onSync, isMobile }: any) {
  const brs = branches.filter((b: any) => b.id !== "ho");
  const [adj, setAdj] = useState<any>(null);
  const [branchId, setBranchId] = useState(brs[0]?.id || "");
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");

  const doAdjust = async () => {
    if (!delta) return toast("Enter a +/- quantity");
    await addStockAdjustment(branchId, userId, { id: adj.id, name: adj.name }, Number(delta), reason.trim());
    toast("Stock adjusted"); setAdj(null); setDelta(0); setReason(""); onSync();
  };

  if (isMobile) {
    const rows = products.filter((pr: any) => pr.name.toLowerCase().includes(q.toLowerCase()));
    const globalValue = rows.reduce((a: number, pr: any) => a + brs.reduce((s: number, b: any) => s + computeStock(pr.id, b.id, sales, purchases), 0) * pr.sale_price, 0);
    return (
      <>
        <input className="search" style={{ width: "100%", marginBottom: 14 }} placeholder="Search inventory…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ background: "var(--accent)", color: "#fff", borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".6px", opacity: .85 }}>Global Stock Value</span>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{money(globalValue)}</div>
        </div>
        {rows.length ? rows.map((pr: any) => {
          const per = brs.map((b: any) => ({ b, qty: computeStock(pr.id, b.id, sales, purchases) }));
          const total = per.reduce((a: number, x: any) => a + x.qty, 0);
          const anyLow = per.some((x: any) => x.qty <= (pr.low_stock_at ?? 5));
          return (
            <div className="card card-pad" key={pr.id} style={{ marginBottom: 10, borderColor: anyLow ? "var(--red)" : undefined }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div><div className="main" style={{ fontWeight: 700 }}>{pr.name}</div><div className="sub">per {pr.unit}</div></div>
                <div style={{ textAlign: "right" }}><b style={{ fontSize: 17, color: anyLow ? "var(--red)" : "var(--text)" }}>{total}</b><div className="sub">total units</div></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
                {per.map((x: any) => (
                  <div key={x.b.id}><span className="sub">{shortBranch(x.b.name)}</span>{" "}
                    <span className={x.qty <= (pr.low_stock_at ?? 5) ? "stock low" : "stock"} style={{ fontSize: 13 }}>{x.qty}</span></div>
                ))}
              </div>
              <button className="edit-btn" style={{ width: "100%", marginTop: 10, padding: "9px 0" }} onClick={() => { setAdj(pr); setBranchId(brs[0]?.id || ""); }}>Adjust Stock</button>
            </div>
          );
        }) : <div className="card card-pad"><div className="empty">No products.</div></div>}

        {adj && (
          <Modal title={`Adjust stock — ${adj.name}`} onClose={() => setAdj(null)}>
            <div className="form-grid">
              <div className="qty-row">
                <div className="field"><label>Branch</label><select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{brs.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
                <div className="field"><label>Change (+ add / − remove)</label><input type="number" inputMode="numeric" value={delta} onChange={(e) => setDelta(+e.target.value)} placeholder="e.g. 10 or -3" /></div>
              </div>
              <div className="field"><label>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opening stock / wastage / correction" /></div>
              <div className="btn-row"><button className="btn ghost" onClick={() => setAdj(null)}>Cancel</button><button className="btn" onClick={doAdjust}>Save adjustment</button></div>
            </div>
          </Modal>
        )}
      </>
    );
  }

  return (
    <><h1 className="page-title">Inventory</h1><p className="page-sub">Live stock per branch (purchases in − sales out). Adjust for opening stock or wastage.</p>
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <Kpi label="Total SKU Items" value={String(products.length)} delta={{ cls: "up", txt: "across catalog" }} icon="boxIcon" color="var(--accent)" bg="var(--accent-soft)" />
        <Kpi label="Stock Value" value={money(products.reduce((a: number, pr: any) => a + brs.reduce((s: number, b: any) => s + computeStock(pr.id, b.id, sales, purchases), 0) * pr.sale_price, 0))} delta={{ cls: "up", txt: "live valuation" }} icon="wallet" color="var(--green)" bg="var(--green-soft)" />
        <Kpi label="Out of Stock" value={String(products.filter((pr: any) => brs.reduce((s: number, b: any) => s + computeStock(pr.id, b.id, sales, purchases), 0) <= 0).length)} delta={{ cls: "down", txt: "items" }} icon="warning" color="var(--red)" bg="var(--red-soft)" />
      </div>
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>Product</th>{brs.map((b: any) => <th key={b.id} className="r">{shortBranch(b.name)}</th>)}<th className="r">Total</th><th className="r"></th></tr></thead>
        <tbody>
          {products.length ? products.map((pr: any) => {
            const per = brs.map((b: any) => ({ b, qty: computeStock(pr.id, b.id, sales, purchases) }));
            const total = per.reduce((a: number, x: any) => a + x.qty, 0);
            return (
              <tr key={pr.id}><td>{pr.name}<div style={{ color: "var(--faint)", fontSize: 11 }}>per {pr.unit}</div></td>
                {per.map((x: any) => (
                  <td key={x.b.id} className="r">
                    <span className={x.qty <= (pr.low_stock_at ?? 5) ? "stock low" : "stock"}>{x.qty}</span>
                  </td>
                ))}
                <td className="r amt">{total}</td>
                <td className="r"><button className="edit-btn" onClick={() => { setAdj(pr); setBranchId(brs[0]?.id || ""); }}>Adjust</button></td></tr>
            );
          }) : <tr><td colSpan={brs.length + 3}><div className="empty">No products.</div></td></tr>}
        </tbody>
      </table></div></div>

      {adj && (
        <Modal title={`Adjust stock — ${adj.name}`} onClose={() => setAdj(null)}>
          <div className="form-grid">
            <div className="qty-row">
              <div className="field"><label>Branch</label><select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{brs.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              <div className="field"><label>Change (+ add / − remove)</label><input type="number" inputMode="numeric" value={delta} onChange={(e) => setDelta(+e.target.value)} placeholder="e.g. 10 or -3" /></div>
            </div>
            <div className="field"><label>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opening stock / wastage / correction" /></div>
            <div className="btn-row"><button className="btn ghost" onClick={() => setAdj(null)}>Cancel</button><button className="btn" onClick={doAdjust}>Save adjustment</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------- sales / bill history ---------- */
function SalesHistoryPage({ sales, bmap, branches, staffMap, isMobile }: any) {
  const [payFilter, setPayFilter] = useState<"all" | "cash" | "upi" | "credit">("all");
  const [q, setQ] = useState("");

  // group sales into bills by bill_no. Voided bills stay in the list
  // (crossed out) but don't add to the group total or the KPI/CSV totals.
  const groups = new Map<string, any>();
  for (const s of sales) {
    if (payFilter !== "all" && (s.payment_mode || "cash") !== payFilter) continue;
    const key = s.bill_no || s.id;
    const g = groups.get(key) || { key, br: s.branch_id, cust: s.customer_name || "Walk-in", pay: s.payment_mode || "cash", staff: s.created_by, t: s.created_at, items: [] as any[], total: 0, voided: false };
    g.items.push(s);
    if (s.void_at) g.voided = true; else g.total += s.total;
    groups.set(key, g);
  }
  let bills = [...groups.values()].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime()).slice(0, 200);

  const exportCsv = () => downloadExcel("sales-bills", ["Bill", "Date", "Branch", "Customer", "Payment", "Staff", "Items", "Total", "Status"],
    bills.map((g) => [g.key, dateStr(g.t) + " " + timeStr(g.t), bmap[g.br] || "", g.cust, g.pay.toUpperCase(), staffMap[g.staff] || "", g.items.length, g.total, g.voided ? "VOID" : "OK"]));

  if (isMobile) {
    const filtered = q.trim() ? bills.filter((g) => (g.key + g.cust).toLowerCase().includes(q.toLowerCase())) : bills;
    return (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h1 className="page-title" style={{ fontSize: 20, margin: 0 }}>Sales History</h1>
          <button className="edit-btn" onClick={exportCsv}>Export</button>
        </div>
        <input className="search" style={{ width: "100%", marginBottom: 10 }} placeholder="Search by bill # or customer" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 14, paddingBottom: 2 }}>
          {(["all", "cash", "upi", "credit"] as const).map((m) => (
            <button key={m} className={"pay-opt" + (payFilter === m ? " active" : "")} style={{ flexShrink: 0, width: "auto", padding: "8px 16px" }} onClick={() => setPayFilter(m)}>{m === "all" ? "All Modes" : m.toUpperCase()}</button>
          ))}
        </div>
        {filtered.length ? filtered.map((g) => (
          <div className="card card-pad" key={g.key} style={{ marginBottom: 10, opacity: g.voided ? .55 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <b style={{ textDecoration: g.voided ? "line-through" : undefined }}>{g.key.startsWith("B-") ? g.key : "—"}</b>
                  <span className="b-tag">{bmap[g.br]}</span>
                  {g.voided && <span className="status-pill warn" style={{ fontSize: 10 }}>VOID</span>}
                </div>
                <div className="sub">{dateStr(g.t)} · {timeStr(g.t)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <b style={{ fontSize: 16, color: "var(--accent)", textDecoration: g.voided ? "line-through" : undefined }}>{money(g.total)}</b>
                <div className="sub">via {g.pay.toUpperCase()}</div>
              </div>
            </div>
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line-2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="sub">{g.cust} · {g.items.length} item{g.items.length === 1 ? "" : "s"}</span>
              <span className="sub">{staffMap[g.staff] || "—"}</span>
            </div>
          </div>
        )) : <div className="card card-pad"><div className="empty">No bills found.</div></div>}
      </>
    );
  }

  return (
    <><h1 className="page-title">Sales / Bill History</h1><p className="page-sub">Every bill across both branches.</p>
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <Kpi label="Total Revenue" value={money(bills.reduce((a, g) => a + g.total, 0))} delta={{ cls: "up", txt: "this view" }} icon="sales" color="var(--accent)" bg="var(--accent-soft)" />
        <Kpi label="Total Bills" value={String(bills.length)} delta={{ cls: "up", txt: "records" }} icon="bill" color="var(--green)" bg="var(--green-soft)" />
        <Kpi label="Branches Covered" value={String(new Set(bills.map((g) => g.br)).size)} delta={{ cls: "up", txt: "active" }} icon="branch" color="var(--amber)" bg="var(--amber-soft)" />
      </div>
      <div className="card">
        <div className="card-head">
          <div className="seg">{(["all", "cash", "upi", "credit"] as const).map((m) => <button key={m} className={payFilter === m ? "active" : ""} onClick={() => setPayFilter(m)}>{m === "all" ? "All" : m.toUpperCase()}</button>)}</div>
          <button className="edit-btn" onClick={exportCsv}>Export CSV</button>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Bill</th><th>Date</th><th>Branch</th><th>Customer</th><th>Payment</th><th>Staff</th><th className="r">Total</th></tr></thead>
          <tbody>{bills.length ? bills.map((g) => (
            <tr key={g.key} style={{ opacity: g.voided ? .55 : 1 }}>
              <td style={{ textDecoration: g.voided ? "line-through" : undefined }}>{g.key.startsWith("B-") ? g.key : "—"}<div style={{ color: "var(--faint)", fontSize: 11 }}>{g.items.length} item{g.items.length === 1 ? "" : "s"}</div></td>
              <td>{dateStr(g.t)} {timeStr(g.t)}</td><td><span className="b-tag">{bmap[g.br]}</span></td>
              <td>{g.cust}</td><td><span className={"badge " + (g.voided ? "void" : "role")}>{g.voided ? "VOID" : g.pay.toUpperCase()}</span></td><td>{staffMap[g.staff] || "—"}</td>
              <td className="r amt in" style={{ textDecoration: g.voided ? "line-through" : undefined }}>{money(g.total)}</td>
            </tr>
          )) : <tr><td colSpan={7}><div className="empty">No bills in this period.</div></td></tr>}</tbody>
        </table></div>
      </div></>
  );
}

/* ---------- day book ---------- */
function DaybookPage({ rSales, rPurch, rExp, bmap, range, branches, userId, onSync }: any) {
  const [editRow, setEditRow] = useState<{ table: any; row: any } | null>(null);
  const [addE, setAddE] = useState(false);
  const inT = sum(rSales, "total"), outP = sum(rPurch, "total"), outE = sum(rExp, "amount");
  const del = async (table: any, id: string, what: string) => { if (confirmDelete(what)) { await softDelete(table, id); toast("Deleted"); onSync(); } };
  const items = [
    ...rSales.map((s: any) => ({ table: "sales", id: s.id, row: s, t: s.created_at, br: s.branch_id, label: `Sale · ${s.product_name} × ${s.qty}`, amt: s.total, dir: "in", what: "sale" })),
    ...rPurch.map((x: any) => ({ table: "purchases", id: x.id, row: x, t: x.created_at, br: x.branch_id, label: `Purchase · ${x.product_name} × ${x.qty}`, amt: x.total, dir: "out", what: "purchase" })),
    ...rExp.map((x: any) => ({ table: "expenses", id: x.id, row: x, t: x.created_at, br: x.branch_id, label: `Expense · ${x.category}`, amt: x.amount, dir: "out", what: "expense" })),
  ].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime());
  const exportCsv = () => downloadExcel("daybook", ["Date", "Time", "Branch", "Detail", "In/Out", "Amount"],
    items.map((i: any) => [dateStr(i.t), timeStr(i.t), bmap[i.br] || "", i.label, i.dir === "in" ? "IN" : "OUT", i.amt]));
  return (
    <><h1 className="page-title">Day Book</h1><p className="page-sub">Combined money in & out · {rangeLabel(range).toLowerCase()}.</p>
      <div className="stats" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="stat"><div className="label">Money in</div><div className="value" style={{ color: "var(--green)" }}>{money(inT)}</div></div>
        <div className="stat"><div className="label">Purchases</div><div className="value">{money(outP)}</div></div>
        <div className="stat"><div className="label">Expenses</div><div className="value" style={{ color: "var(--red)" }}>{money(outE)}</div></div>
        <div className="stat"><div className="label">Net</div><div className="value">{money(inT - outP - outE)}</div></div>
      </div>
      <div className="card">
        <div className="card-head"><h3>All entries ({items.length})</h3>
          <div style={{ display: "flex", gap: 8 }}><button className="edit-btn" onClick={exportCsv}>Export Excel</button><button className="add-btn" onClick={() => setAddE(true)}>+ Add expense</button></div></div>
        <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Branch</th><th>Detail</th><th className="r">Amount</th><th className="r"></th></tr></thead>
        <tbody>{items.slice(0, 200).map((i: any) => (
          <tr key={i.id}><td>{dateStr(i.t)} {timeStr(i.t)}</td><td><span className="b-tag">{bmap[i.br]}</span></td>
            <td>{i.label}</td><td className={"r amt " + i.dir}>{i.dir === "in" ? "+" : "−"}{money(i.amt)}</td>
            <td className="r" style={{ whiteSpace: "nowrap" }}><button className="edit-btn" onClick={() => setEditRow({ table: i.table, row: i.row })}>Edit</button> <button className="del-btn" onClick={() => del(i.table, i.id, i.what)}>✕</button></td></tr>
        ))}</tbody>
      </table></div></div>
      {editRow && <EditEntryModal table={editRow.table} row={editRow.row} onClose={() => setEditRow(null)} onSync={onSync} />}
      {addE && <AddExpenseModal branches={branches} userId={userId} onClose={() => setAddE(false)} onSync={onSync} />}</>
  );
}

/* ---------- reports ---------- */
function ReportsPage({ rSales, range, staffMap }: any) {
  const totals: Record<string, number> = {};
  rSales.forEach((s: any) => { totals[s.product_name] = (totals[s.product_name] || 0) + s.total; });
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = Math.max(1, ...top.map((t) => t[1]));
  const seppa = sum(rSales.filter((s: any) => s.branch_id === "seppa"), "total");
  const dirang = sum(rSales.filter((s: any) => s.branch_id === "dirang"), "total");
  const tot = Math.max(1, seppa + dirang);
  const staffTotals: Record<string, number> = {};
  rSales.forEach((s: any) => { const n = (staffMap && staffMap[s.created_by]) || "Unknown"; staffTotals[n] = (staffTotals[n] || 0) + s.total; });
  const staffTop = Object.entries(staffTotals).sort((a, b) => b[1] - a[1]);
  const staffMax = Math.max(1, ...staffTop.map((t) => t[1]));
  const Bar = ({ label, val, pct, color }: any) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}><span>{label}</span><b>{money(val)}{pct != null ? ` · ${pct}%` : ""}</b></div>
      <div style={{ height: 9, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}><div style={{ height: "100%", width: `${pct ?? (val / max * 100).toFixed(0)}%`, background: color, borderRadius: 999 }} /></div>
    </div>
  );
  return (
    <><h1 className="page-title">Reports</h1><p className="page-sub">Sales insights · {rangeLabel(range).toLowerCase()}.</p>
      <div className="grid-2">
        <div className="card card-pad"><h3 style={{ margin: "0 0 16px" }}>Top products by revenue</h3>
          {top.length ? top.map(([n, v]) => <Bar key={n} label={n} val={v} color="var(--accent)" />) : <div className="empty">No data.</div>}</div>
        <div className="card card-pad"><h3 style={{ margin: "0 0 16px" }}>Branch contribution</h3>
          <Bar label="Seppa" val={seppa} pct={(seppa / tot * 100).toFixed(0)} color="var(--green)" />
          <Bar label="Dirang" val={dirang} pct={(dirang / tot * 100).toFixed(0)} color="var(--accent)" />
        </div>
      </div>
      <div className="card card-pad" style={{ marginTop: 16 }}><h3 style={{ margin: "0 0 16px" }}>Sales by staff</h3>
        {staffTop.length ? staffTop.map(([n, v]) => (
          <div style={{ marginBottom: 12 }} key={n}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}><span>{n}</span><b>{money(v)}</b></div>
            <div style={{ height: 9, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}><div style={{ height: "100%", width: `${(v / staffMax * 100).toFixed(0)}%`, background: "var(--accent)", borderRadius: 999 }} /></div>
          </div>
        )) : <div className="empty">No data.</div>}
      </div></>
  );
}

/* ---------- settings ---------- */
function SettingsPage({ settings, onSync, branches }: any) {
  const [co, setCo] = useState<Settings>(settings ?? { id: "main", company: "", address: "", phone: "", gstin: "", footer: "" });
  const [showPw, setShowPw] = useState(false);
  useEffect(() => { if (settings) setCo(settings); }, [settings]);
  const saveCo = async () => {
    const ok = await saveSettings({ ...co, id: "main" }, true);
    toast(ok ? "Company profile saved" : "Could not save");
    onSync();
  };

  return (
    <><h1 className="page-title">Settings</h1><p className="page-sub">Company profile, staff & system.</p>

      <div className="card card-pad">
        <h3 style={{ margin: "0 0 14px" }}>Company profile</h3>
        <div className="form-grid">
          <div className="qty-row">
            <div className="field"><label>Company name</label><input value={co.company ?? ""} onChange={(e) => setCo({ ...co, company: e.target.value })} placeholder="Shop name" /></div>
            <div className="field"><label>Phone</label><input value={co.phone ?? ""} onChange={(e) => setCo({ ...co, phone: e.target.value })} /></div>
          </div>
          <div className="qty-row">
            <div className="field"><label>Address</label><input value={co.address ?? ""} onChange={(e) => setCo({ ...co, address: e.target.value })} /></div>
            <div className="field"><label>GSTIN (optional)</label><input value={co.gstin ?? ""} onChange={(e) => setCo({ ...co, gstin: e.target.value })} /></div>
          </div>
          <div className="field"><label>Invoice footer</label><input value={co.footer ?? ""} onChange={(e) => setCo({ ...co, footer: e.target.value })} placeholder="Thank you!" /></div>
          <div><button className="btn" style={{ width: "auto", padding: "11px 20px" }} onClick={saveCo}>Save company profile</button></div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 12px" }}>My account</h3>
        <button className="btn" style={{ width: "auto", padding: "11px 20px" }} onClick={() => setShowPw(true)}>Change my password</button>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 12px" }}>Staff passwords</h3>
        <p style={{ color: "var(--muted)", fontSize: 13.5, margin: "0 0 14px" }}>Reset any staff member's password instantly (for "forgot password" situations). Requires the <b>admin-reset-password</b> Edge Function to be deployed — see DEPLOY.md.</p>
        <ResetStaffPassword />
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <StaffManager branches={branches} />
        <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "12px 0 0" }}>Adding staff needs the <b>admin-create-staff</b> Edge Function deployed (see DEPLOY.md). Branch-level access is enforced by the database (RLS).</p>
      </div>

      {showPw && <ChangePasswordModal onClose={() => setShowPw(false)} />}
    </>
  );
}
