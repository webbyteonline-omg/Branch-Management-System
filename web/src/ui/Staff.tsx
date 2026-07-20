import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localdb } from "../lib/db";
import { Icon } from "../lib/icons";
import { money, dateStr, timeStr, rangeStart } from "../lib/format";
import { toast } from "./Toast";
import { Modal } from "./Modal";
import { CustomerLedgerPage } from "./Ledger";
import { EditBillModal, EditBillGroupModal, EditPurchaseGroupModal } from "./Edits";
import { addCustomer, addBill, recordBillPayment, addExpense, softDelete, saveEdit, createSaleBill, createPurchaseInvoice, computeLineTotal, settleCustomerDues, saveProduct, voidBill, voidSaleGroup, ensureCustomer, setCustomerActive, addStockAdjustment, type CartItem } from "../lib/writes";
import { sum, live, forTotals, computeStock, productsForBranch, type SharedProps } from "./shared";
import { BarChart } from "./Charts";
import { downloadExcel } from "../lib/excel";
import { fetchRangeFresh } from "../lib/sync";
import type { Purchase, Bill as BillT, Product as ProductT } from "../lib/types";

const confirmDel = (what: string) => window.confirm(`Delete this ${what}? It can be restored by the owner.`);

type Tab = "dashboard" | "sale" | "purchase" | "unpaid" | "previous" | "customers" | "ledger" | "stock" | "products" | "daybook";

export function Staff(p: SharedProps) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [showMenu, setShowMenu] = useState(false);
  const branchId = p.profile.branch_id!;
  const branches = useLiveQuery(() => localdb.branches.toArray(), [], []);
  const branchName = branches.find((b) => b.id === branchId)?.name ?? "My Branch";

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
      {/* Staff never sees sync state at all — every save is stored locally
          immediately and pushed to Head Office silently in the background.
          Nothing to look at, nothing that can go wrong from their side. */}
      <div className="mobile-top" style={{ background: "var(--surface)" }}>
        <div className="actions">
          <button className="icon-btn" onClick={() => setShowMenu(true)}><Icon name="menu" size={22} /></button>
          <b style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.1 }}>{branchName}</b>
        </div>
      </div>
      <div className="m-content">
        {tab === "dashboard" && <StaffDashboard branchId={branchId} branchName={branchName} shared={p} go={go} />}
        {tab === "sale" && <BillingScreen branchId={branchId} shared={p} branchName={branchName} />}
        {tab === "purchase" && <PurchaseScreen branchId={branchId} shared={p} />}
        {tab === "unpaid" && <UnpaidBills branchId={branchId} shared={p} />}
        {tab === "previous" && <PreviousBills branchId={branchId} shared={p} branchName={branchName} />}
        {tab === "customers" && <Customers branchId={branchId} shared={p} />}
        {tab === "products" && <StaffProducts branchId={branchId} shared={p} />}
        {tab === "ledger" && <StaffLedger branchId={branchId} shared={p} />}
        {tab === "stock" && <StaffStock branchId={branchId} shared={p} />}
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
              {!p.online && (
                <div className="net-toggle offline" style={{ margin: "0 0 8px", width: "100%", padding: "10px 0", textAlign: "center" }}>
                  No network — saving on this device, will sync automatically
                </div>
              )}
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

  // Avatar tint rotation for Recent Activity rows — mirrors the SST reference's
  // per-row color variety (secondary/primary/surface-highest/tertiary/variant).
  const avatarTints = [
    { bg: "var(--green-soft)", fg: "var(--green)" },
    { bg: "var(--accent-soft)", fg: "var(--accent)" },
    { bg: "var(--surface-4)", fg: "var(--text)" },
    { bg: "var(--red-soft)", fg: "var(--red)" },
    { bg: "var(--surface-3)", fg: "var(--muted)" },
  ];
  const initialsOf = (name: string) =>
    (name || "Walk-in").split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  return (
    <>
      {/* Primary actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <button
          className="btn"
          style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 8, fontSize: 14, fontWeight: 700 }}
          onClick={() => go("sale")}
        >
          <Icon name="addCircle" size={20} /> New Bill
        </button>
        <button
          className="btn"
          style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 8, fontSize: 14, fontWeight: 700, background: "var(--surface)", color: "var(--accent)", border: "1px solid var(--accent)" }}
          onClick={() => go("unpaid")}
        >
          <Icon name="warning" size={20} /> Record Pay
        </button>
      </div>

      {/* Bento stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ gridColumn: "1 / -1", padding: 16, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -16, top: -16, width: 96, height: 96, borderRadius: "50%", background: "var(--accent-soft)", opacity: 0.5 }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative" }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)" }}>Sold Today</span>
            <Icon name="reports" size={20} />
          </div>
          <div style={{ fontSize: 28, lineHeight: "36px", fontWeight: 700, color: "var(--accent)", position: "relative" }}>{money(sold)}</div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)", marginBottom: 8 }}>Received Today</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--green)" }}>{money(receivedToday)}</div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)", marginBottom: 8 }}>Due</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: due > 0 ? "var(--red)" : "var(--green)" }}>{money(due)}</div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Sales — Last 7 Days</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{chartData[0]?.label} – {chartData[6]?.label}</span>
        </div>
        <BarChart data={chartData} color="var(--accent)" />
      </div>

      {/* Recent activity list */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Recent Activity</h2>
          <button style={{ color: "var(--accent)", fontSize: 14, fontWeight: 500 }} onClick={() => go("previous")}>View All</button>
        </div>
        <div className="card" style={{ overflow: "hidden" }}>
          {recent.length ? recent.map((s, i) => {
            const tint = avatarTints[i % avatarTints.length];
            return (
              <div
                key={s.id}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottom: i < recent.length - 1 ? "1px solid var(--line-2)" : "none" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: tint.bg, color: tint.fg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>
                    {initialsOf(s.customer_name || s.product_name)}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{s.customer_name || "Walk-in"}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{s.product_name} • {timeStr(s.created_at)}</span>
                  </div>
                </div>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{money(s.total)}</span>
              </div>
            );
          }) : <div className="empty" style={{ padding: 16 }}>No activity yet today.</div>}
        </div>
      </div>
    </>
  );
}

/* ---------- Stock (separate from Products — quantities only) ---------- */
/* Stock is computed live (purchases in − sales out, see computeStock) — it
 * is NOT a stored field on Product, so: (1) a product removed on the
 * Products page disappears from here automatically (same productsForBranch
 * source), and (2) cutting a bill reduces stock the instant that sale is
 * saved, with zero extra wiring needed. Manual "Save Changes" below writes
 * the DIFFERENCE between the typed value and the current computed stock as
 * a stock-adjustment purchase row (addStockAdjustment) — it does not
 * overwrite anything, it just nudges the running total to match reality
 * (e.g. after a physical count). */
