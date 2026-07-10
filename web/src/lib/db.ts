import Dexie, { type Table } from "dexie";
import type { Branch, Product, Sale, Purchase, Customer, Bill, Expense, Settings } from "./types";

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
  }
}

export const localdb = new LocalDB();

export async function pendingCount(): Promise<number> {
  const [s, p, c, b, e] = await Promise.all([
    localdb.sales.where("_synced").equals(0).count(),
    localdb.purchases.where("_synced").equals(0).count(),
    localdb.customers.where("_synced").equals(0).count(),
    localdb.bills.where("_synced").equals(0).count(),
    localdb.expenses.where("_synced").equals(0).count(),
  ]);
  return s + p + c + b + e;
}
