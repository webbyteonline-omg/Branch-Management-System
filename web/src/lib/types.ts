export type Role = "owner" | "staff";

export interface Profile {
  id: string;
  name: string;
  phone?: string | null;
  role: Role;
  branch_id: string | null;
}

export interface Branch {
  id: string;
  name: string;
  location?: string | null;
  active_staff: number;
}

export interface Product {
  id: string;
  name: string;
  unit: string;
  sale_price: number;    // price per piece
  cost_price: number;    // cost per piece
  box_price?: number | null;   // independent box price (e.g. bulk discount) — null = not sold by box, or not priced separately (falls back to pieces_per_box × sale_price)
  box_cost_price?: number | null; // cost per box, if bought by box (for margin reporting) — null = falls back to pieces_per_box × cost_price
  low_stock_at?: number;
  branch_id?: string | null; // null = all branches
  pieces_per_box?: number | null; // e.g. 12 = 1 box has 12 pcs; null/0 = box selling not used
  active?: boolean;
  deleted_at?: string | null;
  edited_note?: string | null; // e.g. "Main Office edited this" — set when the owner touches a branch's row
  _synced?: 0 | 1;
}

export interface Sale {
  id: string;
  branch_id: string;
  created_by?: string | null;
  product_id?: string | null;
  product_name: string;
  customer_name?: string;
  qty: number;    // total pieces (box_qty × pieces_per_box + pcs_qty) — used for stock math
  price: number;  // effective per-piece price = total ÷ qty (blended, so qty×price always reconciles with total even when a box was priced independently)
  total: number;
  box_qty?: number;   // informational: how many boxes were in this line (0 if sold by piece only)
  pcs_qty?: number;   // informational: how many loose pieces were in this line
  box_price?: number | null; // informational: the box price used, if any
  discount?: number; // percent discount amount (kept for back-compat / server trigger)
  discount_type?: "percent" | "flat";
  discount_value?: number; // the raw entered value (percent number or flat rupees)
  payment_mode?: "cash" | "upi" | "credit" | "both";
  cash_amount?: number; // only used when payment_mode === "both"
  upi_amount?: number;  // only used when payment_mode === "both"
  bill_no?: string | null;
  created_at: string;
  deleted_at?: string | null;
  void_at?: string | null;       // voided: stays visible everywhere (crossed out), excluded from all totals
  void_snapshot?: { product_name: string; customer_name?: string; qty: number; price: number; total: number } | null;
  edited_note?: string | null; // e.g. "Main Office edited this"
  _synced?: 0 | 1; // local-only flag (not sent to server)
}

export interface Purchase {
  id: string;
  branch_id: string;
  created_by?: string | null;
  product_id?: string | null;
  product_name: string;
  supplier?: string;
  qty: number;    // total pieces (box_qty × pieces_per_box + pcs_qty) — used for stock math
  cost: number;   // effective per-piece cost = total ÷ qty (blended, mirrors Sale.price)
  total: number;
  box_qty?: number | null;   // informational: how many boxes/cartoons were in this line
  pcs_qty?: number | null;   // informational: how many loose pieces were in this line
  box_cost?: number | null;  // informational: the box/cartoon cost used, if any
  invoice_no?: string | null;
  payment_mode?: "cash" | "upi" | "both" | "credit";
  cash_amount?: number | null; // only used when payment_mode === "both"
  upi_amount?: number | null;  // only used when payment_mode === "both"
  note?: string | null;
  created_at: string;
  deleted_at?: string | null;
  edited_note?: string | null;
  _synced?: 0 | 1;
}

export interface Customer {
  id: string;
  branch_id: string;
  name: string;
  phone?: string | null;
  active?: boolean;
  balance_due: number;
  deleted_at?: string | null;
  edited_note?: string | null;
  _synced?: 0 | 1;
}

export interface Bill {
  id: string;
  branch_id: string;
  customer_name: string;
  bill_no?: string | null; // links back to the sales bill_no this udhaar came from, if any
  amount: number;
  paid: number;
  due_amount: number;
  status: "unpaid" | "paid";
  due_date?: string | null;
  created_at: string;
  deleted_at?: string | null;
  void_at?: string | null;       // voided: stays visible (crossed out, VOID label), excluded from all totals
  void_snapshot?: { amount: number; paid: number; due_amount: number; status: "unpaid" | "paid" } | null;
  edited_note?: string | null;
  _synced?: 0 | 1;
}

export interface Payment {
  id: string;
  branch_id: string;
  bill_id?: string | null;
  customer_name: string;
  amount: number;
  cash_amount?: number | null;
  upi_amount?: number | null;
  mode: "cash" | "upi" | "both";
  created_by?: string | null;
  created_at: string;
  deleted_at?: string | null;
  _synced?: 0 | 1;
}

export interface Expense {
  id: string;
  branch_id: string;
  created_by?: string | null;
  category: string;
  note?: string;
  amount: number;
  created_at: string;
  deleted_at?: string | null;
  edited_note?: string | null;
  _synced?: 0 | 1;
}

export interface Settings {
  id: string;
  company: string;
  address?: string | null;
  phone?: string | null;
  gstin?: string | null;
  footer?: string | null;
}

export type Range = "today" | "week" | "month";
