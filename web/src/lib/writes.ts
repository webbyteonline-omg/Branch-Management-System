import { localdb } from "./db";
import { supabase } from "./supabase";
import type { Bill, Customer, Product, Expense, Settings, Payment } from "./types";

const uuid = () => crypto.randomUUID();

type SyncTable = "sales" | "purchases" | "customers" | "bills" | "expenses" | "products";

/** Soft delete — never actually removes data. Sets deleted_at and re-syncs.
 *  editorTag: pass e.g. "Main Office" when the Owner performs the delete
 *  (as opposed to the branch's own staff) so the row carries a small,
 *  visible note about who touched it. Left undefined for normal staff
 *  actions — no note is added or changed in that case. */
export async function softDelete(table: SyncTable, id: string, editorTag?: string): Promise<void> {
  const row: any = await (localdb as any)[table].get(id);
  if (!row) return;
  await (localdb as any)[table].put({ ...row, deleted_at: new Date().toISOString(), _synced: 0, ...(editorTag ? { edited_note: `${editorTag} deleted this` } : {}) });
}
export async function restoreRow(table: SyncTable, id: string): Promise<void> {
  const row: any = await (localdb as any)[table].get(id);
  if (!row) return;
  await (localdb as any)[table].put({ ...row, deleted_at: null, _synced: 0 });
}

/** Edit any row — saves locally and re-syncs (upsert overwrites the server copy).
 *  editorTag: see softDelete — stamps a small "X edited this" note on the row. */