function StaffStock({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const products = productsForBranch(useLiveQuery(() => localdb.products.toArray(), [], []), branchId);
  const sales = live(useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const purch = live(useLiveQuery(() => localdb.purchases.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, { box: number; pcs: number }>>({});

  const allRows = products
    .map((pr) => {
      const stock = computeStock(pr.id, branchId, sales, purch);
      const perBox = pr.pieces_per_box || 0;
      const box = perBox ? Math.floor(stock / perBox) : 0;
      const pcs = perBox ? stock % perBox : stock;
      return { ...pr, stock, perBox, box, pcs };
    })
    .filter((pr) => pr.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const lowCount = allRows.filter((r) => r.stock <= (r.low_stock_at ?? 5)).length;
  const totalValue = allRows.reduce((a, r) => a + r.stock * (r.sale_price || 0), 0);

  const editFor = (pr: (typeof allRows)[number]) => edits[pr.id] ?? { box: pr.box, pcs: pr.pcs };
  const setEditFor = (pr: (typeof allRows)[number], patch: Partial<{ box: number; pcs: number }>) =>
    setEdits((e) => ({ ...e, [pr.id]: { ...editFor(pr), ...patch } }));
  const isDirty = (pr: (typeof allRows)[number]) => {
    const e = edits[pr.id];
    return !!e && (e.box !== pr.box || e.pcs !== pr.pcs);
  };

  const saveChanges = async (pr: (typeof allRows)[number]) => {
    const e = editFor(pr);
    const newTotal = pr.perBox ? e.box * pr.perBox + e.pcs : e.pcs;
    const delta = newTotal - pr.stock;
    if (delta === 0) { setEdits((all) => { const n = { ...all }; delete n[pr.id]; return n; }); return; }
    await addStockAdjustment(branchId, shared.profile.id, { id: pr.id, name: pr.name }, delta, "Manual stock update");
    toast(`${pr.name} stock updated`);
    setEdits((all) => { const n = { ...all }; delete n[pr.id]; return n; });
    shared.onSync();
  };

  return (
    <>
      <div className="field" style={{ position: "relative", marginBottom: 14 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }}><Icon name="search" size={17} /></span>
        <input style={{ paddingLeft: 38, height: 48, borderRadius: 12 }} placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div className="card card-pad">
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Total Items</div>
          <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>{allRows.length}</div>
        </div>
        <div className="card card-pad" style={{ borderColor: lowCount > 0 ? "var(--red)" : undefined }}>
          <div style={{ fontSize: 12, color: lowCount > 0 ? "var(--red)" : "var(--muted)" }}>Low Stock</div>
          <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, color: lowCount > 0 ? "var(--red)" : "var(--text)" }}>{lowCount}</div>
        </div>
      </div>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Estimated Stock Value</div>
        <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>{money(totalValue)}</div>
      </div>

      <h3 style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 10px" }}>All Products</h3>
      {allRows.length ? allRows.map((pr) => {
        const low = pr.stock <= (pr.low_stock_at ?? 5);
        const e = editFor(pr);
        const dirty = isDirty(pr);
        return (
          <div key={pr.id} className="card card-pad" style={{ marginBottom: 10, borderColor: low ? "var(--red)" : undefined, position: "relative", overflow: "hidden" }}>
            {low && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "var(--red)" }} />}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{pr.name}</div>
              {low && <span className="status-pill warn">Low Stock</span>}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              {!!pr.perBox && (
                <div className="field" style={{ marginBottom: 0, flex: 1 }}>
                  <label style={{ fontSize: 10, textTransform: "uppercase" }}>Boxes</label>
                  <input type="number" inputMode="numeric" value={e.box} onChange={(ev) => setEditFor(pr, { box: +ev.target.value })} style={{ fontWeight: 700 }} />
                </div>
              )}
              <div className="field" style={{ marginBottom: 0, flex: 1 }}>
                <label style={{ fontSize: 10, textTransform: "uppercase" }}>Pieces</label>
                <input type="number" inputMode="numeric" value={e.pcs} onChange={(ev) => setEditFor(pr, { pcs: +ev.target.value })} style={{ fontWeight: 700 }} />
              </div>
            </div>
            {dirty && (
              <button className="btn" style={{ width: "100%", marginTop: 10, padding: "9px 0", fontSize: 13.5 }} onClick={() => saveChanges(pr)}>
                Save Changes
              </button>
            )}
          </div>
        );
      }) : <div className="card card-pad"><div className="empty">No products for this branch yet.</div></div>}
    </>
  );
}

/* ---------- Products (name + price only — add / edit / delete, own branch only) ---------- */
function StaffProducts({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const prodAll = useLiveQuery(() => localdb.products.toArray(), [], []);
  const products = productsForBranch(prodAll, branchId).sort((a, b) => a.name.localeCompare(b.name));
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Partial<ProductT> | null>(null);
  // pieces_per_box defaults to 1 for new products so a "Price / Box" entered
  // here always has somewhere to live (box_price) without needing a separate
  // "pieces per box" field on this simplified page — Stock page still shows
  // Boxes/Pieces using whatever pieces_per_box was originally set for the
  // product (unchanged if this was an existing product being edited).
  const blank: Partial<ProductT> = { name: "", unit: "pcs", sale_price: 0, cost_price: 0, low_stock_at: 5, pieces_per_box: 1, branch_id: branchId };
  const rows = products.filter((pr) => pr.name.toLowerCase().includes(q.toLowerCase()));

  const save = async () => {
    if (!edit?.name?.trim()) return toast("Enter a product name");
    // Staff can only own products scoped to their branch — never the shared "all branches"
    // catalog. Only stamp branch_id on brand-new products; an existing row's branch_id is
    // never touched here (editing a shared product is blocked below, before this can run).
    await saveProduct({ ...edit, branch_id: edit.id ? edit.branch_id : branchId } as any, branchId);
    toast("Product saved" + (shared.online ? "" : " offline")); setEdit(null); shared.onSync();
  };
  // Soft-delete: the same mechanism every other delete in this app uses
  // (bills/purchases/customers). productsForBranch() already filters out
  // deleted_at rows everywhere — Products, Stock, Billing search, Purchase
  // picker — so this is a complete, permanent removal from every screen,
  // and (unlike a true hard delete) it stays safe offline with no risk of
  // the product reappearing if a delete sync retry is needed.
  const delProd = async (pr: ProductT) => { if (confirmDel("product")) { await softDelete("products", pr.id); toast("Product removed"); shared.onSync(); } };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h1 className="page-title" style={{ fontSize: 24, margin: 0 }}>Products</h1>
        <button className="btn" style={{ width: "auto", padding: "10px 18px", display: "flex", alignItems: "center", gap: 6, borderRadius: 10 }} onClick={() => setEdit({ ...blank })}>
          <Icon name="plus" size={16} /> Add
        </button>
      </div>
      <div className="field" style={{ position: "relative", marginBottom: 16 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }}><Icon name="search" size={17} /></span>
        <input style={{ paddingLeft: 38, height: 48, borderRadius: 12 }} placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {rows.length ? rows.map((pr) => {
        const boxPrice = pr.pieces_per_box ? (pr.box_price || pr.pieces_per_box * pr.sale_price) : null;
        return (
          <div key={pr.id} className="card card-pad" style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{pr.name}{pr._synced === 0 ? " · ⏳" : ""}</div>
              {/* Shared (all-branch) catalog products are owner-managed only — editing them
                  here would fail server-side (RLS) since their branch_id is null, which can
                  never equal a staff member's own branch. */}
              {pr.branch_id ? (
                <button className="icon-btn" style={{ width: 40, height: 40, border: "1px solid var(--accent)", borderRadius: 10, color: "var(--accent)" }} onClick={() => setEdit({ ...pr })}><Icon name="settings" size={16} /></button>
              ) : (
                <span style={{ fontSize: 10.5, color: "var(--faint)", padding: "4px 8px" }}>Shared</span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 12, paddingBottom: 10, borderBottom: "1px solid var(--line-2)" }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--faint)" }}>Price / Box</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{boxPrice != null ? money(boxPrice) : "—"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "var(--faint)" }}>Price / Piece</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{money(pr.sale_price)}</div>
              </div>
            </div>
            {pr.branch_id && (
              <button className="btn ghost" style={{ width: "100%", marginTop: 10, padding: "8px 0", color: "var(--red)", borderColor: "var(--red)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={() => delProd(pr)}>
                <Icon name="trash" size={14} /> Delete
              </button>
            )}
          </div>
        );
      }) : <div className="card card-pad"><div className="empty">{products.length ? "No products match your search." : "No products yet for this branch."}</div></div>}

      {edit && (
        <Modal title={edit.id ? "Edit product" : "Add product"} onClose={() => setEdit(null)}>
          <div className="form-grid">
            <div className="field"><label>Product Name</label><input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Product name" /></div>
            <div className="qty-row">
              <div className="field"><label>Price / Box</label>
                <input type="number" inputMode="numeric" value={edit.box_price ?? ""} onChange={(e) => setEdit({ ...edit, box_price: e.target.value === "" ? null : +e.target.value })} placeholder="0" />
              </div>
              <div className="field"><label>Price / Piece</label>
                <input type="number" inputMode="numeric" value={edit.sale_price ?? 0} onChange={(e) => setEdit({ ...edit, sale_price: +e.target.value })} placeholder="0" />
              </div>
            </div>
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
  const [payFor, setPayFor] = useState<{ name: string; due: number } | null>(null);
  const [payAmt, setPayAmt] = useState<number | "">("");

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

  // "Full ledger" now opens a full-page single-customer view (Cash+UPI
  // per-bill payments, Settled page, payment history) instead of the old
  // read-mostly LedgerModal — this is a sub-view of StaffLedger itself
  // (same pattern as BillingScreen's new/previous toggle), so the bottom
  // tabbar and hamburger menu keep working normally while it's open.
  if (ledger) {
    return <CustomerLedgerPage branchId={branchId} shared={shared} initialCustomer={ledger} onBack={() => setLedger(null)} />;
  }

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 14, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -20, top: -20, width: 90, height: 90, borderRadius: "50%", background: tab === "outstanding" ? "var(--accent-soft)" : "var(--green-soft)", opacity: .6 }} />
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".6px", color: "var(--muted)", fontWeight: 700, position: "relative" }}>
          {tab === "outstanding" ? "Total Outstanding" : "Total Settled"}
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: tab === "outstanding" ? "var(--accent)" : "var(--green)", marginTop: 6, position: "relative" }}>
          {money(tab === "outstanding" ? totalDue : sum(bills.filter((b) => b.status === "paid" && !b.void_at), "amount"))}
        </div>
      </div>

      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={tab === "outstanding" ? "active" : ""} onClick={() => setTab("outstanding")}>Outstanding</button>
        <button className={tab === "paid" ? "active" : ""} onClick={() => setTab("paid")}>Paid</button>
      </div>

      <button className="edit-btn" style={{ marginBottom: 12 }} onClick={exportStatement}>Export statement</button>

      <div className="field" style={{ position: "relative", marginBottom: 12 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }}><Icon name="search" size={16} /></span>
        <input style={{ paddingLeft: 36, height: 48, borderRadius: 12 }} placeholder="Search customer…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {tab === "outstanding" ? (
        outstandingRows.length ? outstandingRows.map((c) => {
          const cBills = billsFor(c.name).filter((b) => b.status === "unpaid");
          return (
            <div className="card card-pad" key={c.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{c.name}</div>
                <div className="amt out" style={{ fontSize: 17, fontWeight: 800 }}>{money(c.balance_due)}</div>
              </div>
              <div className="sub" style={{ marginTop: 2 }}>{cBills.length} bill{cBills.length === 1 ? "" : "s"} due</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
                {cBills.slice(0, 3).map((b) => (
                  <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 13 }}>{b.bill_no ? `Bill #${b.bill_no}` : "Udhaar bill"} <span className="sub">· {dateStr(b.created_at)}</span></div>
                    <span style={{ color: "var(--red)", fontSize: 13, fontWeight: 700 }}>{money(b.due_amount)}</span>
                  </div>
                ))}
                {cBills.length > 3 && <div className="sub">+ {cBills.length - 3} more</div>}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn ghost" style={{ flex: 1, padding: "9px 0" }} onClick={() => setLedger(c.name)}>Full Ledger</button>
                <button className="btn" style={{ flex: 1, padding: "9px 0" }} onClick={() => { setPayFor({ name: c.name, due: c.balance_due }); setPayAmt(c.balance_due); }}>Pay</button>
              </div>
            </div>
          );
        }) : <div className="card card-pad"><div className="empty">No outstanding dues. All clear!</div></div>
      ) : (
        paidNames.length ? paidNames.map((name) => {
          const cBills = billsFor(name).filter((b) => b.status === "paid" && !b.void_at);
          const total = sum(cBills, "amount");
          return (
            <div className="card card-pad" key={name} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{name}</div>
                <div className="amt in" style={{ fontSize: 17, fontWeight: 800 }}>{money(total)}</div>
              </div>
              <div className="sub" style={{ color: "var(--green)", marginTop: 2 }}>Fully Paid · {cBills.length} bill{cBills.length === 1 ? "" : "s"}</div>
              <button className="edit-btn" style={{ marginTop: 10 }} onClick={() => setLedger(name)}>Full Ledger</button>
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
    </>
  );
}

/* ---------- Sale (New Bill / Previous Bills) ---------- */
/* Wrapper owning the "New Bill" / "Previous Bills" in-page toggle — the
 * Billing tab always lands on New Bill by default; Previous is one tap away
 * via this segmented control instead of needing the hamburger menu. */
function BillingScreen({ branchId, shared, branchName }: { branchId: string; shared: SharedProps; branchName: string }) {
  const [view, setView] = useState<"new" | "previous">("new");
  return (
    <>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={view === "new" ? "active" : ""} onClick={() => setView("new")}>New Bill</button>
        <button className={view === "previous" ? "active" : ""} onClick={() => setView("previous")}>Previous Bills</button>
      </div>
      {view === "new"
        ? <NewBillForm branchId={branchId} shared={shared} branchName={branchName} />
        : <PreviousBills branchId={branchId} shared={shared} branchName={branchName} />}
    </>
  );
}

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
  const [custPhone, setCustPhone] = useState("");
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

  const save = async (shareAfter = false) => {
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

    try {
      const { billNo, due } = await createSaleBill(branchId, shared.profile.id, cust, {
        mode: payMode, amountPaid: amountPaidNow, cashAmount: finalCash, upiAmount: finalUpi,
      }, items);
      await ensureCustomer(branchId, cust, custPhone);
      toast(`Bill ${billNo} saved` + (due > 0 ? ` — ${money(due)} due` : "") + (shared.online ? "" : " offline"));

      if (shareAfter) {
        const lines = cart.map((c) => `${c.name} x${c.qty} - ${money(lineAmount(c))}`).join("\n");
        const msg = `*${branchName}*\nBill ${billNo}\nCustomer: ${cust || "Walk-in"}\n\n${lines}\n\n*Grand Total: ${money(cartTotal)}*` + (due > 0 ? `\nDue: ${money(due)}` : "");
        const phoneDigits = custPhone.replace(/\D/g, "");
        const waUrl = `https://wa.me/${phoneDigits ? "91" + phoneDigits : ""}?text=${encodeURIComponent(msg)}`;
        window.open(waUrl, "_blank");
      }

      setCart([]); setCust(""); setCustPhone(""); setDiscType("none"); setDiscCustom(0); setDiscFlat(0);
      setPayMode("cash"); setCashAmt(""); setUpiAmt(""); setPaidFull(true); setPartialAmt(""); shared.onSync();
    } catch (e: any) {
      console.error("[billing] save failed:", e);
      toast("Bill NOT saved — " + (e?.message || "please try again"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="card card-pad">
        <div style={{ display: "flex", gap: 10 }}>
          <div className="field" style={{ position: "relative", marginBottom: 0, flex: 2 }}>
            <label>Customer Name</label>
            <input value={cust} onChange={(e) => { setCust(e.target.value); setShowCustDd(true); }}
              onFocus={() => setShowCustDd(true)} onBlur={() => setTimeout(() => setShowCustDd(false), 150)}
              placeholder="Customer name (or Walk-in)" />
            {showCustDd && custMatches.length > 0 && (
              <div className="card" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, maxHeight: 220, overflowY: "auto", marginTop: 4 }}>
                {custMatches.map((c) => (
                  <div key={c.id} className="row" style={{ padding: "10px 14px", cursor: "pointer" }}
                    onMouseDown={() => { setCust(c.name); setCustPhone(c.phone || ""); setShowCustDd(false); }}>
                    <div><div className="main">{c.name}</div><div className="sub">{c.phone || "—"}</div></div>
                    {c.balance_due > 0 && <span className="amt out">{money(c.balance_due)} due</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="field" style={{ marginBottom: 0, flex: 1 }}>
            <label>Mobile No.</label>
            <input value={custPhone} onChange={(e) => setCustPhone(e.target.value)} type="tel" inputMode="numeric" placeholder="98765 43210" />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0, marginTop: 10 }}>
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
                  <div><div className="main">{pr.name}</div><div className="sub">{money(pr.sale_price)}/{pr.unit}{pr.pieces_per_box ? ` · cartoon of ${pr.pieces_per_box} = ${money(pr.box_price || pr.pieces_per_box * pr.sale_price)}` : ""}</div></div>
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
                <div className="sub">{money(c.price)}/pc{c.perBox ? ` · ${money(effBoxPrice)}/cartoon (${c.perBox} pcs)` : ""}</div>
              </div>
              <button className="del-btn" style={{ background: "transparent", color: "var(--red)", width: 30, height: 30, flexShrink: 0 }} onClick={() => removeItem(i)}><Icon name="trash" size={16} /></button>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 10 }}>
              <div style={{ display: "flex", gap: 10 }}>
                {c.perBox > 0 && (
                  <div>
                    <label style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>CARTOON</label>
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
        <button
          style={{ width: "100%", padding: "12px", border: "1.5px dashed var(--accent)", color: "var(--accent)", borderRadius: 10, background: "transparent", fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 4 }}
          onClick={() => productInputRef.current?.focus()}
        >
          <Icon name="addCircle" size={16} /> Add More Items
        </button>
      )}

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

      <div className="btn-row" style={{ marginTop: 16, marginBottom: 4, display: "flex", gap: 10 }}>
        <button
          style={{ flex: 1, padding: 13, borderRadius: 10, background: "var(--surface)", color: "var(--accent)", border: "1.5px solid var(--accent)", fontWeight: 700, fontSize: 14.5 }}
          onClick={() => save(false)} disabled={saving || !cart.length}
        >
          Save
        </button>
        <button
          className="btn" style={{ flex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "var(--green)" }}
          onClick={() => save(true)} disabled={saving || !cart.length}
        >
          <Icon name="whatsapp" size={16} /> Save &amp; Share
        </button>
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

/* ---------- Purchase (multi-item invoice, mirrors NewBillForm's cart pattern) ---------- */
/* Wrapper owning the "New Purchase" / "Previous Purchases" in-page toggle —
 * same pattern as BillingScreen above. Purchase tab always lands on New
 * Purchase by default. */
function PurchaseScreen({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const [view, setView] = useState<"new" | "previous">("new");
  return (
    <>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={view === "new" ? "active" : ""} onClick={() => setView("new")}>New Purchase</button>
        <button className={view === "previous" ? "active" : ""} onClick={() => setView("previous")}>Previous Purchases</button>
      </div>
      {view === "new"
        ? <PurchaseForm branchId={branchId} shared={shared} />
        : <PreviousPurchases branchId={branchId} shared={shared} />}
    </>
  );
}

type PurchLine = { product_id: string; name: string; box: number; pcs: number; perBox: number; cost: number; boxCost: number };

function PurchaseForm({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const products = productsForBranch(useLiveQuery(() => localdb.products.toArray(), [], []), branchId);
  const allPurch = live(useLiveQuery(() => localdb.purchases.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const suppliers = [...new Set(allPurch.map((p) => p.supplier).filter(Boolean))] as string[];

  const [supplier, setSupplier] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const makeLine = (pr: typeof products[number] | undefined): PurchLine => {
    const perBox = pr?.pieces_per_box || 0;
    const boxCost = pr?.box_cost_price || (perBox ? perBox * (pr?.cost_price || 0) : 0);
    return { product_id: pr?.id || "", name: pr?.name || "", box: 0, pcs: pr ? 1 : 0, perBox, cost: pr?.cost_price || 0, boxCost };
  };

  const [cart, setCart] = useState<PurchLine[]>(() => products.length ? [makeLine(products[0])] : []);

  const setLine = (i: number, patch: Partial<PurchLine>) => setCart((c) => c.map((x, k) => k === i ? { ...x, ...patch } : x));
  const changeProduct = (i: number, pid: string) => {
    const pr = products.find((x) => x.id === pid);
    setCart((c) => c.map((x, k) => k === i ? { ...makeLine(pr), pcs: x.pcs || 1 } : x));
  };
  const bump = (i: number, field: "box" | "pcs", delta: number) => setCart((c) => c.map((x, k) => {
    if (k !== i) return x;
    const box = field === "box" ? Math.max(0, x.box + delta) : x.box;
    const pcs = field === "pcs" ? Math.max(0, x.pcs + delta) : x.pcs;
    return { ...x, box, pcs };
  }));
  const addItem = () => setCart((c) => [...c, makeLine(products[0])]);
  const removeItem = (i: number) => setCart((c) => c.filter((_, k) => k !== i));

  const lineAmount = (l: PurchLine) => l.box * (l.boxCost || (l.perBox ? l.perBox * l.cost : 0)) + l.pcs * l.cost;
  const subtotal = cart.reduce((a, l) => a + lineAmount(l), 0);

  // Payment
  const [pay, setPay] = useState<"cash" | "upi" | "both" | "credit">("cash");
  const [cashAmt, setCashAmt] = useState<number | "">("");
  const [upiAmt, setUpiAmt] = useState<number | "">("");

  const paidNow = pay === "credit" ? 0
    : pay === "both" ? (Number(cashAmt) || 0) + (Number(upiAmt) || 0)
    : pay === "cash" ? (Number(cashAmt) || 0)
    : (Number(upiAmt) || 0);
  const pending = Math.max(0, Math.round((subtotal - paidNow) * 100) / 100);

  const reset = () => {
    setCart(products.length ? [makeLine(products[0])] : []);
    setSupplier(""); setInvoiceNo(""); setPay("cash"); setCashAmt(""); setUpiAmt("");
    setDate(new Date().toISOString().slice(0, 10));
  };

  const save = async () => {
    if (!cart.length) return toast("Add at least one item");
    if (!supplier.trim()) return toast("Enter company / supplier name");
    if (cart.some((l) => !l.product_id)) return toast("Choose a product for every item");
    if (cart.some((l) => l.box * (l.perBox || 0) + l.pcs <= 0)) return toast("Every item needs a quantity greater than 0");
    if (pay === "both" && (Number(cashAmt) || 0) + (Number(upiAmt) || 0) <= 0) {
      return toast("Enter the cash and/or UPI amount");
    }
    setSaving(true);
    try {
      const items = cart.map((l) => {
        const qty = l.box * (l.perBox || 0) + l.pcs;
        const effBoxCost = l.boxCost || (l.perBox ? l.perBox * l.cost : 0);
        return {
          product_id: l.product_id, product_name: l.name, qty, cost: l.cost,
          lineTotalOverride: lineAmount(l), boxQty: l.box, pcsQty: l.pcs, boxCost: l.box > 0 ? effBoxCost : undefined,
        };
      });
      const { invoiceNo: inv } = await createPurchaseInvoice(branchId, shared.profile.id, supplier, invoiceNo, {
        mode: pay, amountPaid: paidNow,
        cashAmount: pay === "both" ? Number(cashAmt) || 0 : undefined,
        upiAmount: pay === "both" ? Number(upiAmt) || 0 : undefined,
      }, items);
      toast(`Purchase ${inv} saved` + (pending > 0 ? ` — ${money(pending)} pending` : "") + (shared.online ? "" : " offline"));
      reset(); shared.onSync();
    } catch (e: any) {
      console.error("[purchase] save failed:", e);
      toast("Purchase NOT saved — " + (e?.message || "please try again"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="card card-pad">
        <div className="qty-row">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Company Name</label>
            <input list="sup-list" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Search supplier…" />
            <datalist id="sup-list">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Invoice No.</label>
            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Auto-generated if blank" />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0, marginTop: 10 }}>
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <h3 style={{ fontSize: 14, color: "var(--muted)", margin: "18px 0 8px" }}>Items{cart.length ? ` (${cart.length})` : ""}</h3>
      {cart.length ? cart.map((l, i) => {
        const lt = lineAmount(l);
        const effBoxCost = l.boxCost || (l.perBox ? l.perBox * l.cost : 0);
        return (
          <div className="card card-pad" key={i} style={{ marginBottom: 10, boxShadow: "var(--shadow)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div className="field" style={{ marginBottom: 0, flex: 1 }}>
                <select value={l.product_id} onChange={(e) => changeProduct(i, e.target.value)}>
                  {products.length ? products.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>) : <option value="">No products — owner must add first</option>}
                </select>
              </div>
              <button className="del-btn" style={{ background: "transparent", color: "var(--red)", width: 30, height: 30, flexShrink: 0 }} onClick={() => removeItem(i)}><Icon name="trash" size={16} /></button>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 10 }}>
                {l.perBox > 0 && (
                  <div>
                    <label style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>CARTOON</label>
                    <div className="stepper sm" style={{ marginTop: 2 }}>
                      <button onClick={() => bump(i, "box", -1)}><Icon name="minus" size={12} /></button>
                      <span>{l.box}</span>
                      <button onClick={() => bump(i, "box", 1)}><Icon name="plus" size={12} /></button>
                    </div>
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>PCS</label>
                  <div className="stepper sm" style={{ marginTop: 2 }}>
                    <button onClick={() => bump(i, "pcs", -1)}><Icon name="minus" size={12} /></button>
                    <span>{l.pcs}</span>
                    <button onClick={() => bump(i, "pcs", 1)}><Icon name="plus" size={12} /></button>
                  </div>
                </div>
                <div className="field" style={{ marginBottom: 0, width: 100 }}>
                  <label style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>COST/PC</label>
                  <input type="number" inputMode="numeric" value={l.cost} onChange={(e) => setLine(i, { cost: +e.target.value })} style={{ padding: "6px 8px", fontSize: 13 }} />
                </div>
              </div>
              <b style={{ fontSize: 16, color: "var(--accent)", flexShrink: 0 }}>{money(lt)}</b>
            </div>
            {l.perBox > 0 && <div className="sub" style={{ marginTop: 6 }}>Cartoon of {l.perBox} = {money(effBoxCost)}</div>}
          </div>
        );
      }) : <div className="card card-pad"><div className="empty">No items yet. Add an item below.</div></div>}

      <button
        style={{ width: "100%", padding: "12px", border: "1.5px dashed var(--accent)", color: "var(--accent)", borderRadius: 10, background: "transparent", fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 4 }}
        onClick={addItem} disabled={!products.length}
      >
        <Icon name="addCircle" size={16} /> Add Item
      </button>

      {/* Payment Details */}
      <div style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>Payment Details</h3>
        <div className="card card-pad">
          <div className="row" style={{ padding: "6px 0" }}><span className="sub">Subtotal</span><b>{money(subtotal)}</b></div>
          <div className="pay-select" style={{ marginTop: 8, marginBottom: 10 }}>
            {(["cash", "upi", "both", "credit"] as const).map((m) => (
              <button key={m} className={"pay-opt" + (pay === m ? " active" : "")} onClick={() => setPay(m)}>
                {m === "both" ? "Split" : m === "credit" ? "Credit" : m.toUpperCase()}
              </button>
            ))}
          </div>
          {pay !== "credit" && (
            <div className="qty-row">
              <div className="field"><label>Cash Paid (₹)</label><input type="number" inputMode="numeric" value={cashAmt} onChange={(e) => setCashAmt(e.target.value === "" ? "" : +e.target.value)} disabled={pay === "upi"} /></div>
              <div className="field"><label>UPI Paid (₹)</label><input type="number" inputMode="numeric" value={upiAmt} onChange={(e) => setUpiAmt(e.target.value === "" ? "" : +e.target.value)} disabled={pay === "cash"} /></div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line)" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Total Pending</span>
            <b style={{ fontFamily: "monospace", fontSize: 14, color: pending > 0 ? "var(--red)" : "var(--green)" }}>{money(pending)}</b>
          </div>
        </div>
      </div>

      <button className="btn" style={{ width: "100%", marginTop: 16, marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        onClick={save} disabled={saving || !cart.length}>
        <Icon name="cart" size={17} /> Save Purchase
      </button>
    </>
  );
}

/* Previous Purchases — past purchases for this branch, grouped by invoice_no
 * (fallback to id if null), mirroring PreviousBills' grouping-by-bill_no. */
type PurchGroup = { invoiceNo: string; items: Purchase[]; total: number; supplier: string; date: string; pay: string };

function PreviousPurchases({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const purchases = live(useLiveQuery(() => localdb.purchases.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const [q, setQ] = useState("");
  const [view, setView] = useState<PurchGroup | null>(null);
  const [editGroup, setEditGroup] = useState<PurchGroup | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, PurchGroup>();
    for (const p of purchases) {
      const key = p.invoice_no || p.id;
      if (!map.has(key)) map.set(key, { invoiceNo: key, items: [], total: 0, supplier: p.supplier || "—", date: p.created_at, pay: p.payment_mode || "cash" });
      const g = map.get(key)!;
      g.items.push(p);
      g.total += p.total;
    }
    return [...map.values()]
      .filter((g) => g.invoiceNo.toLowerCase().includes(q.toLowerCase()) || g.supplier.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [purchases, q]);

  const doDelete = async (g: PurchGroup) => {
    if (!window.confirm(`Delete purchase ${g.invoiceNo}? It can be restored by the owner.`)) return;
    for (const it of g.items) await softDelete("purchases", it.id);
    toast("Purchase deleted"); shared.onSync();
  };

  return (
    <>
      <div className="card">
        <div className="card-head"><h3>Previous purchases</h3><input className="search" placeholder="Search invoice # or supplier…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="card-pad" style={{ paddingTop: 6 }}>
          {groups.length ? groups.map((g) => (
            <div className="row" key={g.invoiceNo} style={{ cursor: "pointer" }} onClick={() => setView(g)}>
              <div>
                <div className="main">#{g.invoiceNo}</div>
                <div className="sub">{g.supplier} · {dateStr(g.date)} · {g.items.length} item{g.items.length === 1 ? "" : "s"} · {g.pay.toUpperCase()}</div>
              </div>
              <b className="amt out">{money(g.total)}</b>
            </div>
          )) : <div className="empty">No purchases yet.</div>}
        </div>
      </div>

      {view && <PurchaseInvoiceModal group={view} onClose={() => setView(null)}
        onEdit={() => { setEditGroup(view); setView(null); }}
        onDelete={() => { doDelete(view); setView(null); }} />}

      {editGroup && <EditPurchaseGroupModal group={editGroup} onClose={() => setEditGroup(null)} onSync={shared.onSync} />}
    </>
  );
}

/** Read-only itemized purchase invoice preview — explicitly labeled as a
 *  PURCHASE (not a sale/bill) so staff never confuse it with a sales bill
 *  when looking at history. Mirrors Owner.tsx's BillInvoiceModal structure,
 *  adapted for supplier/cost instead of customer/price. */
function PurchaseInvoiceModal({ group, onClose, onEdit, onDelete }: { group: PurchGroup; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <Modal title={`Purchase Invoice #${group.invoiceNo}`} onClose={onClose}>
      <div className="form-grid">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ background: "var(--red-soft)", color: "var(--red)", fontSize: 11, fontWeight: 800, letterSpacing: ".5px", padding: "3px 10px", borderRadius: 999 }}>PURCHASE</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
          <span>{group.supplier}</span><span>{dateStr(group.date)} · {timeStr(group.date)}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Payment: {group.pay.toUpperCase()}</div>
        <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", marginTop: 4 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-2)" }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12 }}>Item</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12 }}>Qty</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12 }}>Cost</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--line-2)" }}>
                  <td style={{ padding: "8px 10px" }}>
                    {p.product_name}
                    {(p.box_qty || p.pcs_qty) ? <div style={{ fontSize: 11, color: "var(--faint)" }}>{p.box_qty ? `${p.box_qty} cartoon` : ""}{p.box_qty && p.pcs_qty ? " + " : ""}{p.pcs_qty ? `${p.pcs_qty} pcs` : ""}</div> : null}
                  </td>
                  <td style={{ textAlign: "right", padding: "8px 10px" }}>{p.qty}</td>
                  <td style={{ textAlign: "right", padding: "8px 10px" }}>{money(p.cost)}</td>
                  <td style={{ textAlign: "right", padding: "8px 10px", fontWeight: 700 }}>{money(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <b>Grand Total</b><b style={{ color: "var(--accent)" }}>{money(group.total)}</b>
        </div>
        <div className="btn-row">
          <button className="btn ghost" onClick={onClose}>Close</button>
          <button className="btn" onClick={onEdit}>Edit</button>
          <button className="btn" style={{ background: "var(--red)" }} onClick={onDelete}>Delete</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Bills / Customers / Daybook ---------- */
/* Unpaid Bills — grouped by customer, due date per bill, per-bill and
 * per-customer "add payment" (per-customer auto-splits oldest-first across
 * that customer's unpaid bills, same as the Ledger's settle flow). */
type UnpaidSort = "date" | "amount" | "name";

function UnpaidBills({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const bills = live(useLiveQuery(() => localdb.bills.where("branch_id").equals(branchId).toArray(), [branchId], []))
    .filter((b) => b.status === "unpaid");
  const customers = live(useLiveQuery(() => localdb.customers.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const due = sum(bills, "due_amount");

  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState(""); const [amount, setAmount] = useState(0); const [paidNow, setPaidNow] = useState(0); const [dueDate, setDueDate] = useState("");
  const [payFor, setPayFor] = useState<BillT | null>(null);
  const [payMode, setPayMode] = useState<"cash" | "upi" | "both">("cash");
  const [payCash, setPayCash] = useState<number | "">(""); const [payUpi, setPayUpi] = useState<number | "">("");
  const [editBill, setEditBill] = useState<BillT | null>(null);
  const [settleFor, setSettleFor] = useState<string | null>(null); const [settleAmt, setSettleAmt] = useState<number | "">("");
  const [showSettlePicker, setShowSettlePicker] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<UnpaidSort>("date");

  const groups = useMemo(() => {
    const map = new Map<string, BillT[]>();
    for (const b of bills) { const k = b.customer_name; if (!map.has(k)) map.set(k, []); map.get(k)!.push(b); }
    return [...map.entries()].map(([cust, list]) => ({ cust, list, total: sum(list, "due_amount") })).sort((a, b) => b.total - a.total);
  }, [bills]);

  // Flat per-bill list for the mockup's card layout — searchable by customer
  // name or bill #, sortable by oldest-first / highest-amount / name A-Z.
  const flatBills = useMemo(() => {
    let rows = bills.filter((b) =>
      !q.trim() || b.customer_name.toLowerCase().includes(q.toLowerCase()) || (b.bill_no || "").toLowerCase().includes(q.toLowerCase()));
    rows = [...rows].sort((a, b) => {
      if (sort === "amount") return b.due_amount - a.due_amount;
      if (sort === "name") return a.customer_name.localeCompare(b.customer_name);
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); // oldest first
    });
    return rows;
  }, [bills, q, sort]);

  const saveBill = async () => {
    if (!name.trim()) return toast("Enter customer name");
    if (!amount || amount <= 0) return toast("Enter bill amount");
    await addBill(branchId, name, Number(amount), Number(paidNow) || 0, dueDate || null);
    toast("Bill saved" + (shared.online ? "" : " offline"));
    setShowNew(false); setName(""); setAmount(0); setPaidNow(0); setDueDate(""); shared.onSync();
  };
  const payTotal = payMode === "both" ? (Number(payCash) || 0) + (Number(payUpi) || 0)
    : payMode === "cash" ? (Number(payCash) || 0) : (Number(payUpi) || 0);
  const savePay = async () => {
    if (!payFor) return;
    if (!payTotal || payTotal <= 0) return toast("Enter amount");
    await recordBillPayment(branchId, shared.profile.id, payFor, {
      amount: payTotal, mode: payMode,
      cashAmount: payMode === "both" ? Number(payCash) || 0 : undefined,
      upiAmount: payMode === "both" ? Number(payUpi) || 0 : undefined,
    });
    toast("Payment recorded" + (shared.online ? "" : " offline"));
    setPayFor(null); setPayMode("cash"); setPayCash(""); setPayUpi(""); shared.onSync();
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
      {/* Total Outstanding hero card */}
      <div className="card card-pad" style={{ marginBottom: 14, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -20, top: -20, opacity: 0.08, color: "var(--red)" }}><Icon name="wallet" size={100} /></div>
        <div style={{ position: "relative" }}>
          <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700 }}>Total Outstanding</span>
          <div style={{ fontSize: 28, lineHeight: "36px", fontWeight: 800, color: "var(--red)", marginTop: 2 }}>{money(due)}</div>
          <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 2 }}>Across {bills.length} pending bill{bills.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      {/* Search + sort */}
      <div className="field" style={{ position: "relative", marginBottom: 10 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }}><Icon name="search" size={17} /></span>
        <input style={{ paddingLeft: 38, height: 48, borderRadius: 12 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer or bill no…" />
      </div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 14, paddingBottom: 2 }}>
        {([["date", "Date (Oldest)"], ["amount", "Amount (Highest)"], ["name", "Name A-Z"]] as [UnpaidSort, string][]).map(([s, label]) => (
          <button key={s} className={"pay-opt" + (sort === s ? " active" : "")} style={{ flexShrink: 0, width: "auto", padding: "8px 16px" }} onClick={() => setSort(s)}>{label}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="edit-btn" onClick={exportStatement}>Export statement</button>
        {groups.length > 0 && (
          <button className="edit-btn" onClick={() => setShowSettlePicker(true)}>Settle a customer</button>
        )}
      </div>

      {flatBills.length ? flatBills.map((b) => {
        const overdue = !!(b.due_date && new Date(b.due_date).getTime() < Date.now());
        return (
          <div className="card card-pad" key={b.id} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{b.customer_name}</div>
                <div className="sub">{b.bill_no ? `Bill #${b.bill_no}` : "Udhaar bill"}{b._synced === 0 ? " · ⏳" : ""}</div>
              </div>
              <span style={{
                flexShrink: 0, fontSize: 11, fontWeight: 800, padding: "4px 8px", borderRadius: 4, display: "flex", alignItems: "center", gap: 4,
                background: overdue ? "var(--red-soft)" : "var(--surface-4)", color: overdue ? "var(--red)" : "var(--muted)",
              }}>
                {overdue && <Icon name="warning" size={13} />}{overdue ? "Overdue" : "Pending"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--faint)" }}>Date</div>
                <div style={{ fontSize: 13.5, color: "var(--muted)" }}>{dateStr(b.created_at)}</div>
                {b.due_date && <div style={{ fontSize: 11.5, color: overdue ? "var(--red)" : "var(--muted)", fontWeight: overdue ? 700 : 400 }}>Due {dateStr(b.due_date)}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "var(--faint)" }}>Remaining Balance</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--red)" }}>{money(b.due_amount)}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button className="icon-btn" style={{ background: "var(--surface-2)", width: 36, height: 36 }} onClick={() => setEditBill(b)}><Icon name="settings" size={14} /></button>
              <button className="icon-btn" style={{ background: "var(--surface-2)", width: 36, height: 36, color: "var(--red)" }} onClick={() => doVoid(b)}><Icon name="close" size={14} /></button>
              <button
                className="btn" style={{ flex: 1, padding: 12, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontWeight: 700 }}
                onClick={() => { setPayFor(b); setPayMode("cash"); setPayCash(b.due_amount); setPayUpi(""); }}
              >
                <Icon name="wallet" size={16} /> Pay Now
              </button>
            </div>
          </div>
        );
      }) : <div className="card card-pad"><div className="empty">No unpaid bills. All clear!</div></div>}
      {flatBills.length > 0 && <div style={{ textAlign: "center", color: "var(--faint)", fontSize: 12, padding: "10px 0 4px" }}>End of pending bills</div>}

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
            <div className="pay-select">
              {(["cash", "upi", "both"] as const).map((m) => (
                <button key={m} className={"pay-opt" + (payMode === m ? " active" : "")} onClick={() => setPayMode(m)}>
                  {m === "both" ? "Split" : m.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="qty-row">
              <div className="field"><label>Cash (₹)</label><input type="number" inputMode="numeric" value={payCash} onChange={(e) => setPayCash(e.target.value === "" ? "" : +e.target.value)} disabled={payMode === "upi"} /></div>
              <div className="field"><label>UPI (₹)</label><input type="number" inputMode="numeric" value={payUpi} onChange={(e) => setPayUpi(e.target.value === "" ? "" : +e.target.value)} disabled={payMode === "cash"} /></div>
            </div>
            <div className="total-preview">Total: {money(payTotal)}</div>
            <div className="btn-row"><button className="btn ghost" onClick={() => setPayFor(null)}>Cancel</button><button className="btn" onClick={savePay}>Record payment</button></div>
          </div>
        </Modal>
      )}
      {showSettlePicker && (
        <Modal title="Settle a customer" onClose={() => setShowSettlePicker(false)}>
          <div className="form-grid">
            {groups.map((g) => (
              <div key={g.cust} className="row" style={{ cursor: "pointer" }}
                onClick={() => { setSettleFor(g.cust); setSettleAmt(g.total); setShowSettlePicker(false); }}>
                <div><div className="main">{g.cust}</div><div className="sub">{g.list.length} bill{g.list.length === 1 ? "" : "s"} due</div></div>
                <b className="amt out">{money(g.total)}</b>
              </div>
            ))}
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
/** Simple name+phone-only edit — deliberately does NOT expose balance_due
 *  (that stays an owner-level correction via Owner.tsx's EditCustomerModal).
 *  Toggling active/inactive is separate (a plain switch on the card, not
 *  part of this modal). */
function EditCustomerNamePhoneModal({ customer, onClose, onSync }: { customer: import("../lib/types").Customer; onClose: () => void; onSync: () => void }) {
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone || "");
  const save = async () => {
    if (!name.trim()) return toast("Enter a name");
    await saveEdit("customers", { ...customer, name: name.trim(), phone: phone.trim() || null });
    toast("Customer updated"); onClose(); onSync();
  };
  return (
    <Modal title="Edit customer" onClose={onClose}>
      <div className="form-grid">
        <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="btn-row"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}

function Customers({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const cust = live(useLiveQuery(() => localdb.customers.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const [show, setShow] = useState(false);
  const [editC, setEditC] = useState<any>(null);
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const save = async () => {
    if (!name.trim()) return toast("Enter customer name");
    await addCustomer(branchId, name, phone);
    toast("Customer added" + (shared.online ? "" : " offline"));
    setShow(false); setName(""); setPhone(""); shared.onSync();
  };
  const toggleActive = async (c: any) => { await setCustomerActive(c, !(c.active ?? true)); shared.onSync(); };
  const [q, setQ] = useState("");
  const rows = cust
    .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || (c.phone || "").includes(q))
    .filter((c) => statusFilter === "all" ? true : statusFilter === "active" ? (c.active ?? true) : !(c.active ?? true));
  return (
    <>
      <div className="field" style={{ position: "relative", marginBottom: 14 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }}><Icon name="search" size={17} /></span>
        <input style={{ paddingLeft: 38, height: 48, borderRadius: 12 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers…" />
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(["all", "active", "inactive"] as const).map((f) => (
          <button key={f} className={"pay-opt" + (statusFilter === f ? " active" : "")} style={{ flex: 1, textTransform: "capitalize" }} onClick={() => setStatusFilter(f)}>{f}</button>
        ))}
      </div>

      {rows.length ? rows.map((c) => {
        const isActive = c.active ?? true;
        return (
          <div className="card card-pad" key={c.id} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{c.name}</div>
              <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => setEditC(c)}><Icon name="settings" size={15} /></button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 14 }}>
                <Icon name="phone" size={15} />{c.phone || "—"}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={(e) => e.stopPropagation()}>
                <span style={{ fontSize: 13, color: isActive ? "var(--text)" : "var(--faint)", fontWeight: 600 }}>{isActive ? "Active" : "Inactive"}</span>
                <span
                  onClick={() => toggleActive(c)}
                  style={{
                    width: 44, height: 26, borderRadius: 999, background: isActive ? "var(--accent)" : "var(--line)",
                    position: "relative", transition: "background .15s", flexShrink: 0,
                  }}
                >
                  <span style={{
                    position: "absolute", top: 3, left: isActive ? 21 : 3, width: 20, height: 20, borderRadius: "50%",
                    background: "#fff", boxShadow: "var(--shadow)", transition: "left .15s",
                  }} />
                </span>
              </label>
            </div>
          </div>
        );
      }) : <div className="card card-pad"><div className="empty">No customers yet.</div></div>}

      <button className="fab round" onClick={() => setShow(true)}><Icon name="customers" size={22} /></button>

      {editC && <EditCustomerNamePhoneModal customer={editC} onClose={() => setEditC(null)} onSync={shared.onSync} />}
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
/* ---------- Reports (Range / Day Book — Summary tab removed per request) ---------- */
function Daybook({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const [tab, setTab] = useState<"range" | "daybook">("daybook");
  return (
    <>
      <h1 className="page-title" style={{ fontSize: 24, margin: "0 0 14px" }}>Reports</h1>
      <div className="seg" style={{ marginBottom: 16 }}>
        <button className={tab === "range" ? "active" : ""} onClick={() => setTab("range")}>Range</button>
        <button className={tab === "daybook" ? "active" : ""} onClick={() => setTab("daybook")}>Day Book</button>
      </div>
      {tab === "range" ? <RangeReport branchId={branchId} /> : <DayBookReport branchId={branchId} shared={shared} />}
    </>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* Range tab — quick month-select chips + explicit date range, fetched fresh
 * from the server (not the capped local 2000-row cache) via fetchRangeFresh,
 * same helper Owner.tsx's range reports already rely on. */
function RangeReport({ branchId }: { branchId: string }) {
  const now = new Date();
  const toStr = (d: Date) => d.toISOString().slice(0, 10);
  const [from, setFrom] = useState(toStr(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(toStr(now));
  const [loading, setLoading] = useState(false);
  const [sales, setSales] = useState<any[]>([]);
  // Bills (udhaar) for the same window — pulled from the local cache rather
  // than fetchRangeFresh (which only supports sales/purchases/expenses),
  // since bill volume per branch is small and always kept in localdb.bills.
  const allBills = live(useLiveQuery(() => localdb.bills.where("branch_id").equals(branchId).toArray(), [branchId], []));

  const load = async (f: string, t: string) => {
    setLoading(true);
    try {
      const fromTs = new Date(f + "T00:00:00").getTime();
      const toTs = new Date(t + "T23:59:59").getTime();
      const s = await fetchRangeFresh<any>("sales", fromTs, toTs, [branchId]);
      setSales(s.filter((x) => !x.deleted_at && !x.void_at));
    } catch (e: any) {
      toast("Couldn't load range — " + (e?.message || "check connection"));
    } finally {
      setLoading(false);
    }
  };
  // Load on mount with the default (this month) range.
  useMemo(() => { load(from, to); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickMonth = (mIdx: number) => {
    const year = now.getFullYear();
    const f = toStr(new Date(year, mIdx, 1));
    const lastDay = new Date(year, mIdx + 1, 0);
    const t = toStr(mIdx === now.getMonth() ? now : lastDay);
    setFrom(f); setTo(t); load(f, t);
  };

  const salesTotal = sum(sales, "total");
  // "Received" — same logic as the dashboard: a sale with no linked udhaar
  // bill was paid in full at billing time (its full total counts); a sale
  // that DOES have a linked bill only contributes what that bill's `paid`
  // tracks, summed once per bill_no (not per line) to avoid double-counting
  // multi-item bills.
  const rangeBills = useMemo(() => {
    const fromTs = new Date(from + "T00:00:00").getTime();
    const toTs = new Date(to + "T23:59:59").getTime();
    return allBills.filter((b) => { const t = new Date(b.created_at).getTime(); return t >= fromTs && t <= toTs && !b.void_at; });
  }, [allBills, from, to]);
  const billNosInRange = new Set(rangeBills.map((b) => b.bill_no));
  const fullyPaid = sum(sales.filter((s) => !billNosInRange.has(s.bill_no ?? null)), "total");
  const partialPaid = sum(rangeBills, "paid");
  const receivedTotal = fullyPaid + partialPaid;

  return (
    <>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", fontWeight: 700, marginBottom: 8 }}>Quick Select Month:</div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16, paddingBottom: 2 }}>
        {MONTHS.map((m, i) => (
          <button key={m} className="pay-opt" style={{ flexShrink: 0, width: "auto", padding: "8px 16px" }} onClick={() => pickMonth(i)}>{m}</button>
        ))}
      </div>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Date From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Date To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn" style={{ width: "100%", marginTop: 12, padding: 11 }} onClick={() => load(from, to)} disabled={loading}>
          {loading ? "Loading…" : "Apply"}
        </button>
      </div>

      <div className="card card-pad" style={{ marginBottom: 12, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -20, top: -20, width: 90, height: 90, borderRadius: "50%", background: "var(--surface-4)", opacity: .5 }} />
        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", position: "relative" }}>Sales in Range</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "var(--accent)", marginTop: 6, position: "relative" }}>{money(salesTotal)}</div>
      </div>
      <div className="card card-pad" style={{ position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -20, top: -20, width: 90, height: 90, borderRadius: "50%", background: "var(--green-soft)", opacity: .5 }} />
        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", position: "relative" }}>Received in Range</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "var(--green)", marginTop: 6, position: "relative" }}>{money(receivedTotal)}</div>
      </div>
    </>
  );
}

/* Day Book tab — today's bills specifically: how many cut, how much came
 * in as payment, how much became due, then every bill from today with its
 * payment status. (Replaces the old generic sales+purchases+expenses feed —
 * that broader ledger is not needed here per explicit request.) */
function DayBookReport({ branchId, shared }: { branchId: string; shared: SharedProps }) {
  const today = rangeStart("today");
  const sales = forTotals(useLiveQuery(() => localdb.sales.where("branch_id").equals(branchId).toArray(), [branchId], []));
  const bills = live(useLiveQuery(() => localdb.bills.where("branch_id").equals(branchId).toArray(), [branchId], []));

  const todaySales = sales.filter((s) => new Date(s.created_at).getTime() >= today);
  const todayBills = bills.filter((b) => new Date(b.created_at).getTime() >= today && !b.void_at);

  // Expense logging (rent/transport/tea/etc.) moved off the main Day Book
  // focus (which is now bills/payments/dues, per request) but kept
  // reachable — staff previously could log these day-to-day and losing
  // that silently would be a real capability regression.
  const [showExp, setShowExp] = useState(false);
  const [cat, setCat] = useState("General"); const [note, setNote] = useState(""); const [amt, setAmt] = useState(0);
  const expCats = ["General", "Transport", "Rent", "Salary", "Electricity", "Tea/Food", "Repair"];
  const saveExp = async () => {
    if (!amt || amt <= 0) return toast("Enter amount");
    await addExpense(branchId, shared.profile.id, cat, note, Number(amt));
    toast("Expense saved" + (shared.online ? "" : " offline"));
    setShowExp(false); setNote(""); setAmt(0); setCat("General"); shared.onSync();
  };

  // Group today's sales into bills by bill_no (fallback to id) — same
  // pattern used everywhere else in this app (PreviousBills, Ledger, etc).
  const groups = useMemo(() => {
    const map = new Map<string, { billNo: string; customer: string; total: number; pay: string; t: string; items: number }>();
    for (const s of todaySales) {
      const key = s.bill_no || s.id;
      if (!map.has(key)) map.set(key, { billNo: key, customer: s.customer_name || "Walk-in", total: 0, pay: s.payment_mode || "cash", t: s.created_at, items: 0 });
      const g = map.get(key)!;
      g.total += s.total; g.items += 1;
    }
    return [...map.values()].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime());
  }, [todaySales]);

  const billNosToday = new Set(todayBills.map((b) => b.bill_no));
  const receivedToday = sum(groups.filter((g) => !billNosToday.has(g.billNo)), "total") + sum(todayBills, "paid");
  const duesToday = sum(todayBills.filter((b) => b.status === "unpaid"), "due_amount");

  const statusFor = (g: (typeof groups)[number]) => {
    const bill = todayBills.find((b) => b.bill_no === g.billNo);
    if (!bill) return { label: "Paid", cls: "ok" };
    return bill.status === "unpaid" ? { label: "Due " + money(bill.due_amount), cls: "warn" } : { label: "Paid", cls: "ok" };
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Today, {dateStr(Date.now())}</div>
        <button className="edit-btn" onClick={() => setShowExp(true)}>+ Expense</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div className="card card-pad" style={{ gridColumn: "1 / -1", background: "var(--accent)", color: "#fff" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", opacity: .85, fontWeight: 700 }}>Bills Cut Today</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{groups.length}</div>
        </div>
        <div className="card card-pad">
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Payment Received</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--green)", marginTop: 6 }}>{money(receivedToday)}</div>
        </div>
        <div className="card card-pad">
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Dues Created</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: duesToday > 0 ? "var(--red)" : "var(--green)", marginTop: 6 }}>{money(duesToday)}</div>
        </div>
      </div>

      <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", margin: "16px 0 8px" }}>Today's Bills</h3>
      {groups.length ? groups.map((g) => {
        const status = statusFor(g);
        return (
          <div className="card card-pad" key={g.billNo} style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="main" style={{ fontWeight: 700 }}>{g.billNo.startsWith(g.customer) ? g.billNo : `Bill #${g.billNo}`}</div>
              <div className="sub">{g.customer} · {timeStr(g.t)} · {g.items} item{g.items === 1 ? "" : "s"} · {g.pay.toUpperCase()}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700 }}>{money(g.total)}</div>
              <span className={"status-pill " + status.cls} style={{ marginTop: 2, display: "inline-block" }}>{status.label}</span>
            </div>
          </div>
        );
      }) : <div className="card card-pad"><div className="empty">No bills cut yet today.</div></div>}

      {showExp && (
        <Modal title="Add expense" onClose={() => setShowExp(false)}>
          <div className="form-grid">
            <div className="field"><label>Category</label>
              <select value={cat} onChange={(e) => setCat(e.target.value)}>{expCats.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div className="field"><label>Note (optional)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sumo fare to Seppa" /></div>
            <div className="field"><label>Amount</label><input type="number" inputMode="numeric" value={amt || ""} onChange={(e) => setAmt(+e.target.value)} /></div>
            <div className="btn-row"><button className="btn ghost" onClick={() => setShowExp(false)}>Cancel</button><button className="btn" onClick={saveExp}>Save expense</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}
