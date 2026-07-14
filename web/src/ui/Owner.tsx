import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localdb, pendingCount } from "../lib/db";
import { Icon } from "../lib/icons";
import { money, dateStr, timeStr, initials, rangeStart, prevRange, rangeLabel, pctDelta } from "../lib/format";
import type { Range, Product, Settings } from "../lib/types";
import { sum, topItems, shortBranch, live, deletedOnly, computeStock, type SharedProps } from "./shared";
import { Modal } from "./Modal";
import { toast } from "./Toast";
import { ChangePasswordModal, ResetStaffPassword, StaffManager } from "./Account";
import { saveProduct, softDelete, restoreRow, saveSettings, addStockAdjustment } from "../lib/writes";
import { LedgerModal } from "./Ledger";
import { EditCustomerModal, EditEntryModal } from "./Edits";
import { downloadExcel } from "../lib/excel";
import { printItemizedBill } from "../lib/invoice";
import { supabase } from "../lib/supabase";
import { BarChart, Donut } from "./Charts";
import { AddCustomerModal, AddExpenseModal, AddPurchaseModal } from "./OwnerAdd";

type View = "dashboard" | "branch" | "customers" | "ledger" | "purchases" | "inventory" | "products" | "saleshistory" | "daybook" | "reports" | "settings";
type ORange = Range | "custom";
const between = (rows: any[], from: number, to: number) => rows.filter((r) => { const t = new Date(r.created_at).getTime(); return t >= from && t <= to; });
const inRange = (rows: any[], from: number) => rows.filter((r) => new Date(r.created_at).getTime() >= from);
const confirmDelete = (what: string) => window.confirm(`Delete this ${what}? It moves to deleted items and can be restored.`);

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
  const [range, setRange] = useState<ORange>("today");
  const [cFrom, setCFrom] = useState(new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [cTo, setCTo] = useState(new Date().toISOString().slice(0, 10));
  const [view, setView] = useState<View>("dashboard");
  const [branchId, setBranchId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

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
      <aside className={"sidebar" + (open ? " open" : "")}>
        <div className="brand"><img src="/icon.svg" alt="" /><div><b>{settings?.company || "BranchManager"}</b><span>Head Office Admin</span></div></div>
        {navItems.map(([key, label, ic], i) => (
          <div key={key}>
            {i === 1 && <div className="nav-sep" />}
            <button className={"nav-item" + (activeKey === key ? " active" : "")}
              onClick={() => key.startsWith("branch:") ? go("branch", key.split(":")[1]) : go(key as View)}>
              <Icon name={ic} /><span>{label}</span>
            </button>
          </div>
        ))}
        <div className="foot">Live · Supabase</div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <div className="header">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button className="hbtn hide-desktop" onClick={() => setOpen(true)}><Icon name="menu" /></button>
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
          <div className="header-right">
            <span className={"sync-pill " + (pending > 0 ? "pending" : "ok")}><span className="dot" />{pending > 0 ? `${pending} to sync` : "All synced"}</span>
            <button className={"net-toggle " + (p.online ? "online" : "offline")} onClick={p.onToggleOnline}>{p.online ? "Online" : "Offline"}</button>
            <button className="hbtn" onClick={p.onLogout} title="Sign out"><Icon name="settings" size={18} /></button>
            <div className="avatar" title={p.profile.name}>{initials(p.profile.name)}</div>
          </div>
        </div>

        <div className="content">
          {view === "dashboard" && <Dashboard {...{ range, isCustom, label: rangeText, branches, rSales, rPurch, rExp, bills, sales, purchases, products, bmap, go }} />}
          {view === "branch" && branchId && <BranchDetail {...{ range: rangeText, branchId, branches, rSales, rPurch, rExp, bills, bmap, go, onSync: p.onSync }} />}
          {view === "customers" && <CustomersPage custAll={custAll} bmap={bmap} branches={branches} onSync={p.onSync} />}
          {view === "ledger" && <LedgerPage custAll={custAll} bmap={bmap} onSync={p.onSync} />}
          {view === "purchases" && <PurchasesPage rPurch={rPurch} purchAll={purchAll} bmap={bmap} label={rangeText} branches={branches} products={products} userId={p.profile.id} onSync={p.onSync} />}
          {view === "inventory" && <InventoryPage products={products} sales={sales} purchases={purchases} branches={branches} userId={p.profile.id} onSync={p.onSync} />}
          {view === "products" && <ProductsPage prodAll={prodAll} online={p.online} branches={branches} onSync={p.onSync} />}
          {view === "saleshistory" && <SalesHistoryPage sales={rSales} bmap={bmap} settings={settings} branches={branches} staffMap={staffMap} />}
          {view === "daybook" && <DaybookPage rSales={rSales} rPurch={rPurch} rExp={rExp} bmap={bmap} range={rangeText} branches={branches} userId={p.profile.id} onSync={p.onSync} />}
          {view === "reports" && <ReportsPage rSales={rSales} range={rangeText} staffMap={staffMap} />}
          {view === "settings" && <SettingsPage settings={settings} onSync={p.onSync} branches={branches} />}
        </div>
      </div>
    </div>
  );
}

