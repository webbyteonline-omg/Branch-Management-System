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

/** Edit any row — saves locally and re-syncs (upsert overwrites the server copy). */
export async function saveEdit(table: SyncTable, row: any): Promise<void> {
  await (localdb as any)[table].put({ ...row, _synced: 0 });
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

export interface CartItem { product_id: string; name: string; qty: number; price: number; discount?: number; }

/** POS billing: saves a multi-item bill as grouped sales rows sharing one
 *  bill_no + payment mode. Applies per-item discount % and a bill-level GST %.
 *  Credit bills also create an udhaar entry and bump the customer balance. */
export async function createSaleBill(
  branchId: string, userId: string, customerName: string,
  paymentMode: "cash" | "upi" | "credit", items: CartItem[], gstPercent = 0,
): Promise<{ billNo: string; total: number }> {
  const billNo = "B-" + Date.now().toString(36).toUpperCase().slice(-7);
  const cust = customerName.trim() || "Walk-in";
  const gst = 1 + (Number(gstPercent) || 0) / 100;
  let total = 0;
  const now = new Date().toISOString();
  for (const it of items) {
    const disc = Number(it.discount) || 0;
    const net = it.qty * it.price * (1 - disc / 100) * gst;
    total += net;
    await localdb.sales.add({
      id: uuid(), branch_id: branchId, created_by: userId, product_id: it.product_id,
      product_name: it.name, customer_name: cust, qty: it.qty, price: it.price, total: net,
      discount: disc, bill_no: billNo, payment_mode: paymentMode, created_at: now, deleted_at: null, _synced: 0,
    });
  }
  if (paymentMode === "credit") {
    await localdb.bills.add({
      id: uuid(), branch_id: branchId, customer_name: cust, amount: total, paid: 0,
      due_amount: total, status: "unpaid", created_at: now, deleted_at: null, _synced: 0,
    });
    await bumpCustomerBalance(branchId, cust, total);
  }
  return { billNo, total };
}

/** Settle a customer's dues across their unpaid bills, oldest first. */
export async function settleCustomerDues(branchId: string, customerName: string, amount: number): Promise<number> {
  let left = Number(amount) || 0;
  const lc = customerName.trim().toLowerCase();
  const bills = (await localdb.bills.where("branch_id").equals(branchId).toArray())
    .filter((b) => !b.deleted_at && b.status === "unpaid" && b.customer_name.toLowerCase() === lc)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  let applied = 0;
  for (const b of bills) {
    if (left <= 0) break;
    const pay = Math.min(left, b.due_amount);
    const paid = b.paid + pay;
    const due = Math.max(0, b.amount - paid);
    await localdb.bills.put({ ...b, paid, due_amount: due, status: due <= 0 ? "paid" : "unpaid", _synced: 0 });
    left -= pay; applied += pay;
  }
  await bumpCustomerBalance(branchId, customerName, -applied);
  return applied;
}

/** Stock adjustment (opening stock / wastage) — recorded as a zero-cost
 *  purchase so it flows into computed inventory. Positive adds, negative removes. */
export async function addStockAdjustment(branchId: string, userId: string, product: { id: string; name: string }, deltaQty: number, reason: string): Promise<void> {
  await localdb.purchases.add({
    id: uuid(), branch_id: branchId, created_by: userId, product_id: product.id,
    product_name: product.name, supplier: `Stock adjustment${reason ? ": " + reason : ""}`,
    qty: Number(deltaQty), cost: 0, total: 0, created_at: new Date().toISOString(), deleted_at: null, _synced: 0,
  });
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
