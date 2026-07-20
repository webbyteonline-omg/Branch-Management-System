import Dexie, { type Table } from "dexie";
import type { Branch, Product, Sale, Purchase, Customer, Bill, Expense, Settings, Payment } from "./types";

// Local mirror of the server. Everything renders from here, so the app
// works with zero internet. `_synced = 0` marks rows still to upload.
export class LocalDB extends Dexie {
  branches!: Table<Branch, string>;
  products!: Table<Product, string>;
  sales!: Table<Sale, string>;
  purchases!: Table<Purchase, string>;
  customers!: Table<Customer, string>;
  bills!: Table<Bill, string>;
  expenses!: Table<Expense, string>;
  settings!: Table<Settings, string>;
  payments!: Table<Payment, string>;

  constructor() {
    super("branchmgr");
    this.version(1).stores({
      branches: "id",
      products: "id",
      sales: "id, branch_id, created_at, _synced",
      purchases: "id, branch_id, created_at, _synced",
      customers: "id, branch_id",
      bills: "id, branch_id",
    });
    // v2: track sync state on customers & bills too (offline create/edit)
    this.version(2).stores({
      customers: "id, branch_id, _synced",
      bills: "id, branch_id, _synced",
    });
    // v3: expenses + company settings
    this.version(3).stores({
      expenses: "id, branch_id, created_at, _synced",
      settings: "id",
    });
    // v4: products now sync offline too (staff can add/edit/delete their branch's products)
    this.version(4).stores({
      products: "id, branch_id, _synced",
    });
    // v5: payment history log (per-bill payment events, cash/UPI breakdown)
    this.version(5).stores({
      payments: "id, branch_id, created_at, _synced",
    });
  }
}

export const localdb = new LocalDB();

/** Confirms IndexedDB actually opened (rare but real: full storage, private
 *  browsing mode on some browsers, or a corrupted DB from an old version can
 *  all make this reject). Call once at app boot — if it throws, nothing that
 *  writes to `localdb` can work, so the app should show a clear blocking
 *  error instead of silently failing every save afterwards. */
export async function ensureDbReady(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await localdb.open();
    return { ok: true };
  } catch (e: any) {
    console.error("[db] failed to open local database:", e);
    return { ok: false, message: e?.message || "Could not open local storage" };
  }
}

export async function pendingCount(): Promise<number> {
  const [s, p, c, b, e, pr, pay] = await Promise.all([
    localdb.sales.where("_synced").equals(0).count(),
    localdb.purchases.where("_synced").equals(0).count(),
    localdb.customers.where("_synced").equals(0).count(),
    localdb.bills.where("_synced").equals(0).count(),
    localdb.expenses.where("_synced").equals(0).count(),
    localdb.products.where("_synced").equals(0).count(),
    localdb.payments.where("_synced").equals(0).count(),
  ]);
  return s + p + c + b + e + pr + pay;
}

/** Per-table pending breakdown — powers the Sync Status detail view so
 *  someone can see exactly what's still waiting to reach Head Office. */
export async function pendingBreakdown(): Promise<{ table: string; label: string; count: number }[]> {
  const [sales, purchases, customers, bills, expenses, products, payments] = await Promise.all([
    localdb.sales.where("_synced").equals(0).count(),
    localdb.purchases.where("_synced").equals(0).count(),
    localdb.customers.where("_synced").equals(0).count(),
    localdb.bills.where("_synced").equals(0).count(),
    localdb.expenses.where("_synced").equals(0).count(),
    localdb.products.where("_synced").equals(0).count(),
    localdb.payments.where("_synced").equals(0).count(),
  ]);
  return [
    { table: "sales", label: "Bills / sales", count: sales },
    { table: "purchases", label: "Purchases", count: purchases },
    { table: "bills", label: "Udhaar bills", count: bills },
    { table: "customers", label: "Customers", count: customers },
    { table: "products", label: "Products", count: products },
    { table: "expenses", label: "Expenses", count: expenses },
    { table: "payments", label: "Payments", count: payments },
  ].filter((x) => x.count > 0);
}
