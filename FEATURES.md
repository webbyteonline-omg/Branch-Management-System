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

## Edit & delete (everywhere)
- **Edit** customers, bills, and any day-book entry (sale/purchase/expense) — from both owner and staff.
- **Soft delete** with restore (owner) on all records.
- **CSV export** (owner) — customers list and the full day book, opens in Excel.

## System-wide
- **Live realtime** — the moment a staff member saves a sale/purchase/bill/expense/customer, it appears on the owner's dashboard within a second, no refresh. (Requires Supabase Realtime — enabled by `schema.sql`.)
- **Offline-first** — every entry saves on the device first, syncs when online. Zero data loss.
- **No duplicates** — client-generated IDs make sync idempotent.
- **Soft delete everywhere** — nothing is ever truly deleted; owner can restore.
- **Branch-level security** — enforced in the database (RLS): staff can't touch another branch's data.
- **Installable PWA** — add to home screen; works like a native app.

## Purchases (professional)
- **Full purchase records** — supplier/company, product, qty, cost, **supplier bill no.**, date (backdate allowed), **payment to supplier (cash/credit-owed)**, and notes.
- **Purchase history** (owner) — filter by branch, search supplier/item/bill, totals (spent + amount owed on credit), **top-suppliers summary**, edit/delete, **Excel export**.

## Branch independence
- The two branches are fully separate — **each branch has its own products** (owner assigns a product to a branch, or "All"). Staff only see and bill their own branch's items. No stock or data is shared between branches.

## Billing & reporting extras
- **Sequential bill numbers per branch** (e.g. SEP-0001, DIR-0001).
- **Custom date-range picker** (owner) alongside Today / Week / Month.
- **Excel export** on Customers, Day Book, Sales history and Purchases.

## Recently added
- **Bulk payment** — settle a customer's dues across all their bills at once (oldest first), from the ledger.
- **Sales / Bill history** (owner) — every bill grouped by bill number, filter by payment type, **reprint any invoice**, export CSV.
- **Staff-wise sales report** (owner Reports) — who sold how much.
- **GST % + per-item discount %** in billing, shown on the printed invoice.
- **Stock adjustments** (owner Inventory) — set opening stock or record wastage per branch.

## Roadmap (next)
- Barcode scanning for fast billing
- WhatsApp bill / payment reminders to customers
- PDF export & scheduled email reports
- (Stock transfer between branches intentionally excluded — branches are independent.)