/* ---------- dashboard ---------- */
function Dashboard({ range, isCustom, label, branches, rSales, rPurch, rExp, bills, sales, purchases, products, bmap, go }: any) {
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

  // low stock across branches
  const low: { name: string; branch: string; qty: number }[] = [];
  for (const b of branches.filter((x: any) => x.id !== "ho"))
    for (const pr2 of products) {
      const qty = computeStock(pr2.id, b.id, sales, purchases);
      if (qty <= (pr2.low_stock_at ?? 5)) low.push({ name: pr2.name, branch: shortBranch(b.name), qty });
    }

  return (
    <>
      <h1 className="page-title">Head Office Overview</h1>
      <p className="page-sub">Aggregated data across both branches for {String(label).toLowerCase()}.</p>
      <div className="stats">
        <Stat label="Total Sales" value={money(sum(rSales, "total"))} delta={dS} icon="sales" />
        <Stat label="Unpaid Bills" value={String(openBills.length)} delta={{ cls: "down", txt: money(totalDue) + " due" }} icon="bill" />
        <Stat label="Purchases + Expenses" value={money(sum(rPurch, "total") + sum(rExp, "amount"))} delta={dP} icon="cart" />
        <Stat label="Active Customers" value={String(custNames.size)} delta={{ cls: "up", txt: "with orders this period" }} icon="customers" />
      </div>

      {low.length > 0 && (
        <div className="card alert-card">
          <div className="card-head"><h3 style={{ color: "var(--amber)" }}>⚠ Low stock — {low.length} item{low.length === 1 ? "" : "s"} need restocking</h3></div>
          <div className="card-pad" style={{ paddingTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {low.slice(0, 12).map((l, i) => <span className="chip" key={i}>{l.name} · <b>{l.branch}</b> · {l.qty} left</span>)}
          </div>
        </div>
      )}

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

      <div className="grid-2">
        {branches.filter((b: any) => b.id !== "ho").map((b: any) => {
          const bs = rSales.filter((s: any) => s.branch_id === b.id);
          const tops = topItems(bs);
          return (
            <div className="card" key={b.id}>
              <div className="card-head">
                <h3><span className="status-dot" />{b.name}</h3>
                <button className="link" onClick={() => go("branch", b.id)}>View details →</button>
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
            </div>
          );
        })}
      </div>
      <TxnTable rSales={rSales} rPurch={rPurch} bmap={bmap} />
    </>
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
          <thead><tr><th>Time</th><th>Branch</th><th>Type</th><th>Customer / Supplier</th><th className="r">Amount</th><th className="r">Status</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((r, i) => (
              <tr key={i}>
                <td>{timeStr(r.t)}<div style={{ color: "var(--faint)", fontSize: 11 }}>{dateStr(r.t)}</div></td>
                <td><span className="b-tag">{bmap[r.br] || r.br}</span></td>
                <td>{r.type}</td>
                <td>{r.who}</td>
                <td className={"r amt " + r.dir}>{r.dir === "in" ? "+" : "−"}{money(r.amt)}</td>
                <td className="r"><span className={"badge " + (r.synced === 0 ? "unpaid" : "done")}><span className="dot" />{r.synced === 0 ? "Pending" : "Completed"}</span></td>
              </tr>
            )) : <tr><td colSpan={6}><div className="empty">No transactions.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- branch detail ---------- */
function BranchDetail({ range, branchId, branches, rSales, rPurch, rExp, bills, bmap, go, onSync }: any) {
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
  if (!b) return <div className="empty">Branch not found.</div>;
  return (
    <>
      <button className="back" onClick={() => go("dashboard")}>‹ Back to overview</button>
      <h1 className="page-title">{b.name}</h1>
      <p className="page-sub">{b.location} · {rangeLabel(range).toLowerCase()}</p>
      <div className="stats">
        <div className="stat"><div className="label">Sales</div><div className="value" style={{ color: "var(--green)" }}>{money(sum(bs, "total"))}</div></div>
        <div className="stat"><div className="label">Purchases</div><div className="value">{money(sum(bp, "total"))}</div></div>
        <div className="stat"><div className="label">Expenses</div><div className="value" style={{ color: "var(--red)" }}>{money(sum(be, "amount"))}</div></div>
        <div className="stat"><div className="label">Unpaid dues</div><div className="value" style={{ color: "var(--red)" }}>{money(due)}</div></div>
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
function LedgerPage({ custAll, bmap, onSync }: any) {
  const [q, setQ] = useState("");
  const [ledger, setLedger] = useState<{ branchId: string; name: string } | null>(null);
  let rows = live(custAll);
  if (q.trim()) rows = rows.filter((c: any) => (c.name + (c.phone || "")).toLowerCase().includes(q.toLowerCase()));
  rows = [...rows].sort((a: any, b: any) => b.balance_due - a.balance_due);
  const totalDue = sum(rows as any[], "balance_due" as any);
  const withDue = rows.filter((c: any) => c.balance_due > 0).length;

  return (
    <><h1 className="page-title">Ledger</h1><p className="page-sub">Customer balances (udhaar) across both branches.</p>
      <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <Stat label="Customers" value={String(rows.length)} delta={{ cls: "flat", txt: "all branches" }} icon="customers" />
        <Stat label="With dues" value={String(withDue)} delta={{ cls: withDue > 0 ? "down" : "flat", txt: "need follow-up" }} icon="bill" />
        <Stat label="Total outstanding" value={money(totalDue)} delta={{ cls: totalDue > 0 ? "down" : "up", txt: "across ledger" }} icon="book" />
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
    const ok = await saveProduct(edit as any, online);
    if (!ok) return toast(online ? "Could not save" : "Connect to internet to edit products");
    toast("Product saved"); setEdit(null);
  };
  const delProd = async (pr: Product) => { if (confirmDelete("product")) { await softDelete("products" as any, pr.id); toast("Deleted"); onSync(); } };
  const restoreProd = async (pr: Product) => { await restoreRow("products" as any, pr.id); toast("Restored"); onSync(); };
  const exportCsv = () => downloadExcel("products", ["Name", "Branch", "Unit", "Cost", "Sale price", "Low stock at"],
    rows.map((pr) => [pr.name, pr.branch_id ? (branches.find((b: any) => b.id === pr.branch_id)?.name.replace(" Branch", "") || pr.branch_id) : "All", pr.unit, pr.cost_price, pr.sale_price, pr.low_stock_at ?? 5]));

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
          <thead><tr><th>Product</th><th>Branch</th><th>Unit</th><th className="r">Cost</th><th className="r">Sale price</th><th className="r">Low ≤</th><th className="r"></th></tr></thead>
          <tbody>
            {rows.length ? rows.map((pr: Product) => (
              <tr key={pr.id}>
                <td>{pr.name}</td>
                <td><span className="b-tag">{pr.branch_id ? (branches.find((b: any) => b.id === pr.branch_id)?.name.replace(" Branch", "") || pr.branch_id) : "All"}</span></td>
                <td>{pr.unit}</td>
                <td className="r">{money(pr.cost_price)}</td>
                <td className="r amt in">{money(pr.sale_price)}</td>
                <td className="r">{pr.low_stock_at ?? 5}</td>
                <td className="r">{showDeleted
                  ? <button className="pay-btn" onClick={() => restoreProd(pr)}>Restore</button>
                  : <><button className="edit-btn" onClick={() => setEdit({ ...pr })}>Edit</button> <button className="del-btn" onClick={() => delProd(pr)}>✕</button></>}</td>
              </tr>
            )) : <tr><td colSpan={7}><div className="empty">Nothing here.</div></td></tr>}
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
              <div className="field"><label>Cost price</label><input type="number" inputMode="numeric" value={edit.cost_price ?? 0} onChange={(e) => setEdit({ ...edit, cost_price: +e.target.value })} /></div>
              <div className="field"><label>Sale price</label><input type="number" inputMode="numeric" value={edit.sale_price ?? 0} onChange={(e) => setEdit({ ...edit, sale_price: +e.target.value })} /></div>
            </div>
            <div className="btn-row"><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn" onClick={save}>Save product</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------- purchases (professional) ---------- */
function PurchasesPage({ rPurch, purchAll, bmap, label, branches, products, userId, onSync }: any) {
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

  return (
    <><h1 className="page-title">Purchases</h1><p className="page-sub">What each branch bought, from whom, when · {showDeleted ? "deleted items" : String(label).toLowerCase()}.</p>
      <div className="stats" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <div className="stat"><div className="label">Total purchases</div><div className="value" style={{ color: "var(--red)" }}>{money(total)}</div></div>
        <div className="stat"><div className="label">On credit (owed)</div><div className="value">{money(credit)}</div></div>
        <div className="stat"><div className="label">Records</div><div className="value">{rows.length}</div></div>
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
function InventoryPage({ products, sales, purchases, branches, userId, onSync }: any) {
  const brs = branches.filter((b: any) => b.id !== "ho");
  const [adj, setAdj] = useState<any>(null);
  const [branchId, setBranchId] = useState(brs[0]?.id || "");
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");

  const doAdjust = async () => {
    if (!delta) return toast("Enter a +/- quantity");
    await addStockAdjustment(branchId, userId, { id: adj.id, name: adj.name }, Number(delta), reason.trim());
    toast("Stock adjusted"); setAdj(null); setDelta(0); setReason(""); onSync();
  };

  return (
    <><h1 className="page-title">Inventory</h1><p className="page-sub">Live stock per branch (purchases in − sales out). Adjust for opening stock or wastage.</p>
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
function SalesHistoryPage({ sales, bmap, settings, branches, staffMap }: any) {
  const [payFilter, setPayFilter] = useState<"all" | "cash" | "upi" | "credit">("all");
  const bname = (id: string) => (branches.find((b: any) => b.id === id)?.name) || id;

  // group sales into bills by bill_no
  const groups = new Map<string, any>();
  for (const s of sales) {
    if (payFilter !== "all" && (s.payment_mode || "cash") !== payFilter) continue;
    const key = s.bill_no || s.id;
    const g = groups.get(key) || { key, br: s.branch_id, cust: s.customer_name || "Walk-in", pay: s.payment_mode || "cash", staff: s.created_by, t: s.created_at, items: [] as any[], total: 0 };
    g.items.push(s); g.total += s.total;
    groups.set(key, g);
  }
  const bills = [...groups.values()].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime()).slice(0, 200);

  const reprint = (g: any) => printItemizedBill(g.key.startsWith("B-") ? g.key : "—", g.items.map((s: any) => ({ name: s.product_name, qty: s.qty, price: s.price, discount: s.discount })), g.cust, g.pay, settings, bname(g.br), 0);
  const exportCsv = () => downloadExcel("sales-bills", ["Bill", "Date", "Branch", "Customer", "Payment", "Staff", "Items", "Total"],
    bills.map((g) => [g.key, dateStr(g.t) + " " + timeStr(g.t), bmap[g.br] || "", g.cust, g.pay.toUpperCase(), staffMap[g.staff] || "", g.items.length, g.total]));

  return (
    <><h1 className="page-title">Sales / Bill History</h1><p className="page-sub">Every bill across both branches — reprint any invoice.</p>
      <div className="card">
        <div className="card-head">
          <div className="seg">{(["all", "cash", "upi", "credit"] as const).map((m) => <button key={m} className={payFilter === m ? "active" : ""} onClick={() => setPayFilter(m)}>{m === "all" ? "All" : m.toUpperCase()}</button>)}</div>
          <button className="edit-btn" onClick={exportCsv}>Export CSV</button>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Bill</th><th>Date</th><th>Branch</th><th>Customer</th><th>Payment</th><th>Staff</th><th className="r">Total</th><th className="r"></th></tr></thead>
          <tbody>{bills.length ? bills.map((g) => (
            <tr key={g.key}>
              <td>{g.key.startsWith("B-") ? g.key : "—"}<div style={{ color: "var(--faint)", fontSize: 11 }}>{g.items.length} item{g.items.length === 1 ? "" : "s"}</div></td>
              <td>{dateStr(g.t)} {timeStr(g.t)}</td><td><span className="b-tag">{bmap[g.br]}</span></td>
              <td>{g.cust}</td><td><span className="badge role">{g.pay.toUpperCase()}</span></td><td>{staffMap[g.staff] || "—"}</td>
              <td className="r amt in">{money(g.total)}</td>
              <td className="r"><button className="edit-btn" onClick={() => reprint(g)}>🖨 Reprint</button></td>
            </tr>
          )) : <tr><td colSpan={8}><div className="empty">No bills in this period.</div></td></tr>}</tbody>
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
        <h3 style={{ margin: "0 0 14px" }}>Company profile <span style={{ color: "var(--faint)", fontWeight: 400, fontSize: 12 }}>(shown on printed invoices)</span></h3>
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
