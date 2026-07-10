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
import { saveProduct, softDelete, restoreRow, saveSettings } from "../lib/writes";
import { LedgerModal } from "./Ledger";

type View = "dashboard" | "branch" | "customers" | "purchases" | "inventory" | "daybook" | "reports" | "settings";
const inRange = (rows: any[], from: number) => rows.filter((r) => new Date(r.created_at).getTime() >= from);
const confirmDelete = (what: string) => window.confirm(`Delete this ${what}? It moves to deleted items and can be restored.`);

export function Owner(p: SharedProps) {
  const [range, setRange] = useState<Range>("today");
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

  const from = rangeStart(range);
  const sales = useMemo(() => live(salesAll), [salesAll]);
  const purchases = useMemo(() => live(purchAll), [purchAll]);
  const bills = useMemo(() => live(billsAll), [billsAll]);
  const expenses = useMemo(() => live(expAll), [expAll]);
  const products = useMemo(() => live(prodAll), [prodAll]);
  const rSales = useMemo(() => inRange(sales, from), [sales, from]);
  const rPurch = useMemo(() => inRange(purchases, from), [purchases, from]);
  const rExp = useMemo(() => inRange(expenses, from), [expenses, from]);
  const bmap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, shortBranch(b.name)])), [branches]);
  const go = (v: View, b: string | null = null) => { setView(v); setBranchId(b); setOpen(false); };

  const navItems: [string, string, string][] = [
    ["dashboard", "Dashboard", "dashboard"],
    ["branch:seppa", "Seppa Branch", "branch"],
    ["branch:dirang", "Dirang Branch", "pin"],
    ["customers", "Customers", "customers"],
    ["purchases", "Purchases", "cart"],
    ["inventory", "Inventory", "book"],
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
            </div>
          </div>
          <div className="header-right">
            <span className={"sync-pill " + (pending > 0 ? "pending" : "ok")}><span className="dot" />{pending > 0 ? `${pending} to sync` : "All synced"}</span>
            <button className={"net-toggle " + (p.online ? "online" : "offline")} onClick={p.onToggleOnline}>{p.online ? "Online" : "Offline"}</button>
            <button className="hbtn" onClick={p.onLogout} title="Sign out"><Icon name="settings" size={18} /></button>
            <div className="avatar" title={p.profile.name}>{initials(p.profile.name)}</div>
          </div>
        </div>

        <div className="content">
          {view === "dashboard" && <Dashboard {...{ range, branches, rSales, rPurch, rExp, bills, sales, purchases, products, bmap, go }} />}
          {view === "branch" && branchId && <BranchDetail {...{ range, branchId, branches, rSales, rPurch, rExp, bills, bmap, go, onSync: p.onSync }} />}
          {view === "customers" && <CustomersPage custAll={custAll} bmap={bmap} onSync={p.onSync} />}
          {view === "purchases" && <PurchasesPage purchAll={purchAll} bmap={bmap} range={range} from={from} onSync={p.onSync} />}
          {view === "inventory" && <InventoryPage products={products} sales={sales} purchases={purchases} branches={branches} />}
          {view === "daybook" && <DaybookPage rSales={rSales} rPurch={rPurch} rExp={rExp} bmap={bmap} range={range} />}
          {view === "reports" && <ReportsPage rSales={rSales} range={range} />}
          {view === "settings" && <SettingsPage prodAll={prodAll} online={p.online} settings={settings} onSync={p.onSync} branches={branches} />}
        </div>
      </div>
    </div>
  );
}

