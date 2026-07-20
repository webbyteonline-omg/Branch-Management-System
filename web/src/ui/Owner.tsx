import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localdb } from "../lib/db";
import { Icon } from "../lib/icons";
import { money, dateStr, timeStr, initials, rangeStart, prevRange, rangeLabel, pctDelta } from "../lib/format";
import type { Range, Product, Settings } from "../lib/types";
import { sum, topItems, shortBranch, live, deletedOnly, computeStock, forTotals, type SharedProps } from "./shared";
import { Modal } from "./Modal";
import { toast } from "./Toast";
import { ManageAccounts } from "./Account";
import { saveProduct, softDelete, restoreRow, saveSettings, addStockAdjustment } from "../lib/writes";
import { LedgerModal } from "./Ledger";
import { EditCustomerModal, EditEntryModal } from "./Edits";
import { downloadExcel } from "../lib/excel";
import { supabase } from "../lib/supabase";
import { fetchRangeFresh } from "../lib/sync";
import { BarChart, Donut } from "./Charts";
import { AddCustomerModal, AddExpenseModal, AddPurchaseModal } from "./OwnerAdd";
import { SyncStatusModal } from "./SyncStatus";

type View = "dashboard" | "branch" | "customers" | "ledger" | "purchases" | "inventory" | "products" | "saleshistory" | "daybook" | "reports" | "settings";
type ORange = Range | "custom";
type Scope = "seppa" | "dirang" | "all";
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
  // Landing choice: which branch (or "all" combined) the owner is working in.
  // null = show the 3-way landing screen. Every page below is scoped to this.
  const [scope, setScope] = useState<Scope | null>(null);

  const branches = useLiveQuery(() => localdb.branches.toArray(), [], []);
  const salesAll = useLiveQuery(() => localdb.sales.toArray(), [], []);
  const purchAll = useLiveQuery(() => localdb.purchases.toArray(), [], []);
  const billsAll = useLiveQuery(() => localdb.bills.toArray(), [], []);
  const custAll = useLiveQuery(() => localdb.customers.toArray(), [], []);
  const prodAll = useLiveQuery(() => localdb.products.toArray(), [], []);
  const expAll = useLiveQuery(() => localdb.expenses.toArray(), [], []);
  const settings = useLiveQuery(() => localdb.settings.get("main"), [], undefined);
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

  // ---- scope: everything below this point is filtered to the branch (or
  // both, for "all") the owner picked on the landing screen. Every existing
  // page component keeps working unmodified — it just now only ever sees
  // rows from the branches in scope. ----
  const scopedBranchIds: string[] | null = scope && scope !== "all" ? [scope] : null; // null = no filtering (both branches)
  const inScope = <T extends { branch_id?: string | null }>(rows: T[]) =>
    scopedBranchIds ? rows.filter((r) => r.branch_id && scopedBranchIds.includes(r.branch_id)) : rows;
  const sBranches = useMemo(() => scopedBranchIds ? branches.filter((b) => scopedBranchIds.includes(b.id)) : branches, [branches, scope]);
  const sSales = useMemo(() => inScope(sales), [sales, scope]);
  const sSalesT = useMemo(() => inScope(salesT), [salesT, scope]);
  const sRSales = useMemo(() => inScope(rSales), [rSales, scope]);
  const sRSalesT = useMemo(() => inScope(rSalesT), [rSalesT, scope]);
  const sPurchases = useMemo(() => inScope(purchases), [purchases, scope]);
  const sPurchAll = useMemo(() => inScope(purchAll), [purchAll, scope]);
  const sRPurch = useMemo(() => inScope(rPurch), [rPurch, scope]);
  const sBills = useMemo(() => inScope(bills), [bills, scope]);
  const sBillsT = useMemo(() => inScope(billsT), [billsT, scope]);
  const sExpenses = useMemo(() => inScope(expenses), [expenses, scope]);
  const sRExp = useMemo(() => inScope(rExp), [rExp, scope]);
  const sCustAll = useMemo(() => inScope(custAll), [custAll, scope]);
  const sProdAll = useMemo(() => scopedBranchIds ? prodAll.filter((pr) => !pr.branch_id || scopedBranchIds.includes(pr.branch_id)) : prodAll, [prodAll, scope]);
  const sProducts = useMemo(() => scopedBranchIds ? products.filter((pr) => !pr.branch_id || scopedBranchIds.includes(pr.branch_id)) : products, [products, scope]);
  const scopeLabel = scope === "seppa" ? "Seppa Branch" : scope === "dirang" ? "Dirang Branch" : "All Branches";

  const navItems: [View, string, string][] = [
    ["dashboard", scope === "all" ? "Overview" : "Branch Overview", "dashboard"],
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

  // ---- landing screen: pick Seppa / Dirang / All Branches before anything else ----
  if (!scope) {
    const realBranches = branches.filter((b) => b.id !== "ho");
    const cards: { key: Scope; label: string; sub: string; icon: string }[] = [
      ...realBranches.map((b) => ({ key: b.id as Scope, label: b.name, sub: `Go to ${shortBranch(b.name)} dashboard`, icon: "branch" })),
      { key: "all", label: "All Branches", sub: "Combined totals across every branch", icon: "dashboard" },
    ];
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, background: "var(--bg)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--accent)" }}>{settings?.company || "ProTrade POS"}</div>
          <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>Welcome, {p.profile.name} — where do you want to work?</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, width: "100%", maxWidth: 720 }}>
          {cards.map((c) => (
            <button key={c.key} className="card card-pad" style={{ textAlign: "left", padding: 22, border: "1px solid var(--line)" }} onClick={() => { setScope(c.key); go("dashboard"); }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", marginBottom: 14 }}>
                <Icon name={c.icon} size={22} />
              </div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{c.label}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{c.sub}</div>
            </button>
          ))}
        </div>
        <button className="btn ghost" style={{ marginTop: 28, width: "auto", padding: "9px 18px" }} onClick={p.onLogout}>Logout</button>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className={"sidebar pt-sidebar" + (open ? " open" : "")}>
        <div className="brand-pt"><b>{settings?.company || "ProTrade POS"}</b><span>{scopeLabel}</span></div>
        <button className="pt-nav-item" style={{ margin: "0 10px 8px", color: "var(--accent)", fontWeight: 700 }} onClick={() => setScope(null)}>
          <Icon name="chevronDown" size={16} /><span>Switch branch</span>
        </button>
        <nav className="pt-nav">
          {navItems.map(([key, label, ic]) => (
            <button key={key} className={"pt-nav-item" + (view === key ? " active" : "")} onClick={() => go(key)}>
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
            {/* Everything just works silently in the background — no online/
             * offline toggle, no routine sync status. The only thing shown
             * here is a small warning, and only when there's an actual
             * problem (a save hasn't reached the server after a while). */}
            {p.syncError ? (
              <button className="sync-pill pending" style={{ border: "none" }} onClick={() => setShowSync(true)} title="Sync problem — tap for details">
                <span className="dot" /><span className="hide-mobile">Sync issue</span>
              </button>
            ) : (
              <button
                className="icon-btn"
                disabled={!p.online || p.syncing}
                onClick={() => p.onSync()}
                title="Sync now"
                style={{ display: "flex", alignItems: "center", gap: 6, width: "auto", padding: "6px 12px", border: "1px solid var(--line)", borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "var(--accent)", flexShrink: 0 }}
              >
                <Icon name="sync" size={15} style={p.syncing ? { animation: "spin 0.8s linear infinite" } : undefined} />
                <span className="hide-mobile">{p.syncing ? "Syncing…" : "Sync"}</span>
              </button>
            )}
            <button className="btn" style={{ width: "auto", padding: "9px 14px", borderRadius: 999, flexShrink: 0 }} onClick={p.onLogout}>Logout</button>
          </div>
        </div>

        <div className="content pt-content">
          <div className="pt-content-head">
            <div>
              <h2 className="pt-page-title">{
                { dashboard: scopeLabel + " Overview", branch: "Branch Detail", customers: "Customers", ledger: "Ledger",
                  purchases: "Purchase Register", inventory: "Stock & Inventory", products: "Products",
                  saleshistory: "Sales History", daybook: "Day Book", reports: "Reports", settings: "Settings" }[view]
              }{view !== "dashboard" && view !== "settings" && <span style={{ marginLeft: 10, fontSize: 12.5, fontWeight: 700, color: "var(--accent)", background: "var(--accent-soft)", padding: "3px 10px", borderRadius: 999, verticalAlign: "middle" }}>{scopeLabel}</span>}</h2>
              <p className="pt-page-sub">{view === "dashboard" ? (scope === "all" ? "Aggregated data from all operational branches" : `Everything for ${scopeLabel}`) : view === "settings" ? "Company profile & account management" : rangeText}</p>
            </div>
            {view !== "settings" && (
              <div className="seg">
                {(["today", "week", "month"] as Range[]).map((r) => (
                  <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>{rangeLabel(r)}</button>
                ))}
                <button className={isCustom ? "active" : ""} onClick={() => setRange("custom")}>Custom</button>
              </div>
            )}
            {view !== "settings" && isCustom && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input className="search" style={{ width: "auto" }} type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} />
                <span style={{ color: "var(--muted)" }}>–</span>
                <input className="search" style={{ width: "auto" }} type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} />
              </div>
            )}
          </div>
          {view === "dashboard" && scope !== "all" && sBranches[0] && (
            <BranchDetail {...{ range: rangeText, branchId: sBranches[0].id, branches: sBranches, rSales: sRSalesT, rPurch: sRPurch, rExp: sRExp, bills: sBillsT, bmap, go: () => {}, onSync: p.onSync, isMobile, hideBack: true }} />
          )}
          {view === "dashboard" && scope === "all" && (
            <Dashboard {...{ range, isCustom, label: rangeText, branches: sBranches, rSales: sRSalesT, rPurch: sRPurch, rExp: sRExp, bills: sBillsT, sales: sSalesT, purchases: sPurchases, products: sProducts, bmap, go, isMobile }} />
          )}
          {view === "customers" && <CustomersPage custAll={sCustAll} bmap={bmap} branches={sBranches} onSync={p.onSync} scope={scope} scopeLabel={scopeLabel} />}
          {view === "ledger" && <LedgerPage custAll={sCustAll} bmap={bmap} onSync={p.onSync} isMobile={isMobile} branches={sBranches} scope={scope} scopeLabel={scopeLabel} />}
          {view === "purchases" && <PurchasesPage rPurch={sRPurch} purchAll={sPurchAll} bmap={bmap} label={rangeText} branches={sBranches} products={sProducts} userId={p.profile.id} onSync={p.onSync} isMobile={isMobile} scope={scope} scopeLabel={scopeLabel} />}
          {view === "inventory" && <InventoryPage products={sProducts} sales={sSales} purchases={sPurchases} branches={sBranches} userId={p.profile.id} onSync={p.onSync} isMobile={isMobile} />}
          {view === "products" && <ProductsPage prodAll={sProdAll} online={p.online} branches={sBranches} onSync={p.onSync} scope={scope} scopeLabel={scopeLabel} isMobile={isMobile} />}
          {view === "saleshistory" && <SalesHistoryPage sales={sRSales} bmap={bmap} branches={sBranches} staffMap={staffMap} isMobile={isMobile} scope={scope} scopeLabel={scopeLabel} />}
          {view === "daybook" && <DaybookPage rSales={sRSalesT} rPurch={sRPurch} rExp={sRExp} bmap={bmap} range={rangeText} branches={sBranches} userId={p.profile.id} onSync={p.onSync} scope={scope} scopeLabel={scopeLabel} />}
          {view === "reports" && <ReportsPage rSales={sRSalesT} rPurch={sRPurch} range={range} isCustom={isCustom} cFrom={cFrom} cTo={cTo} setRange={setRange} setCFrom={setCFrom} setCTo={setCTo} from={from} to={to} branchIds={scopedBranchIds} />}
          {view === "settings" && <SettingsPage settings={settings} onSync={p.onSync} branches={branches} myId={p.profile.id} />}
        </div>
      </div>
      {showSync && <SyncStatusModal shared={p} onClose={() => setShowSync(false)} />}
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

function Kpi({ label, value, delta, icon, color, bg, onClick, active }: { label: string; value: string; delta: { cls: string; txt: string }; icon: string; color: string; bg: string; onClick?: () => void; active?: boolean }) {
  return (
    <div
      className="kpi-card"
      onClick={onClick}
      style={onClick ? { cursor: "pointer", outline: active ? `2px solid ${color}` : undefined, outlineOffset: -2 } : undefined}
    >
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
function BranchDetail({ range, branchId, branches, rSales, rPurch, rExp, bills, bmap, go, onSync, isMobile, hideBack }: any) {
  const b = branches.find((x: any) => x.id === branchId);
  const bs = rSales.filter((s: any) => s.branch_id === branchId);
  const bp = rPurch.filter((s: any) => s.branch_id === branchId);
  const be = rExp.filter((s: any) => s.branch_id === branchId);
  const due = sum(bills.filter((x: any) => x.branch_id === branchId && x.status === "unpaid"), "due_amount");
  const del = async (table: any, id: string, what: string) => { if (confirmDelete(what)) { await softDelete(table, id, "Main Office"); toast("Deleted"); onSync(); } };
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
        {!hideBack && <button className="back" onClick={() => go("dashboard")}>‹ Back</button>}
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
      {!hideBack && <button className="back" onClick={() => go("dashboard")}>‹ Back to overview</button>}
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
function CustomersPage({ custAll, bmap, branches, onSync, scopeLabel }: any) {
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
    else if (confirmDelete("customer")) { await softDelete("customers", c.id, "Main Office"); toast("Deleted"); }
    onSync();
  };
  const realBranches = branches.filter((b: any) => b.id !== "ho");
  const isSplit = realBranches.length > 1;

  const table = (list: any[]) => (
    <div className="table-wrap"><table>
      <thead><tr><th>Name</th><th>Phone</th><th>Branch</th><th className="r">Balance due</th><th className="r"></th></tr></thead>
      <tbody>{list.length ? list.map((c: any) => (
        <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td><span className="b-tag">{bmap[c.branch_id]}</span></td>
          <td className={"r amt " + (c.balance_due > 0 ? "out" : "in")}>{c.balance_due > 0 ? money(c.balance_due) : "Clear"}</td>
          <td className="r" style={{ whiteSpace: "nowrap" }}>
            {!showDeleted && <><button className="edit-btn" onClick={() => setLedger({ branchId: c.branch_id, name: c.name })}>Ledger</button>{" "}
            <button className="edit-btn" onClick={() => setEditC(c)}>Edit</button>{" "}</>}
            <button className={showDeleted ? "pay-btn" : "del-btn"} onClick={() => act(c)}>{showDeleted ? "Restore" : "✕"}</button></td></tr>
      )) : <tr><td colSpan={5}><div className="empty">Nothing here.</div></td></tr>}</tbody>
    </table></div>
  );

  return (
    <><h1 className="page-title">Customers</h1><p className="page-sub">{isSplit ? "All customers across both branches." : `All customers for ${scopeLabel || "this branch"}.`}</p>
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
        {!isSplit && table(rows)}
      </div>
      {isSplit && (
        <>
          <div className="card card-pad" style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700 }}>Combined total balance due</span>
            <b className={sum(rows as any[], "balance_due" as any) > 0 ? "amt out" : "amt in"} style={{ fontSize: 16 }}>{money(sum(rows as any[], "balance_due" as any))}</b>
          </div>
          {realBranches.map((b: any) => {
            const list = rows.filter((c: any) => c.branch_id === b.id);
            return (
              <div className="card" key={b.id} style={{ marginTop: 14 }}>
                <div className="card-head">
                  <h3>{shortBranch(b.name)} Branch — {list.length} {showDeleted ? "deleted" : "customer" + (list.length === 1 ? "" : "s")}</h3>
                  <b className={sum(list as any[], "balance_due" as any) > 0 ? "amt out" : "amt in"}>{money(sum(list as any[], "balance_due" as any))}</b>
                </div>
                {table(list)}
              </div>
            );
          })}
        </>
      )}
      {ledger && <LedgerModal branchId={ledger.branchId} name={ledger.name} onClose={() => setLedger(null)} onSync={onSync} />}
      {editC && <EditCustomerModal customer={editC} onClose={() => setEditC(null)} onSync={onSync} />}
      {addC && <AddCustomerModal branches={branches} onClose={() => setAddC(false)} onSync={onSync} />}</>
  );
}

/* ---------- ledger (all customers, head-office wide) ---------- */
function LedgerPage({ custAll, bmap, onSync, isMobile, branches, scopeLabel }: any) {
  const [q, setQ] = useState("");
  const [ledger, setLedger] = useState<{ branchId: string; name: string } | null>(null);
  let rows = live(custAll);
  if (q.trim()) rows = rows.filter((c: any) => (c.name + (c.phone || "")).toLowerCase().includes(q.toLowerCase()));
  rows = [...rows].sort((a: any, b: any) => b.balance_due - a.balance_due);
  const totalDue = sum(rows as any[], "balance_due" as any);
  const withDue = rows.filter((c: any) => c.balance_due > 0).length;
  const initials2 = (n: string) => n.split(" ").map((s: string) => s[0]).slice(0, 2).join("").toUpperCase();
  const realBranches = (branches || []).filter((b: any) => b.id !== "ho");
  const isSplit = realBranches.length > 1;
  const exportStatement = () => downloadExcel("ledger-statement", ["Name", "Phone", "Branch", "Balance due"], rows.map((c: any) => [c.name, c.phone || "", bmap[c.branch_id] || "", c.balance_due]));

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

  const ledgerTable = (list: any[]) => (
    <div className="table-wrap"><table>
      <thead><tr><th>Name</th><th>Phone</th><th>Branch</th><th className="r">Balance due</th><th className="r"></th></tr></thead>
      <tbody>{list.length ? list.map((c: any) => (
        <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td><span className="b-tag">{bmap[c.branch_id]}</span></td>
          <td className={"r amt " + (c.balance_due > 0 ? "out" : "in")}>{c.balance_due > 0 ? money(c.balance_due) : "Clear"}</td>
          <td className="r"><button className="edit-btn" onClick={() => setLedger({ branchId: c.branch_id, name: c.name })}>View ledger</button></td></tr>
      )) : <tr><td colSpan={5}><div className="empty">No customers yet.</div></td></tr>}</tbody>
    </table></div>
  );

  return (
    <><h1 className="page-title">Ledger</h1><p className="page-sub">{isSplit ? "Customer balances (udhaar) across both branches." : `Customer balances (udhaar) for ${scopeLabel || "this branch"}.`}</p>
      <div className="kpi-grid-3">
        <Kpi label="Customers" value={String(rows.length)} delta={{ cls: "up", txt: isSplit ? "all branches" : scopeLabel }} icon="customers" color="var(--accent)" bg="var(--accent-soft)" />
        <Kpi label="With dues" value={String(withDue)} delta={{ cls: withDue > 0 ? "down" : "up", txt: "need follow-up" }} icon="bill" color="var(--amber)" bg="var(--amber-soft)" />
        <Kpi label="Total outstanding" value={money(totalDue)} delta={{ cls: totalDue > 0 ? "down" : "up", txt: "across ledger" }} icon="book" color="var(--red)" bg="var(--red-soft)" />
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Customer balances</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="edit-btn" onClick={exportStatement}>Export statement</button>
          </div>
        </div>
        {!isSplit && ledgerTable(rows)}
      </div>
      {isSplit && realBranches.map((b: any) => {
        const list = rows.filter((c: any) => c.branch_id === b.id);
        return (
          <div className="card" key={b.id} style={{ marginTop: 14 }}>
            <div className="card-head">
              <h3>{shortBranch(b.name)} Branch — {list.length} customer{list.length === 1 ? "" : "s"}</h3>
              <b className={sum(list as any[], "balance_due" as any) > 0 ? "amt out" : "amt in"}>{money(sum(list as any[], "balance_due" as any))}</b>
            </div>
            {ledgerTable(list)}
          </div>
        );
      })}
      {ledger && <LedgerModal branchId={ledger.branchId} name={ledger.name} onClose={() => setLedger(null)} onSync={onSync} />}</>
  );
}

/* ---------- products (catalog & pricing) ---------- */
function ProductsPage({ prodAll, online, branches, onSync, scope, scopeLabel, isMobile }: any) {
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [q, setQ] = useState("");
  const blank: Partial<Product> = { name: "", unit: "pcs", sale_price: 0, cost_price: 0, low_stock_at: 5 };
  let rows: Product[] = showDeleted ? deletedOnly(prodAll) : live(prodAll);
  if (q.trim()) rows = rows.filter((pr) => pr.name.toLowerCase().includes(q.toLowerCase()));

  const save = async () => {
    if (!edit?.name?.trim()) return toast("Enter a product name");
    await saveProduct({ ...edit, edited_note: "Main Office edited this" } as any);
    toast("Product saved" + (online ? "" : " offline")); setEdit(null); onSync();
  };
  const delProd = async (pr: Product) => { if (confirmDelete("product")) { await softDelete("products", pr.id, "Main Office"); toast("Deleted"); onSync(); } };
  const restoreProd = async (pr: Product) => { await restoreRow("products", pr.id); toast("Restored"); onSync(); };
  const realBranches = branches.filter((b: any) => b.id !== "ho");
  const isSplit = scope === "all" && realBranches.length > 1;

  const catalogValue = (list: Product[]) => list.reduce((a, pr) => a + (pr.sale_price || 0), 0);

  const prodTable = (list: Product[]) => (
    <div className="table-wrap"><table>
      <thead><tr><th>Product</th><th>Branch</th><th>Unit</th><th className="r">Cost</th><th className="r">Piece price</th><th className="r">Box price</th><th className="r">Low ≤</th><th className="r"></th></tr></thead>
      <tbody>
        {list.length ? list.map((pr: Product) => (
          <tr key={pr.id}>
            <td>{pr.name}{pr.edited_note && <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 2 }}>{pr.edited_note}</div>}</td>
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
  );

  // Phones get cards, not the 8-column table — the table forces horizontal
  // scroll no matter how much CSS wrapping is applied to the header row.
  const prodCards = (list: Product[]) => (
    list.length ? list.map((pr: Product) => (
      <div className="card card-pad" key={pr.id} style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="main" style={{ fontWeight: 700 }}>{pr.name}</div>
            <div className="sub">{pr.unit}{pr.branch_id ? " · " + (branches.find((b: any) => b.id === pr.branch_id)?.name.replace(" Branch", "") || pr.branch_id) : " · All branches"}</div>
            {pr.edited_note && <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 2 }}>{pr.edited_note}</div>}
          </div>
          {showDeleted
            ? <button className="pay-btn" onClick={() => restoreProd(pr)}>Restore</button>
            : <div style={{ display: "flex", gap: 6, flexShrink: 0 }}><button className="edit-btn" onClick={() => setEdit({ ...pr })}>Edit</button><button className="del-btn" onClick={() => delProd(pr)}>✕</button></div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: pr.pieces_per_box ? "1fr 1fr 1fr" : "1fr 1fr", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
          <div><div style={{ fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Cost</div><div style={{ fontWeight: 600, fontSize: 13.5 }}>{money(pr.cost_price)}</div></div>
          <div><div style={{ fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Piece price</div><div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--green)" }}>{money(pr.sale_price)}</div></div>
          {pr.pieces_per_box ? <div><div style={{ fontSize: 10, color: "var(--faint)", textTransform: "uppercase" }}>Box price</div><div style={{ fontWeight: 600, fontSize: 13.5 }}>{pr.box_price ? money(pr.box_price) : "—"}</div></div> : null}
        </div>
      </div>
    )) : <div className="card card-pad"><div className="empty">Nothing here.</div></div>
  );

  const listView = (list: Product[]) => isMobile ? prodCards(list) : prodTable(list);

  return (
    <><h1 className="page-title">Products</h1><p className="page-sub">{isSplit ? "Catalog, pricing & branch assignment." : `Catalog & pricing for ${scopeLabel || "this branch"}.`}</p>
      {!isSplit && (
        <>
          <div className={isMobile ? "" : "card"}>
            <div className={isMobile ? "" : "card-head"} style={isMobile ? { marginBottom: 12 } : undefined}>
              {!isMobile && <h3>{rows.length} {showDeleted ? "deleted" : "product" + (rows.length === 1 ? "" : "s")}</h3>}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input className="search" style={isMobile ? { flex: 1 } : undefined} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
                <button className="edit-btn" onClick={() => setShowDeleted((v) => !v)}>{showDeleted ? "← Active" : "Deleted"}</button>
                {!showDeleted && <button className="add-btn" onClick={() => setEdit({ ...blank })}>+ Add product</button>}
              </div>
            </div>
            {isMobile && <div className="sub" style={{ margin: "8px 0 12px" }}>{rows.length} {showDeleted ? "deleted" : "product" + (rows.length === 1 ? "" : "s")}</div>}
            {listView(rows)}
          </div>
        </>
      )}
      {isSplit && (
        <>
          <div className="card card-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <span style={{ fontWeight: 700 }}>{rows.length} {showDeleted ? "deleted" : "product" + (rows.length === 1 ? "" : "s")} · combined catalog value {money(catalogValue(rows))}</span>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input className="search" style={isMobile ? { flex: 1 } : undefined} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="edit-btn" onClick={() => setShowDeleted((v) => !v)}>{showDeleted ? "← Active" : "Deleted"}</button>
              {!showDeleted && <button className="add-btn" onClick={() => setEdit({ ...blank })}>+ Add product</button>}
            </div>
          </div>
          {realBranches.map((b: any) => {
            const list = rows.filter((pr) => pr.branch_id === b.id);
            return (
              <div key={b.id} style={{ marginTop: 14 }}>
                <div className={isMobile ? "sub" : "card-head"} style={isMobile ? { fontWeight: 700, margin: "0 0 8px" } : { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "12px 12px 0 0", padding: "14px 16px" }}>
                  <h3 style={isMobile ? undefined : { margin: 0 }}>{shortBranch(b.name)} Branch — {list.length} product{list.length === 1 ? "" : "s"}</h3>
                  {!isMobile && <b>{money(catalogValue(list))}</b>}
                </div>
                <div className={isMobile ? "" : "card"} style={isMobile ? undefined : { borderTop: "none", borderRadius: "0 0 12px 12px" }}>
                  {listView(list)}
                </div>
              </div>
            );
          })}
          {(() => {
            const shared = rows.filter((pr) => !pr.branch_id);
            return (
              <div style={{ marginTop: 14 }}>
                <div className={isMobile ? "sub" : "card-head"} style={isMobile ? { fontWeight: 700, margin: "0 0 8px" } : { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "12px 12px 0 0", padding: "14px 16px" }}>
                  <h3 style={isMobile ? undefined : { margin: 0 }}>Shared (all branches) — {shared.length} product{shared.length === 1 ? "" : "s"}</h3>
                  {!isMobile && <b>{money(catalogValue(shared))}</b>}
                </div>
                <div className={isMobile ? "" : "card"} style={isMobile ? undefined : { borderTop: "none", borderRadius: "0 0 12px 12px" }}>
                  {listView(shared)}
                </div>
              </div>
            );
          })()}
        </>
      )}
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
function PurchasesPage({ rPurch, purchAll, bmap, label, branches, products, userId, onSync, isMobile, scopeLabel }: any) {
  const [showDeleted, setShowDeleted] = useState(false);
  const [branchF, setBranchF] = useState("all");
  const [q, setQ] = useState("");
  const [editRow, setEditRow] = useState<any>(null);
  const [addP, setAddP] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const brs = branches.filter((b: any) => b.id !== "ho");
  const isSplit = brs.length > 1 && branchF === "all";

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
    else if (confirmDelete("purchase")) { await softDelete("purchases", x.id, "Main Office"); toast("Deleted"); }
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

  const purchTable = (list: any[]) => (
    <div className="table-wrap"><table>
      <thead><tr><th>Date</th><th>Branch</th><th>Supplier</th><th>Item</th><th className="r">Qty</th><th className="r">Cost each</th><th className="r">Total</th><th>Bill no</th><th>Pay</th><th className="r"></th></tr></thead>
      <tbody>{list.length ? list.slice(0, 300).map((x: any) => (
        <tr key={x.id}><td>{dateStr(x.created_at)}</td><td><span className="b-tag">{bmap[x.branch_id]}</span></td>
          <td>{x.supplier || "—"}</td><td>{x.product_name}{x.note ? <div style={{ color: "var(--faint)", fontSize: 11 }}>{x.note}</div> : null}</td>
          <td className="r">{x.qty}</td><td className="r">{money(x.cost)}</td><td className="r amt out">{money(x.total)}</td>
          <td>{x.invoice_no || "—"}</td><td><span className="badge role">{(x.payment_mode || "cash").toUpperCase()}</span></td>
          <td className="r" style={{ whiteSpace: "nowrap" }}>
            <button className="edit-btn" onClick={() => setPreview(x)}>View</button>{" "}
            {!showDeleted && <button className="edit-btn" onClick={() => setEditRow(x)}>Edit</button>}{" "}
            <button className={showDeleted ? "pay-btn" : "del-btn"} onClick={() => act(x)}>{showDeleted ? "Restore" : "✕"}</button></td></tr>
      )) : <tr><td colSpan={10}><div className="empty">Nothing here.</div></td></tr>}</tbody>
    </table></div>
  );

  return (
    <><h1 className="page-title">Purchases</h1><p className="page-sub">{isSplit ? "What each branch bought, from whom, when" : `What ${scopeLabel || "this branch"} bought, from whom, when`} · {showDeleted ? "deleted items" : String(label).toLowerCase()}.</p>
      <div className="kpi-grid-3">
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
        {!isSplit && purchTable(rows)}
      </div>
      {isSplit && brs.map((b: any) => {
        const list = rows.filter((x: any) => x.branch_id === b.id);
        return (
          <div className="card" key={b.id} style={{ marginTop: 14 }}>
            <div className="card-head">
              <h3>{shortBranch(b.name)} Branch — {list.length} entr{list.length === 1 ? "y" : "ies"}</h3>
              <b className="amt out">{money(list.reduce((a: number, x: any) => a + x.total, 0))}</b>
            </div>
            {purchTable(list)}
          </div>
        );
      })}
      {editRow && <EditEntryModal table="purchases" row={editRow} onClose={() => setEditRow(null)} onSync={onSync} />}
      {addP && <AddPurchaseModal branches={branches} products={products} userId={userId} onClose={() => setAddP(false)} onSync={onSync} />}
      {preview && (
        <Modal title={`Purchase — ${preview.product_name}`} onClose={() => setPreview(null)}>
          <div className="form-grid">
            <div className="row"><span className="sub">Branch</span><span className="b-tag">{bmap[preview.branch_id]}</span></div>
            <div className="row"><span className="sub">Date</span><b>{dateStr(preview.created_at)}</b></div>
            <div className="row"><span className="sub">Supplier</span><b>{preview.supplier || "—"}</b></div>
            <div className="row"><span className="sub">Quantity</span><b>{preview.qty}</b></div>
            <div className="row"><span className="sub">Cost per unit</span><b>{money(preview.cost)}</b></div>
            <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}><b>Total</b><b style={{ color: "var(--accent)" }}>{money(preview.total)}</b></div>
            <div className="row"><span className="sub">Invoice no</span><b>{preview.invoice_no || "—"}</b></div>
            <div className="row"><span className="sub">Payment mode</span><b>{(preview.payment_mode || "cash").toUpperCase()}</b></div>
            {preview.note && <div className="row"><span className="sub">Note</span><b>{preview.note}</b></div>}
            <div className="btn-row"><button className="btn ghost" onClick={() => setPreview(null)}>Close</button></div>
          </div>
        </Modal>
      )}</>
  );
}

/* ---------- inventory ---------- */
function InventoryPage({ products, sales, purchases, branches, userId, onSync, isMobile }: any) {
  const brs = branches.filter((b: any) => b.id !== "ho");
  const [adj, setAdj] = useState<any>(null);
  const [branchId, setBranchId] = useState(brs[0]?.id || "");
  const [delta, setDelta] = useState(0);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "out" | "low" | "in">("");

  const doAdjust = async () => {
    if (!delta) return toast("Enter a +/- quantity");
    await addStockAdjustment(branchId, userId, { id: adj.id, name: adj.name }, Number(delta), "Manual adjustment");
    toast("Stock adjusted"); setAdj(null); setDelta(0); onSync();
  };

  const statusOf = (pr: any) => {
    const total = brs.reduce((s: number, b: any) => s + computeStock(pr.id, b.id, sales, purchases), 0);
    if (total <= 0) return "out";
    if (total <= (pr.low_stock_at ?? 5)) return "low";
    return "in";
  };
  const byStatus = (list: any[]) => statusFilter ? list.filter((pr: any) => statusOf(pr) === statusFilter) : list;

  if (isMobile) {
    const rows = byStatus(products.filter((pr: any) => pr.name.toLowerCase().includes(q.toLowerCase())));
    const globalValue = rows.reduce((a: number, pr: any) => a + brs.reduce((s: number, b: any) => s + computeStock(pr.id, b.id, sales, purchases), 0) * pr.sale_price, 0);
    return (
      <>
        <input className="search" style={{ width: "100%", marginBottom: 14 }} placeholder="Search inventory…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ background: "var(--accent)", color: "#fff", borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".6px", opacity: .85 }}>Global Stock Value</span>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{money(globalValue)}</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {([["", "All"], ["in", "In Stock"], ["low", "Low Stock"], ["out", "Out of Stock"]] as const).map(([k, label]) => (
            <button key={k} className={statusFilter === k ? "btn" : "btn ghost"} style={{ width: "auto", padding: "7px 14px", fontSize: 12.5 }} onClick={() => setStatusFilter(k)}>{label}</button>
          ))}
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
                {brs.length > 1
                  ? <div className="field"><label>Branch</label><select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{brs.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
                  : <div className="field"><label>Branch</label><div style={{ padding: "12px 13px", borderRadius: 10, background: "var(--surface-2)", fontWeight: 600, fontSize: 14 }}>{brs[0]?.name || "—"}</div></div>}
                <div className="field"><label>Change (+ add / − remove)</label><input type="number" inputMode="numeric" value={delta} onChange={(e) => setDelta(+e.target.value)} placeholder="e.g. 10 or -3" /></div>
              </div>
              <div className="btn-row"><button className="btn ghost" onClick={() => setAdj(null)}>Cancel</button><button className="btn" onClick={doAdjust}>Save adjustment</button></div>
            </div>
          </Modal>
        )}
      </>
    );
  }

  return (
    <><h1 className="page-title">Inventory</h1><p className="page-sub">Live stock per branch (purchases in − sales out). Adjust for opening stock or wastage. Tap a card below to filter.</p>
      <div className="kpi-grid">
        <Kpi label="Total SKU Items" value={String(products.length)} delta={{ cls: "up", txt: "across catalog" }} icon="boxIcon" color="var(--accent)" bg="var(--accent-soft)" onClick={() => setStatusFilter("")} active={statusFilter === ""} />
        <Kpi label="In Stock" value={String(products.filter((pr: any) => statusOf(pr) === "in").length)} delta={{ cls: "up", txt: "healthy" }} icon="check" color="var(--green)" bg="var(--green-soft)" onClick={() => setStatusFilter(statusFilter === "in" ? "" : "in")} active={statusFilter === "in"} />
        <Kpi label="Low Stock" value={String(products.filter((pr: any) => statusOf(pr) === "low").length)} delta={{ cls: "down", txt: "items" }} icon="warning" color="var(--amber)" bg="var(--amber-soft)" onClick={() => setStatusFilter(statusFilter === "low" ? "" : "low")} active={statusFilter === "low"} />
        <Kpi label="Out of Stock" value={String(products.filter((pr: any) => statusOf(pr) === "out").length)} delta={{ cls: "down", txt: "items" }} icon="warning" color="var(--red)" bg="var(--red-soft)" onClick={() => setStatusFilter(statusFilter === "out" ? "" : "out")} active={statusFilter === "out"} />
      </div>
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>Product</th>{brs.map((b: any) => <th key={b.id} className="r">{shortBranch(b.name)}</th>)}<th className="r">Total</th><th className="r"></th></tr></thead>
        <tbody>
          {byStatus(products).length ? byStatus(products).map((pr: any) => {
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
              {brs.length > 1
                ? <div className="field"><label>Branch</label><select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{brs.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
                : <div className="field"><label>Branch</label><div style={{ padding: "12px 13px", borderRadius: 10, background: "var(--surface-2)", fontWeight: 600, fontSize: 14 }}>{brs[0]?.name || "—"}</div></div>}
              <div className="field"><label>Change (+ add / − remove)</label><input type="number" inputMode="numeric" value={delta} onChange={(e) => setDelta(+e.target.value)} placeholder="e.g. 10 or -3" /></div>
            </div>
            <div className="btn-row"><button className="btn ghost" onClick={() => setAdj(null)}>Cancel</button><button className="btn" onClick={doAdjust}>Save adjustment</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------- sales / bill history ---------- */
/** Digital invoice / receipt preview for one grouped bill. */
function BillInvoiceModal({ g, bmap, staffMap, onClose }: any) {
  return (
    <Modal title={g.key.startsWith("B-") ? g.key : "Bill Receipt"} onClose={onClose}>
      <div className="form-grid">
        {g.voided && <div style={{ background: "var(--red-soft)", color: "var(--red)", padding: "8px 12px", borderRadius: 10, fontSize: 13, fontWeight: 700 }}>This bill was voided — it no longer counts toward any totals.</div>}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
          <span>{g.cust}</span><span>{dateStr(g.t)} · {timeStr(g.t)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--muted)" }}>
          <span className="b-tag">{bmap[g.br]}</span>
          <span>{g.pay.toUpperCase()} · {staffMap[g.staff] || "staff"}</span>
        </div>
        <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", marginTop: 4 }}>
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
              {g.items.map((s: any) => (
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
          <b>Total</b><b style={{ color: "var(--accent)", textDecoration: g.voided ? "line-through" : undefined }}>{money(g.total)}</b>
        </div>
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  );
}

function SalesHistoryPage({ sales, bmap, branches, staffMap, isMobile, scope, scopeLabel }: any) {
  const [payFilter, setPayFilter] = useState<"all" | "cash" | "upi" | "credit">("all");
  const [q, setQ] = useState("");
  const [view, setView] = useState<any>(null);
  const realBranches = branches.filter((b: any) => b.id !== "ho");
  const isSplit = scope === "all" && realBranches.length > 1;

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
          <div className="card card-pad" key={g.key} style={{ marginBottom: 10, opacity: g.voided ? .55 : 1, cursor: "pointer" }} onClick={() => setView(g)}>
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
        {view && <BillInvoiceModal g={view} bmap={bmap} staffMap={staffMap} onClose={() => setView(null)} />}
      </>
    );
  }

  const billsTable = (list: any[]) => (
    <div className="table-wrap"><table>
      <thead><tr><th>Bill</th><th>Date</th><th>Branch</th><th>Customer</th><th>Payment</th><th>Staff</th><th className="r">Total</th><th className="r"></th></tr></thead>
      <tbody>{list.length ? list.map((g) => (
        <tr key={g.key} style={{ opacity: g.voided ? .55 : 1 }}>
          <td style={{ textDecoration: g.voided ? "line-through" : undefined }}>{g.key.startsWith("B-") ? g.key : "—"}<div style={{ color: "var(--faint)", fontSize: 11 }}>{g.items.length} item{g.items.length === 1 ? "" : "s"}</div></td>
          <td>{dateStr(g.t)} {timeStr(g.t)}</td><td><span className="b-tag">{bmap[g.br]}</span></td>
          <td>{g.cust}</td><td><span className={"badge " + (g.voided ? "void" : "role")}>{g.voided ? "VOID" : g.pay.toUpperCase()}</span></td><td>{staffMap[g.staff] || "—"}</td>
          <td className="r amt in" style={{ textDecoration: g.voided ? "line-through" : undefined }}>{money(g.total)}</td>
          <td className="r"><button className="edit-btn" onClick={() => setView(g)}>View bill</button></td>
        </tr>
      )) : <tr><td colSpan={8}><div className="empty">No bills in this period.</div></td></tr>}</tbody>
    </table></div>
  );

  return (
    <><h1 className="page-title">Sales / Bill History</h1><p className="page-sub">{isSplit ? "Every bill across both branches." : `Every bill for ${scopeLabel || "this branch"}.`}</p>
      <div className="kpi-grid-3">
        <Kpi label="Total Revenue" value={money(bills.reduce((a, g) => a + g.total, 0))} delta={{ cls: "up", txt: "this view" }} icon="sales" color="var(--accent)" bg="var(--accent-soft)" />
        <Kpi label="Total Bills" value={String(bills.length)} delta={{ cls: "up", txt: "records" }} icon="bill" color="var(--green)" bg="var(--green-soft)" />
        <Kpi label="Branches Covered" value={String(new Set(bills.map((g) => g.br)).size)} delta={{ cls: "up", txt: "active" }} icon="branch" color="var(--amber)" bg="var(--amber-soft)" />
      </div>
      <div className="card">
        <div className="card-head">
          <div className="seg">{(["all", "cash", "upi", "credit"] as const).map((m) => <button key={m} className={payFilter === m ? "active" : ""} onClick={() => setPayFilter(m)}>{m === "all" ? "All" : m.toUpperCase()}</button>)}</div>
          <button className="edit-btn" onClick={exportCsv}>Export CSV</button>
        </div>
        {!isSplit && billsTable(bills)}
      </div>
      {isSplit && realBranches.map((b: any) => {
        const list = bills.filter((g) => g.br === b.id);
        return (
          <div className="card" key={b.id} style={{ marginTop: 14 }}>
            <div className="card-head">
              <h3>{shortBranch(b.name)} Branch — {list.length} bill{list.length === 1 ? "" : "s"}</h3>
              <b className="amt in">{money(list.reduce((a, g) => a + g.total, 0))}</b>
            </div>
            {billsTable(list)}
          </div>
        );
      })}
      {view && <BillInvoiceModal g={view} bmap={bmap} staffMap={staffMap} onClose={() => setView(null)} />}</>
  );
}

/* ---------- day book ---------- */
function DaybookPage({ rSales, rPurch, rExp, bmap, range, branches, userId, onSync, scope, scopeLabel }: any) {
  const [editRow, setEditRow] = useState<{ table: any; row: any } | null>(null);
  const [addE, setAddE] = useState(false);
  const inT = sum(rSales, "total"), outP = sum(rPurch, "total"), outE = sum(rExp, "amount");
  const del = async (table: any, id: string, what: string) => { if (confirmDelete(what)) { await softDelete(table, id, "Main Office"); toast("Deleted"); onSync(); } };
  const items = [
    ...rSales.map((s: any) => ({ table: "sales", id: s.id, row: s, t: s.created_at, br: s.branch_id, label: `Sale · ${s.product_name} × ${s.qty}`, amt: s.total, dir: "in", what: "sale" })),
    ...rPurch.map((x: any) => ({ table: "purchases", id: x.id, row: x, t: x.created_at, br: x.branch_id, label: `Purchase · ${x.product_name} × ${x.qty}`, amt: x.total, dir: "out", what: "purchase" })),
    ...rExp.map((x: any) => ({ table: "expenses", id: x.id, row: x, t: x.created_at, br: x.branch_id, label: `Expense · ${x.category}`, amt: x.amount, dir: "out", what: "expense" })),
  ].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime());
  const exportCsv = () => downloadExcel("daybook", ["Date", "Time", "Branch", "Detail", "In/Out", "Amount"],
    items.map((i: any) => [dateStr(i.t), timeStr(i.t), bmap[i.br] || "", i.label, i.dir === "in" ? "IN" : "OUT", i.amt]));
  const realBranches = branches.filter((b: any) => b.id !== "ho");
  const isSplit = scope === "all" && realBranches.length > 1;

  const dayTable = (list: any[]) => (
    <div className="table-wrap"><table>
      <thead><tr><th>When</th><th>Branch</th><th>Detail</th><th className="r">Amount</th><th className="r"></th></tr></thead>
      <tbody>{list.slice(0, 200).map((i: any) => (
        <tr key={i.id}><td>{dateStr(i.t)} {timeStr(i.t)}</td><td><span className="b-tag">{bmap[i.br]}</span></td>
          <td>{i.label}</td><td className={"r amt " + i.dir}>{i.dir === "in" ? "+" : "−"}{money(i.amt)}</td>
          <td className="r" style={{ whiteSpace: "nowrap" }}><button className="edit-btn" onClick={() => setEditRow({ table: i.table, row: i.row })}>Edit</button> <button className="del-btn" onClick={() => del(i.table, i.id, i.what)}>✕</button></td></tr>
      ))}</tbody>
    </table></div>
  );

  return (
    <><h1 className="page-title">Day Book</h1><p className="page-sub">{isSplit ? "Combined money in & out" : `Money in & out for ${scopeLabel || "this branch"}`} · {rangeLabel(range).toLowerCase()}.</p>
      <div className="stats">
        <div className="stat"><div className="label">Money in</div><div className="value" style={{ color: "var(--green)" }}>{money(inT)}</div></div>
        <div className="stat"><div className="label">Purchases</div><div className="value">{money(outP)}</div></div>
        <div className="stat"><div className="label">Expenses</div><div className="value" style={{ color: "var(--red)" }}>{money(outE)}</div></div>
        <div className="stat"><div className="label">Net</div><div className="value">{money(inT - outP - outE)}</div></div>
      </div>
      <div className="card">
        <div className="card-head"><h3>All entries ({items.length})</h3>
          <div style={{ display: "flex", gap: 8 }}><button className="edit-btn" onClick={exportCsv}>Export Excel</button><button className="add-btn" onClick={() => setAddE(true)}>+ Add expense</button></div></div>
        {!isSplit && dayTable(items)}
      </div>
      {isSplit && realBranches.map((b: any) => {
        const list = items.filter((i) => i.br === b.id);
        const bIn = sum(list.filter((i) => i.dir === "in"), "amt" as any);
        const bOut = sum(list.filter((i) => i.dir === "out"), "amt" as any);
        return (
          <div className="card" key={b.id} style={{ marginTop: 14 }}>
            <div className="card-head">
              <h3>{shortBranch(b.name)} Branch — {list.length} entries</h3>
              <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
                <span>In <b className="amt in">{money(bIn)}</b></span>
                <span>Out <b className="amt out">{money(bOut)}</b></span>
              </div>
            </div>
            {dayTable(list)}
          </div>
        );
      })}
      {editRow && <EditEntryModal table={editRow.table} row={editRow.row} onClose={() => setEditRow(null)} onSync={onSync} />}
      {addE && <AddExpenseModal branches={branches} userId={userId} onClose={() => setAddE(false)} onSync={onSync} />}</>
  );
}

/* ---------- reports ----------
 * Kept deliberately simple per owner request: pick a period (today / week /
 * month / custom), see total sell + total purchase for that period, and
 * export a statement. No charts/leaderboards. */
function ReportsPage({ rSales, rPurch, range, isCustom, cFrom, cTo, setRange, setCFrom, setCTo, from, to, branchIds }: any) {
  const totalSell = sum(rSales, "total");
  const totalPurchase = sum(rPurch, "total");
  const [exporting, setExporting] = useState(false);
  // Local cache only keeps the most recent ~2000 rows per table — fine for
  // the KPI totals above (recent data), but a statement export must be
  // complete even for an older custom range, so it fetches fresh from the
  // server for the exact window instead of trusting the capped local copy.
  const exportStatement = async () => {
    setExporting(true);
    try {
      const [sales, purch] = await Promise.all([
        fetchRangeFresh<any>("sales", from, to, branchIds),
        fetchRangeFresh<any>("purchases", from, to, branchIds),
      ]);
      const rows = [
        ...sales.filter((s) => !s.deleted_at && !s.void_at).map((s) => [dateStr(s.created_at), timeStr(s.created_at), "Sale", s.product_name, s.qty, money(s.total)]),
        ...purch.filter((x) => !x.deleted_at).map((x) => [dateStr(x.created_at), timeStr(x.created_at), "Purchase", x.product_name, x.qty, money(x.total)]),
      ].sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
      downloadExcel("statement", ["Date", "Time", "Type", "Item", "Qty", "Amount"], rows);
    } catch (e: any) {
      toast("Could not export — " + (e?.message || "please try again"));
    } finally {
      setExporting(false);
    }
  };
  return (
    <><h1 className="page-title">Reports</h1><p className="page-sub">Sell & purchase summary · {rangeLabel(range).toLowerCase()}.</p>
      <div className="seg" style={{ marginBottom: 16 }}>
        {(["today", "week", "month"] as Range[]).map((r) => (
          <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>{rangeLabel(r)}</button>
        ))}
        <button className={isCustom ? "active" : ""} onClick={() => setRange("custom")}>Custom</button>
      </div>
      {isCustom && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <input className="search" type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} />
          <span style={{ color: "var(--muted)" }}>–</span>
          <input className="search" type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} />
        </div>
      )}
      <div className="grid-2">
        <div className="card card-pad">
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".4px" }}>Total Sell</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "var(--green)", marginTop: 6 }}>{money(totalSell)}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{rSales.length} bill{rSales.length === 1 ? "" : "s"}</div>
        </div>
        <div className="card card-pad">
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".4px" }}>Total Purchase</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "var(--accent)", marginTop: 6 }}>{money(totalPurchase)}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{rPurch.length} entr{rPurch.length === 1 ? "y" : "ies"}</div>
        </div>
      </div>
      <button className="btn" style={{ width: "auto", padding: "11px 20px", marginTop: 16 }} onClick={exportStatement} disabled={exporting}>{exporting ? "Preparing…" : "Export statement (Excel)"}</button>
    </>
  );
}

/* ---------- settings ---------- */
function SettingsPage({ settings, onSync, branches, myId }: any) {
  const [co, setCo] = useState<Settings>(settings ?? { id: "main", company: "", address: "", phone: "", gstin: "", footer: "" });
  useEffect(() => { if (settings) setCo(settings); }, [settings]);
  const saveCo = async () => {
    const res = await saveSettings({ ...co, id: "main" }, true);
    toast(res.ok ? "Company profile saved" : `Could not save — ${res.error || "unknown error"}`);
    onSync();
  };

  return (
    <><h1 className="page-title">Settings</h1><p className="page-sub">Company profile & account management.</p>

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
        <ManageAccounts branches={branches} myId={myId} />
        <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "12px 0 0" }}>Needs the <b>admin-list-accounts</b>, <b>admin-update-account</b> and <b>admin-create-staff</b> Edge Functions deployed (see DEPLOY.md). Branch-level access is enforced by the database (RLS).</p>
      </div>
    </>
  );
}
