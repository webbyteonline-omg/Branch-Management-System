# Branch Manager — Feature List

A professional, offline-first multi-branch retail management system.
Owner runs it on laptop/phone; staff run it on phones. Everything works
without internet and auto-syncs when back online.

## Owner (Head Office)
- **Dashboard** — Today / This Week / This Month filters; total sales, unpaid bills, purchases + expenses, active customers, each with trend vs previous period.
- **Low-stock alerts** — flags every product below its threshold, per branch.
- **Branch cards** — sales, active staff, top-selling items; drill into any branch.
- **Branch day book** — every sale/purchase/expense with soft-delete.
- **Customers** — full list, balances, search, delete & restore.
- **Purchases** — all stock purchases, search, delete & restore.
- **Inventory** — live stock per branch (purchases in − sales out) with low-stock highlighting.
- **Day Book** — combined money in / purchases / expenses / net.
- **Reports** — top products by revenue, branch contribution.
- **Products & prices** — add/edit/delete products, set sale & cost price and low-stock threshold (prices locked centrally so staff can't undercharge).
- **Company profile** — name, address, phone, GSTIN, footer used on printed invoices.
- **Live realtime** — staff activity appears on the dashboard within seconds.

## Staff (mobile, offline-first)
- **Billing (POS)** — build a bill with **multiple items**, pick payment mode (**Cash / UPI / Credit-udhaar**), see live stock, then **Save** or **Save & Print** an itemized invoice with a bill number. Credit bills auto-create the udhaar + customer balance.
- **Customer ledger (khata)** — tap any customer to see their full purchase & bill history and outstanding balance.
- **New Purchase** — record stock bought from suppliers.
- **Bills / Udhaar** — create bills, record payments (auto-updates customer balance), **print invoice / save PDF**, delete.
- **Customers** — add customers, view balances, delete.
- **Day Book** — running in/out/net; add **expenses** (transport, rent, salary, etc.); delete any entry.
- **Pending-sync counter** — shows entries waiting to upload; ⏳ marks unsynced rows.

## System-wide
- **Offline-first** — every entry saves on the device first, syncs when online. Zero data loss.
- **No duplicates** — client-generated IDs make sync idempotent.
- **Soft delete everywhere** — nothing is ever truly deleted; owner can restore.
- **Branch-level security** — enforced in the database (RLS): staff can't touch another branch's data.
- **Installable PWA** — add to home screen; works like a native app.

## Roadmap (next)
- Bill history + reprint / edit past bills; sequential bill-number series per branch
- Staff-wise sales report (who sold how much)
- Custom date-range reports & export to Excel/PDF
- GST / tax on bills; discount per item
- Stock adjustments (opening stock, wastage) & stock transfer between branches
- Barcode scanning for fast billing
- WhatsApp bill / payment reminders to customers
