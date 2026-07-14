# PROJECT CONTEXT — Multi-Branch Management System (for a new chat)

Paste this whole file into a new chat to continue seamlessly.

## What this is
A production **Multi-Branch Tracking & Management System** for a retail client.
- **Head Office (owner/admin)** on laptop + phone; **2 branches** — **Seppa** & **Dirang** (Arunachal, in the mountains, **unreliable internet**).
- Branches are **independent** (no connection, sell **different items**, no stock transfer).
- Staff use **phones only**; owner uses laptop + phone. Business ~₹50 lakh/month.
- Hard requirements: **offline-first, zero data loss, secure, real-time** owner view.

## Stack (final, locked)
- **Frontend:** React + Vite + **TypeScript**, **PWA** (installable, offline). Deployed on **Vercel**.
- **Offline:** **Dexie** (IndexedDB) local mirror + sync queue (idempotent, client-generated UUIDs).
- **Backend:** **Supabase** — Postgres + Auth + **Row-Level-Security (RLS)** + **Realtime**.
- **Server logic:** 2 Supabase **Edge Functions** (Deno) — `admin-create-staff`, `admin-reset-password` (service-role stays server-side; each verifies caller is owner).

## Where things live
- **Repo:** `git@github.com:webbyteonline-omg/Branch-Management-System.git` (branch `main`)
- **Local folder:** `/Users/sachinkumar/Desktop/WebSites - WebByte/Branch Management System`
- **Frontend app:** `web/`  (source in `web/src/`)
- **Database:** `supabase/schema.sql` (+ `supabase/seed.sql`), functions in `supabase/functions/`
- **Docs:** `DEPLOY.md` (setup runbook), `FEATURES.md` (full feature list)
- **Live URL:** https://branch-management-system-gray.vercel.app
- **Supabase project ref:** `wbovdsydxgqebafpgxpr`

## Deploy / env
- **Vercel:** Framework = Vite, Root Directory = `web` (root `vercel.json` also handles the monorepo build). Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. (Never put the service-role key in Vercel.)
- **Supabase:** run `schema.sql` then `seed.sql` in SQL Editor. Re-run `schema.sql` after any schema change (all `create ... if not exists` + idempotent `alter ... add column if not exists` — safe, non-destructive).
- **Edge Functions:** deploy with `--no-verify-jwt` (or dashboard editor with "Verify JWT" OFF) — otherwise browser CORS preflight is blocked.

## Login model (important)
- Users sign in with a **simple User ID** (e.g. `seppa`); the app appends a fixed internal domain → `seppa@branch.local` for Supabase Auth. Users never type the email.
- **Owner:** `admin` / `admin123` (auth email `admin@branch.local`, profile role `owner`, branch `ho`).
- **Staff:** created either in-app (Settings → Add staff — needs the edge function) OR via Supabase dashboard: Authentication → Add user (`seppa@branch.local`, Auto-Confirm ON), then set their profile with SQL:
  ```sql
  insert into public.profiles (id, name, role, branch_id)
  select id, 'NAME', 'staff', 'seppa'
  from auth.users where email = 'seppa@branch.local'
  on conflict (id) do update set role='staff', branch_id='seppa', name=excluded.name;
  ```
  Branch codes: `seppa`, `dirang`, head office `ho`. After changing a profile, the user must **sign out & sign in** (profile is read at login).

## Data model (Supabase tables)
`branches` (id text: ho/seppa/dirang, name, location, active_staff) ·
`profiles` (id→auth.users, name, phone, role[owner|staff], branch_id) ·
`products` (name, unit, sale_price, cost_price, low_stock_at, **branch_id nullable=all branches**, deleted_at) ·
`sales` (client-uuid id, branch_id, created_by, product, qty, price, total, **discount**, **bill_no**, **payment_mode** cash|upi|credit, created_at, deleted_at) ·
`purchases` (id, branch_id, supplier, product, qty, cost, total, **invoice_no**, **payment_mode** cash|credit, **note**, created_at, deleted_at) ·
`customers` (branch_id, name, phone, balance_due, deleted_at) ·
`bills` (branch_id, customer_name, amount, paid, due_amount, status unpaid|paid, deleted_at) ·
`expenses` (branch_id, category, note, amount, deleted_at) ·
`app_settings` (single row 'main': company, address, phone, gstin, footer — for invoices).
RLS: helper fns `app_role()`, `app_branch()`, `is_owner()`; staff can only read/write their own branch's rows; owner all. Realtime publication includes sales/purchases/bills/expenses/customers. Trigger `handle_new_user` auto-creates a profile from auth user_metadata {name, role, branch_id}.