/* ---------- dashboard ---------- */
function Dashboard({ range, branches, rSales, rPurch, rExp, bills, sales, purchases, products, bmap, go }: any) {
  const openBills = bills.filter((b: any) => b.status === "unpaid");
  const totalDue = sum(openBills, "due_amount");
  const custNames = new Set(rSales.map((s: any) => s.customer_name).filter((n: string) => n && n !== "Walk-in"));
  const pr = prevRange(range);
  const pSales = sales.filter((s: any) => { const t = new Date(s.created_at).getTime(); return t >= pr.from && t < pr.to; });
  const pPurch = purchases.filter((s: any) => { const t = new Date(s.created_at).getTime(); return t >= pr.from && t < pr.to; });
  const dS = pctDelta(sum(rSales, "total"), sum(pSales, "total"));
  const dP = pctDelta(sum(rPurch, "total"), sum(pPurch, "total"));

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
      <p className="page-sub">Aggregated data across both branches for {rangeLabel(range).toLowerCase()}.</p>
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
                <div className="metric"><div className="m-label">Sales · {rangeLabel(range)}</div><div className="m-value green">{money(sum(bs, "total"))}</div></div>
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
function CustomersPage({ custAll, bmap, onSync }: any) {
  const [showDeleted, setShowDeleted] = useState(false);
  const [q, setQ] = useState("");
  const [ledger, setLedger] = useState<{ branchId: string; name: string } | null>(null);
  let rows = showDeleted ? deletedOnly(custAll) : live(custAll);
  if (q.trim()) rows = rows.filter((c: any) => (c.name + (c.phone || "")).toLowerCase().includes(q.toLowerCase()));
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
            <button className="edit-btn" onClick={() => setShowDeleted((v) => !v)}>{showDeleted ? "← Active" : "Deleted items"}</button>
          </div>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Phone</th><th>Branch</th><th className="r">Balance due</th><th className="r"></th></tr></thead>
          <tbody>{rows.length ? rows.map((c: any) => (
            <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td><span className="b-tag">{bmap[c.branch_id]}</span></td>
              <td className={"r amt " + (c.balance_due > 0 ? "out" : "in")}>{c.balance_due > 0 ? money(c.balance_due) : "Clear"}</td>
              <td className="r" style={{ whiteSpace: "nowrap" }}>
                {!showDeleted && <button className="edit-btn" onClick={() => setLedger({ branchId: c.branch_id, name: c.name })}>Ledger</button>}{" "}
                <button className={showDeleted ? "pay-btn" : "del-btn"} onClick={() => act(c)}>{showDeleted ? "Restore" : "✕"}</button></td></tr>
          )) : <tr><td colSpan={5}><div className="empty">Nothing here.</div></td></tr>}</tbody>
        </table></div>
      </div>
      {ledger && <LedgerModal branchId={ledger.branchId} name={ledger.name} onClose={() => setLedger(null)} />}</>
  );
}

/* ---------- purchases ---------- */
function PurchasesPage({ purchAll, bmap, range, from, onSync }: any) {
  const [showDeleted, setShowDeleted] = useState(false);
  const base = showDeleted ? deletedOnly(purchAll) : live(purchAll);
  const rows = (showDeleted ? base : inRange(base, from)).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const act = async (x: any) => {
    if (showDeleted) { await restoreRow("purchases", x.id); toast("Restored"); }
    else if (confirmDelete("purchase")) { await softDelete("purchases", x.id); toast("Deleted"); }
    onSync();
  };
  return (
    <><h1 className="page-title">Purchases</h1><p className="page-sub">Stock bought · {showDeleted ? "deleted items" : rangeLabel(range).toLowerCase()}.</p>
      <div className="card">
        <div className="card-head"><h3>{rows.length} record{rows.length === 1 ? "" : "s"}</h3>
          <button className="edit-btn" onClick={() => setShowDeleted((v) => !v)}>{showDeleted ? "← Active" : "Deleted items"}</button></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Branch</th><th>Item</th><th>Supplier</th><th className="r">Cost</th><th className="r"></th></tr></thead>
          <tbody>{rows.length ? rows.map((x: any) => (
            <tr key={x.id}><td>{dateStr(x.created_at)}</td><td><span className="b-tag">{bmap[x.branch_id]}</span></td>
              <td>{x.product_name} × {x.qty}</td><td>{x.supplier}</td><td className="r amt out">{money(x.total)}</td>
              <td className="r"><button className={showDeleted ? "pay-btn" : "del-btn"} onClick={() => act(x)}>{showDeleted ? "Restore" : "✕"}</button></td></tr>
          )) : <tr><td colSpan={6}><div className="empty">Nothing here.</div></td></tr>}</tbody>
        </table></div>
      </div></>
  );
}

/* ---------- inventory ---------- */
function InventoryPage({ products, sales, purchases, branches }: any) {
  const brs = branches.filter((b: any) => b.id !== "ho");
  return (
    <><h1 className="page-title">Inventory</h1><p className="page-sub">Live stock per branch (purchases in − sales out).</p>
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>Product</th>{brs.map((b: any) => <th key={b.id} className="r">{shortBranch(b.name)}</th>)}<th className="r">Total</th></tr></thead>
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
                <td className="r amt">{total}</td></tr>
            );
          }) : <tr><td colSpan={brs.length + 2}><div className="empty">No products.</div></td></tr>}
        </tbody>
      </table></div></div></>
  );
}

