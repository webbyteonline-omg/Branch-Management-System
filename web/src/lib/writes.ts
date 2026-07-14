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

export interface CartItem {
  product_id: string; name: string; qty: number; price: number;
  discountType?: "percent" | "flat"; discountValue?: number;
  discount?: number; // legacy percent-only field, kept for older callers
}

/** POS billing: saves a multi-item bill as grouped sales rows sharing one
 *  bill_no + payment mode. Applies per-item discount (percent or flat).
 *  Any unpaid portion creates a linked udhaar entry and bumps the customer's
 *  ledger balance — this is what makes the Ledger/Bills pages update instantly. */
export function branchCode(branch: { id: string; name?: string } | undefined, id: string): string {
  const base = (branch?.name || id).replace(/\s*branch\s*/i, "").trim();
  return base.slice(0, 3).toUpperCase() || id.slice(0, 3).toUpperCase();
}

/** Next sequential bill number for a branch, e.g. SEP-0001 (per branch). */
export async function nextBillNo(branchId: string): Promise<string> {
  const branch = await localdb.branches.get(branchId);
  const prefix = branchCode(branch, branchId);
  const rows = await localdb.sales.where("branch_id").equals(branchId).toArray();
  const re = new RegExp("^" + prefix + "-(\\d+)$");
  let max = 0;
  for (const bn of new Set(rows.map((s) => s.bill_no).filter(Boolean) as string[])) {
    const m = bn.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

export type SaleItemTotal = { lineTotal: number; discountAmt: number };
export function computeLineTotal(qty: number, price: number, discountType?: "percent" | "flat", discountValue?: number): SaleItemTotal {
  const gross = qty * price;
  const dv = Number(discountValue) || 0;
  const discountAmt = discountType === "flat" ? Math.min(gross, dv) : gross * dv / 100;
  return { lineTotal: Math.max(0, gross - discountAmt), discountAmt };
}

export interface PaymentInput {
  mode: "cash" | "upi" | "both" | "credit";
  amountPaid: number;      // 0 = fully unpaid; >= total = fully paid; else partial
  cashAmount?: number;     // only when mode === "both"
  upiAmount?: number;      // only when mode === "both"
}

/** Create/update the customer record automatically the first time a name is
 *  billed (so the name shows up in future dropdowns) — separate from
 *  addCustomer() which is the explicit "Add customer" form action. */
export async function ensureCustomer(branchId: string, name: string, phone?: string): Promise<void> {
  const n = name.trim();
  if (!n || n.toLowerCase() === "walk-in") return;
  const existing = (await localdb.customers.where("branch_id").equals(branchId).toArray())
    .find((c) => c.name.toLowerCase() === n.toLowerCase());
  if (existing) {
    if (phone && !existing.phone) await localdb.customers.put({ ...existing, phone, _synced: 0 });
    return;
  }
  await localdb.customers.add({ id: uuid(), branch_id: branchId, name: n, phone: phone?.trim() || null, balance_due: 0, _synced: 0 });
}

export async function createSaleBill(
  branchId: string, userId: string, customerName: string,
  payment: PaymentInput, items: CartItem[],
): Promise<{ billNo: string; total: number; due: number }> {
  const billNo = await nextBillNo(branchId);
  const cust = customerName.trim() || "Walk-in";
  let total = 0;
  const now = new Date().toISOString();

  for (const it of items) {
    const dType = it.discountType ?? (it.discount ? "percent" : undefined);
    const dValue = it.discountValue ?? it.discount ?? 0;
    const { lineTotal } = computeLineTotal(it.qty, it.price, dType, dValue);
    total += lineTotal;
    await localdb.sales.add({
      id: uuid(), branch_id: branchId, created_by: userId, product_id: it.product_id,
      product_name: it.name, customer_name: cust, qty: it.qty, price: it.price, total: lineTotal,
      discount: dType === "percent" ? dValue : 0, discount_type: dType, discount_value: dValue,
      bill_no: billNo, payment_mode: payment.mode,
      cash_amount: payment.mode === "both" ? Number(payment.cashAmount) || 0 : undefined,
      upi_amount: payment.mode === "both" ? Number(payment.upiAmount) || 0 : undefined,
      created_at: now, deleted_at: null, _synced: 0,
    });
  }

  total = Math.round(total * 100) / 100;
  const paidNow = payment.mode === "credit" ? 0 : Math.min(total, Math.max(0, Number(payment.amountPaid) || 0));
  const due = Math.max(0, total - paidNow);

  if (due > 0) {
    await localdb.bills.add({
      id: uuid(), branch_id: branchId, customer_name: cust, bill_no: billNo,
      amount: total, paid: paidNow, due_amount: due, status: "unpaid",
      created_at: now, deleted_at: null, _synced: 0,
    });
    await ensureCustomer(branchId, cust);
    await bumpCustomerBalance(branchId, cust, due);
  }

  return { billNo, total, due };
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

export interface PurchaseInput {
  productId: string; productName: string; supplier: string;
  qty: number; cost: number; invoiceNo?: string; paymentMode?: "cash" | "credit"; note?: string; date?: string;
}
/** Record a purchase — offline-first. */
export async function createPurchase(branchId: string, userId: string, inp: PurchaseInput): Promise<void> {
  await localdb.purchases.add({
    id: uuid(), branch_id: branchId, created_by: userId, product_id: inp.productId,
    product_name: inp.productName, supplier: inp.supplier.trim(), qty: Number(inp.qty), cost: Number(inp.cost),
    total: Number(inp.qty) * Number(inp.cost), invoice_no: inp.invoiceNo?.trim() || null,
    payment_mode: inp.paymentMode || "cash", note: inp.note?.trim() || null,
    created_at: inp.date ? new Date(inp.date).toISOString() : new Date().toISOString(), deleted_at: null, _synced: 0,
  });
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
    sale_price: Number(p.sale_price) || 0, cost_price: Number(p.cost_price) || 0,
    low_stock_at: Number(p.low_stock_at ?? 5), branch_id: p.branch_id ?? null,
    pieces_per_box: p.pieces_per_box ? Number(p.pieces_per_box) : null, active: true,
  };
  const { error } = await supabase.from("products").upsert(row);
  if (error) return false;
  await localdb.products.put(row as Product);
  return true;
}