export async function saveEdit(table: SyncTable, row: any, editorTag?: string): Promise<void> {
  await (localdb as any)[table].put({ ...row, _synced: 0, ...(editorTag ? { edited_note: `${editorTag} edited this` } : {}) });
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
  // Box/piece split — when a product has an independent box price, qty×price
  // no longer equals the true line total, so the caller pre-computes it here.
  // boxQty/pcsQty are stored on the Sale row purely for display (qty stays
  // the piece-equivalent total for stock math); price is then back-computed
  // as a blended per-piece rate so qty×price still equals lineTotalOverride
  // (keeps the server's check_sale_total trigger satisfied without changes).
  lineTotalOverride?: number;
  boxQty?: number; pcsQty?: number; boxPrice?: number;
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
    let lineTotal: number; let effPrice = it.price;
    if (it.lineTotalOverride !== undefined) {
      // Box-priced line: it.price is the piece rate, but the true amount
      // owed is boxQty×boxPrice + pcsQty×price, not qty×price. Apply the
      // discount to that real amount, then back-compute a blended per-piece
      // rate so qty×price still equals the stored total (satisfies the
      // server's check_sale_total trigger, which only knows qty×price).
      const gross = it.lineTotalOverride;
      const discAmt = dType === "flat" ? Math.min(gross, dValue) : gross * dValue / 100;
      lineTotal = Math.max(0, gross - discAmt);
      effPrice = it.qty > 0 ? Math.round((lineTotal / it.qty) * 100) / 100 : it.price;
    } else {
      lineTotal = computeLineTotal(it.qty, it.price, dType, dValue).lineTotal;
    }
    total += lineTotal;
    await localdb.sales.add({
      id: uuid(), branch_id: branchId, created_by: userId, product_id: it.product_id,
      product_name: it.name, customer_name: cust, qty: it.qty, price: effPrice, total: lineTotal,
      discount: dType === "percent" ? dValue : 0, discount_type: dType, discount_value: dValue,
      bill_no: billNo, payment_mode: payment.mode,
      cash_amount: payment.mode === "both" ? Number(payment.cashAmount) || 0 : undefined,
      upi_amount: payment.mode === "both" ? Number(payment.upiAmount) || 0 : undefined,
      box_qty: it.boxQty, pcs_qty: it.pcsQty, box_price: it.boxPrice,
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
    .filter((b) => !b.deleted_at && !b.void_at && b.status === "unpaid" && b.customer_name.toLowerCase() === lc)
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

export interface PurchaseCartItem {
  product_id?: string; product_name: string; qty: number; cost: number;
  // Box/piece split — same purpose as CartItem's boxQty/pcsQty/lineTotalOverride:
  // qty stays the piece-equivalent total for stock math, lineTotalOverride is
  // the true line amount (box_qty×box_cost + pcs_qty×cost) when it differs
  // from qty×cost, and cost is then back-computed as a blended per-piece rate
  // so qty×cost still equals the stored total.
  boxQty?: number; pcsQty?: number; boxCost?: number; lineTotalOverride?: number;
}

/** Auto-generate a purchase invoice number when the user leaves it blank —
 *  kept intentionally simple (client-side, timestamp-based) rather than a
 *  server-side sequential counter like nextBillNo, since invoice numbers for
 *  purchases are supplier-provided in real use; this is just a safe fallback
 *  so invoice_no is never empty when grouping into PreviousPurchases. */
export function nextPurchaseNo(): string {
  return `PUR-${Date.now().toString(36).toUpperCase()}`;
}

/** Record a multi-item purchase invoice — saves one `purchases` row per item,
 *  all sharing one invoice_no + payment mode, mirroring createSaleBill's
 *  bill_no grouping so PreviousPurchases can group rows the same way
 *  PreviousBills groups sales rows. */
export async function createPurchaseInvoice(
  branchId: string, userId: string, supplier: string, invoiceNo: string | undefined,
  payment: PaymentInput, items: PurchaseCartItem[],
): Promise<{ invoiceNo: string; total: number }> {
  const inv = invoiceNo?.trim() || nextPurchaseNo();
  const sup = supplier.trim();
  const now = new Date().toISOString();
  let total = 0;

  for (const it of items) {
    let lineTotal: number; let effCost = it.cost;
    if (it.lineTotalOverride !== undefined) {
      lineTotal = it.lineTotalOverride;
      effCost = it.qty > 0 ? Math.round((lineTotal / it.qty) * 100) / 100 : it.cost;
    } else {
      lineTotal = it.qty * it.cost;
    }
    total += lineTotal;
    await localdb.purchases.add({
      id: uuid(), branch_id: branchId, created_by: userId, product_id: it.product_id ?? null,
      product_name: it.product_name, supplier: sup, qty: it.qty, cost: effCost, total: Math.round(lineTotal * 100) / 100,
      box_qty: it.boxQty, pcs_qty: it.pcsQty, box_cost: it.boxCost,
      invoice_no: inv, payment_mode: payment.mode,
      cash_amount: payment.mode === "both" ? Number(payment.cashAmount) || 0 : undefined,
      upi_amount: payment.mode === "both" ? Number(payment.upiAmount) || 0 : undefined,
      note: null, created_at: now, deleted_at: null, _synced: 0,
    });
  }

  total = Math.round(total * 100) / 100;
  return { invoiceNo: inv, total };
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
export async function saveSettings(s: Settings, online: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!online) return { ok: false, error: "You're offline right now — try again once you have a connection." };
  const row = { ...s, id: "main" };
  const { error } = await supabase.from("app_settings").upsert(row);
  if (error) return { ok: false, error: error.message };
  await localdb.settings.put(row);
  return { ok: true };
}

/** Add a customer — saved locally first, syncs when online. */
export async function addCustomer(branchId: string, name: string, phone: string): Promise<void> {
  const row: Customer = { id: uuid(), branch_id: branchId, name: name.trim(), phone: phone.trim() || null, balance_due: 0, active: true, _synced: 0 };
  await localdb.customers.add(row);
}

/** Toggle a customer's active/inactive status — a soft flag (still counts
 *  toward dues/ledger/history everywhere), purely for the Customers list's
 *  Active/Inactive filter. Not a delete — no data is hidden or removed. */
export async function setCustomerActive(customer: Customer, active: boolean): Promise<void> {
  await localdb.customers.put({ ...customer, active, _synced: 0 });
}

/** Create an udhaar bill; increases the customer's balance if they exist. */
export async function addBill(branchId: string, customerName: string, amount: number, paidNow: number, dueDate?: string | null): Promise<void> {
  const due = Math.max(0, amount - paidNow);
  const bill: Bill = {
    id: uuid(), branch_id: branchId, customer_name: customerName.trim(),
    amount, paid: paidNow, due_amount: due, status: due <= 0 ? "paid" : "unpaid",
    due_date: dueDate || null,
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

/** Record a payment against ONE specific bill — this is the function to use
 *  going forward for "pay this bill" flows (Unpaid Bills' per-bill Pay Now,
 *  Ledger's per-bill Add Payment). Unlike settleCustomerDues (oldest-first,
 *  auto-split across all of a customer's unpaid bills), this reduces exactly
 *  the bill passed in — and logs the event into localdb.payments so a
 *  history / "Settled" view can show every past payment with its cash/UPI
 *  breakdown. Does NOT replace recordPayment or settleCustomerDues — both
 *  are still used elsewhere (StaffLedger/Ledger's settle-all flow). */
export async function recordBillPayment(
  branchId: string, userId: string, bill: Bill,
  payment: { amount: number; cashAmount?: number; upiAmount?: number; mode: "cash" | "upi" | "both" },
): Promise<void> {
  const amount = Number(payment.amount) || 0;
  const paid = bill.paid + amount;
  const due = Math.max(0, bill.amount - paid);
  await localdb.bills.put({ ...bill, paid, due_amount: due, status: due <= 0 ? "paid" : "unpaid", _synced: 0 });
  await bumpCustomerBalance(branchId, bill.customer_name, -amount);

  const row: Payment = {
    id: uuid(), branch_id: branchId, bill_id: bill.id, customer_name: bill.customer_name,
    amount,
    cash_amount: payment.mode === "both" ? payment.cashAmount : (payment.mode === "cash" ? amount : undefined),
    upi_amount: payment.mode === "both" ? payment.upiAmount : (payment.mode === "upi" ? amount : undefined),
    mode: payment.mode, created_by: userId, created_at: new Date().toISOString(), deleted_at: null, _synced: 0,
  };
  await localdb.payments.add(row);
}

/** Void an udhaar bill — stays visible everywhere (crossed out / VOID label,
 *  tap to see what it was), but its due is fully reversed off the customer's
 *  balance and it's excluded from every total/report from this point on.
 *  Unlike softDelete, a void is not restorable — it's a permanent correction
 *  ("this bill should never have counted"), so the original numbers are kept
 *  in void_snapshot purely for on-screen reference. */
export async function voidBill(bill: Bill): Promise<void> {
  if (bill.void_at) return;
  if (bill.status === "unpaid" && bill.due_amount > 0) {
    await bumpCustomerBalance(bill.branch_id, bill.customer_name, -bill.due_amount);
  }
  await localdb.bills.put({
    ...bill, void_at: new Date().toISOString(),
    void_snapshot: { amount: bill.amount, paid: bill.paid, due_amount: bill.due_amount, status: bill.status },
    due_amount: 0, status: "paid", _synced: 0,
  });
}

/** Void a POS bill (all sales rows sharing one bill_no) — same "stays visible,
 *  crossed out, excluded from totals" treatment as voidBill. Also voids the
 *  linked udhaar bill (if any) so the customer's balance clears fully. */
export async function voidSaleGroup(branchId: string, billNo: string): Promise<void> {
  const rows = (await localdb.sales.where("branch_id").equals(branchId).toArray())
    .filter((s) => (s.bill_no || s.id) === billNo && !s.void_at);
  const now = new Date().toISOString();
  for (const s of rows) {
    await localdb.sales.put({
      ...s, void_at: now,
      void_snapshot: { product_name: s.product_name, customer_name: s.customer_name, qty: s.qty, price: s.price, total: s.total },
      _synced: 0,
    });
  }
  const linkedBills = (await localdb.bills.where("branch_id").equals(branchId).toArray())
    .filter((b) => b.bill_no === billNo && !b.void_at);
  for (const b of linkedBills) await voidBill(b);
}

/** Public wrapper — lets edit flows (EditBillModal) adjust a customer's
 *  balance by a known delta when they change a bill's amount/paid directly,
 *  so the ledger stays in sync with hand-edited bills. */
export async function bumpCustomerBalanceFor(branchId: string, name: string, delta: number): Promise<void> {
  return bumpCustomerBalance(branchId, name, delta);
}

async function bumpCustomerBalance(branchId: string, name: string, delta: number) {
  const match = (await localdb.customers.where("branch_id").equals(branchId).toArray())
    .find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  if (match) {
    await localdb.customers.put({ ...match, balance_due: Math.max(0, match.balance_due + delta), _synced: 0 });
  }
}

/** Keep a POS bill's linked udhaar row (bills table, same bill_no) and the
 *  customer's balance in sync after editing the underlying sales lines'
 *  qty/price (EditBillGroupModal). The bill's `amount` is rescaled to the
 *  new sales total, `paid` stays what it was, `due_amount` is recomputed —
 *  and the customer's balance is adjusted by exactly the due_amount delta
 *  (not the raw total), so an already-partially-paid bill doesn't get
 *  double-counted. No-op if there's no linked unpaid/partial bill for this
 *  bill_no (i.e. the original sale was paid in full, nothing to reconcile).
 *  Customer renames are intentionally NOT moved here — the bill keeps its
 *  original customer_name for balance purposes to avoid double-moving money;
 *  rename the customer separately via Edit customer if needed. */
export async function syncLinkedBillTotal(branchId: string, billNo: string, newSalesTotal: number): Promise<void> {
  const linked = (await localdb.bills.where("branch_id").equals(branchId).toArray())
    .find((b) => b.bill_no === billNo && !b.deleted_at && !b.void_at);
  if (!linked) return;
  const due = Math.max(0, newSalesTotal - linked.paid);
  const delta = due - linked.due_amount;
  await localdb.bills.put({ ...linked, amount: newSalesTotal, due_amount: due, status: due <= 0 ? "paid" : "unpaid", _synced: 0 });
  if (delta !== 0) await bumpCustomerBalance(branchId, linked.customer_name, delta);
}

/** Product add/edit — offline-first, same pattern as sales/purchases. Owner
 *  can touch any product (incl. the shared branch_id-null catalog); staff can
 *  only create/edit products scoped to their own branch (RLS enforces this
 *  server-side too — see products_write policy). */
export async function saveProduct(p: Partial<Product> & { name: string }, branchId?: string | null): Promise<boolean> {
  const row: Product = {
    id: p.id ?? crypto.randomUUID(),
    name: p.name.trim(), unit: p.unit || "pcs",
    sale_price: Number(p.sale_price) || 0, cost_price: Number(p.cost_price) || 0,
    box_price: p.box_price ? Number(p.box_price) : null,
    box_cost_price: p.box_cost_price ? Number(p.box_cost_price) : null,
    low_stock_at: Number(p.low_stock_at ?? 5),
    branch_id: p.branch_id !== undefined ? p.branch_id : (branchId ?? null),
    pieces_per_box: p.pieces_per_box ? Number(p.pieces_per_box) : null, active: true,
    deleted_at: null, edited_note: p.edited_note ?? null, _synced: 0,
  };
  await localdb.products.put(row);
  return true;
}