/* ---------- day book ---------- */
function DaybookPage({ rSales, rPurch, rExp, bmap, range }: any) {
  const inT = sum(rSales, "total"), outP = sum(rPurch, "total"), outE = sum(rExp, "amount");
  const items = [
    ...rSales.map((s: any) => ({ t: s.created_at, br: s.branch_id, label: `Sale · ${s.product_name} × ${s.qty}`, amt: s.total, dir: "in" })),
    ...rPurch.map((x: any) => ({ t: x.created_at, br: x.branch_id, label: `Purchase · ${x.product_name} × ${x.qty}`, amt: x.total, dir: "out" })),
    ...rExp.map((x: any) => ({ t: x.created_at, br: x.branch_id, label: `Expense · ${x.category}`, amt: x.amount, dir: "out" })),
  ].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime()).slice(0, 80);
  return (
    <><h1 className="page-title">Day Book</h1><p className="page-sub">Combined money in & out · {rangeLabel(range).toLowerCase()}.</p>
      <div className="stats" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="stat"><div className="label">Money in</div><div className="value" style={{ color: "var(--green)" }}>{money(inT)}</div></div>
        <div className="stat"><div className="label">Purchases</div><div className="value">{money(outP)}</div></div>
        <div className="stat"><div className="label">Expenses</div><div className="value" style={{ color: "var(--red)" }}>{money(outE)}</div></div>
        <div className="stat"><div className="label">Net</div><div className="value">{money(inT - outP - outE)}</div></div>
      </div>
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Branch</th><th>Detail</th><th className="r">Amount</th></tr></thead>
        <tbody>{items.map((i, k) => (
          <tr key={k}><td>{dateStr(i.t)} {timeStr(i.t)}</td><td><span className="b-tag">{bmap[i.br]}</span></td>
            <td>{i.label}</td><td className={"r amt " + i.dir}>{i.dir === "in" ? "+" : "−"}{money(i.amt)}</td></tr>
        ))}</tbody>
      </table></div></div></>
  );
}

/* ---------- reports ---------- */
function ReportsPage({ rSales, range }: any) {
  const totals: Record<string, number> = {};
  rSales.forEach((s: any) => { totals[s.product_name] = (totals[s.product_name] || 0) + s.total; });
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = Math.max(1, ...top.map((t) => t[1]));
  const seppa = sum(rSales.filter((s: any) => s.branch_id === "seppa"), "total");
  const dirang = sum(rSales.filter((s: any) => s.branch_id === "dirang"), "total");
  const tot = Math.max(1, seppa + dirang);
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
      </div></>
  );
}

/* ---------- settings ---------- */
function SettingsPage({ prodAll, online, settings, onSync, branches }: any) {
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [co, setCo] = useState<Settings>(settings ?? { id: "main", company: "", address: "", phone: "", gstin: "", footer: "" });
  const [showPw, setShowPw] = useState(false);
  useEffect(() => { if (settings) setCo(settings); }, [settings]);
  const blank: Partial<Product> = { name: "", unit: "pcs", sale_price: 0, cost_price: 0, low_stock_at: 5 };
  const rows: Product[] = showDeleted ? deletedOnly(prodAll) : live(prodAll);

  const save = async () => {
    if (!edit?.name?.trim()) return toast("Enter a product name");
    const ok = await saveProduct(edit as any, online);
    if (!ok) return toast(online ? "Could not save" : "Connect to internet to edit products");
    toast("Product saved"); setEdit(null);
  };
  const delProd = async (pr: Product) => { if (confirmDelete("product")) { await softDelete("products" as any, pr.id); toast("Deleted"); onSync(); } };
  const restoreProd = async (pr: Product) => { await restoreRow("products" as any, pr.id); toast("Restored"); onSync(); };
  const saveCo = async () => {
    const ok = await saveSettings({ ...co, id: "main" }, online);
    toast(ok ? "Company profile saved" : online ? "Could not save" : "Connect to internet");
  };

  return (
    <><h1 className="page-title">Settings</h1><p className="page-sub">Company, products, staff & system.</p>

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

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Products & Prices</h3>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="edit-btn" onClick={() => setShowDeleted((v) => !v)}>{showDeleted ? "← Active" : "Deleted"}</button>
            {!showDeleted && <button className="add-btn" onClick={() => setEdit({ ...blank })}>+ Add product</button>}
          </div>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Product</th><th>Unit</th><th className="r">Cost</th><th className="r">Sale price</th><th className="r">Low-stock ≤</th><th className="r"></th></tr></thead>
          <tbody>
            {rows.length ? rows.map((pr: Product) => (
              <tr key={pr.id}>
                <td>{pr.name}</td><td>{pr.unit}</td>
                <td className="r">{money(pr.cost_price)}</td>
                <td className="r amt in">{money(pr.sale_price)}</td>
                <td className="r">{pr.low_stock_at ?? 5}</td>
                <td className="r">{showDeleted
                  ? <button className="pay-btn" onClick={() => restoreProd(pr)}>Restore</button>
                  : <><button className="edit-btn" onClick={() => setEdit({ ...pr })}>Edit</button> <button className="del-btn" onClick={() => delProd(pr)}>✕</button></>}</td>
              </tr>
            )) : <tr><td colSpan={6}><div className="empty">Nothing here.</div></td></tr>}
          </tbody>
        </table></div>
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
      {edit && (
        <Modal title={edit.id ? "Edit product" : "Add product"} onClose={() => setEdit(null)}>
          <div className="form-grid">
            <div className="field"><label>Name</label><input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Product name" /></div>
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