## Offline sync design
Everything renders from Dexie (works with zero internet). Writes save locally with `_synced=0`; `pushPending()` upserts to Supabase (client UUID = no duplicates) and marks synced; `pullAll()` refreshes, never overwriting locally-unsynced rows; `subscribeRealtime()` writes remote changes into Dexie so owner's `useLiveQuery` views update live. A manual Online/Offline toggle exists for demos.

## Features already built
**Owner (desktop sidebar):** Dashboard (Today/Week/Month/**Custom date range**, 4 stat cards w/ trend deltas, **low-stock alert**, **14-day sales bar chart + payment-split donut**, per-branch cards w/ top items & active staff, recent transactions table w/ search) · Branch detail day book (edit/delete) · Customers (add/edit/delete, **ledger**, search, Excel) · **Sales/Bills history** (grouped by bill_no, filter by payment, **reprint invoice**, Excel) · **Purchases** (supplier/company, invoice no, payment cash/credit, note, date; filters, totals, top-suppliers, add/edit/delete, Excel) · **Inventory** (per-branch computed stock, low-stock, **stock adjustments**) · Day Book (in/purchases/expenses/net, add expense, edit/delete, Excel) · Reports (top products, branch contribution, **sales by staff**) · Settings (**company profile**, products & prices w/ **branch assignment** + add/edit/delete/restore, change my password, **reset staff password**, **staff manager add/list**).
**Staff (mobile, offline-first):** **Billing POS** (multi-item cart, **per-item discount %**, **bill GST %**, payment cash/upi/credit, **sequential bill no per branch** SEP-0001/DIR-0001, Save / **Save & Print itemized invoice**, live stock) · **Purchase** (full professional form) · **Bills/Udhaar** (create, record payment, edit, print, delete) · Customers (add/edit/delete, ledger w/ **bulk settle dues**) · Day Book (add expense, edit/delete) · account menu (change password, sign out).
**Cross-cutting:** soft-delete + restore everywhere, edit everywhere, CSV/Excel export, real-time owner updates, auto-updating service worker.

## Key source files
`web/src/App.tsx` (auth/session/sync orchestration, ErrorBoundary, no-branch guard) · `web/src/index.css` (light theme) · `web/vite.config.ts` (PWA: NetworkFirst HTML, autoUpdate).
`web/src/lib/`: `supabase.ts`, `auth.ts` (idToEmail), `db.ts` (Dexie v3), `sync.ts`, `writes.ts` (createSaleBill, nextBillNo, createPurchase, addCustomer, addBill, recordPayment, settleCustomerDues, addExpense, addStockAdjustment, softDelete, restoreRow, saveEdit, saveProduct, saveSettings), `format.ts`, `types.ts`, `icons.tsx`, `invoice.ts`, `csv.ts`, `excel.ts`.
`web/src/ui/`: `Login.tsx`, `Owner.tsx` (large — dashboard + all owner pages), `Staff.tsx` (large — mobile), `Account.tsx`, `Ledger.tsx`, `Edits.tsx`, `OwnerAdd.tsx`, `Charts.tsx`, `Modal.tsx`, `Toast.tsx`, `ErrorBoundary.tsx`, `shared.ts`.

## WORKFLOW CONSTRAINT (must know)
Claude in Cowork **commits** to the repo but **cannot `git push`** (isolated sandbox, no GitHub creds). **The user runs `git push` from their Mac terminal after each change**, then Vercel auto-deploys. Every change is verified with `tsc -b` + `vite build` in the sandbox before committing.
```bash
cd "/Users/sachinkumar/Desktop/WebSites - WebByte/Branch Management System" && git push
```

## Open items / gotchas
1. **Edge Functions not deployed yet** → in-app "Add staff" / "Reset password" throw a CORS error. Fix: deploy `admin-create-staff` & `admin-reset-password` with `--no-verify-jwt` (CLI) or via Supabase dashboard Edge Functions editor with Verify-JWT OFF. Meanwhile create staff via dashboard + the profiles SQL above.
2. **"No branch assigned" screen** = that user's `profiles.branch_id` is null → run the upsert SQL above, then sign out/in.
3. **Re-run `schema.sql`** after pulling schema changes (new columns: products.branch_id; purchases.invoice_no/payment_mode/note; sales.discount/bill_no/payment_mode).
4. **PWA caching**: after a deploy, old service worker may serve stale files once — hard-clear once (DevTools → Application → Service Workers → Unregister + Clear site data). Auto-update is now enabled so future deploys refresh themselves.
5. Seed products have `branch_id = null` (show as "All") and 0 stock (hence low-stock alerts) until purchases/stock-adjustments are added.

## Roadmap (not yet built)
Barcode scanning for billing · WhatsApp bill/payment reminders · PDF export · scheduled email reports. (Branch-to-branch stock transfer intentionally excluded — branches are independent.)
