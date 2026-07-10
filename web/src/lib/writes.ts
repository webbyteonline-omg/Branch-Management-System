import { localdb } from "./db";
import { supabase } from "./supabase";
import type { Bill, Customer, Product, Expense, Settings } from "./types";

const uuid = () => crypto.randomUUID();

type SyncTable = "sales" | "purchases" | "customers" | "bills" | "expenses";

/** Soft delete — never actually removes data. Sets deleted_at and re-syncs. */
export async function softDelete(table: SyncTable, id: string): Promise<void> {
  const row: any = await (localdb as any)[table].get(id);
  if (!row) return;
  await (localdb as any)[table].put({ ...row, deleted_at: new Date().toISOString(), _synced: 0 });
}
export async function restoreRow(table: SyncTable, id: string): Promise<void> {
  const row: any = await (localdb as any)[table].get(id);
  if (!row) return;
  await (localdb as any)[table].put({ ...row, deleted_at: null, _synced: 0 });
}

/** Add a shop expense — offline-first. */
export async function addExpense(branchId: string, createdBy: string, category: string, note: string, amount: number): Promise<void> {
  const row: Expense = {
    id: uuid(), branch_id: branchId, created_by: createdBy,
    category: category.trim() || "General", note: note.trim(), amount: Number(amount),
    created_at: new Date().toISOString(), deleted_at: null, _synced: 0,
  };
  await localdb.expenses.add(row);
}

/** Owner company profile for invoices (online write, RLS: owner only). */
export async function saveSettings(s: Settings, online: boolean): Promise<boolean> {
  if (!online) return false;
  const row = { ...s, id: "main" };
  const { error } = await supabase.from("app_settings").upsert(row);
  if (error) return false;
  await localdb.settings.put(row);
  return true;
}

/** Add a customer — saved locally first, syncs when online. */
export async function addCustomer(branchId: string, name: string, phone: string): Promise<void> {
  const row: Customer = { id: uuid(), branch_id: branchId, name: name.trim(), phone: phone.trim() || null, balance_due: 0, _synced: 0 };
  await localdb.customers.add(row);
}

/** Create an udhaar bill; increases the customer's balance if they exist. */
export async function addBill(branchId: string, customerName: string, amount: number, paidNow: number): Promise<void> {
  const due = Math.max(0, amount - paidNow);
  const bill: Bill = {
    id: uuid(), branch_id: branchId, customer_name: customerName.trim(),
    amount, paid: paidNow, due_amount: due, status: due <= 0 ? "paid" : "unpaid",
    created_at: new Date().toISOString(), _synced: 0,
  };
  await localdb.bills.add(bill);
  await bumpCustomerBalance(branchId, customerName, due);
}

/** Record a payment against a bill; reduces due and the customer's balance. */
export async function recordPayment(bill: Bill, amount: number): Promise<void> {
  const paid = bill.paid + amount;
  const due = Math.max(0, bill.amount - paid);
  await localdb.bills.put({ ...bill, paid, due_amount: due, status: due <= 0 ? "paid" : "unpaid", _synced: 0 });
  await bumpCustomerBalance(bill.branch_id, bill.customer_name, -amount);
}

async function bumpCustomerBalance(branchId: string, name: string, delta: number) {
  const match = (await localdb.customers.where("branch_id").equals(branchId).toArray())
    .find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  if (match) {
    await localdb.customers.put({ ...match, balance_due: Math.max(0, match.balance_due + delta), _synced: 0 });
  }
}

/** Owner product/price management — writes straight to Supabase (RLS: owner only). */
export async function saveProduct(p: Partial<Product> & { name: string }, online: boolean): Promise<boolean> {
  if (!online) return false;
  const row = {
    id: p.id ?? crypto.randomUUID(),
    name: p.name.trim(), unit: p.unit || "pcs",
    sale_price: Number(p.sale_price) || 0, cost_price: Number(p.cost_price) || 0, active: true,
  };
  const { error } = await supabase.from("products").upsert(row);
  if (error) return false;
  await localdb.products.put(row as Product);
  return true;
}
