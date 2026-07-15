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
  sale_price: number;
  cost_price: number;
  low_stock_at?: number;
  branch_id?: string | null; // null = all branches
  pieces_per_box?: number | null; // e.g. 12 = 1 box has 12 pcs; null/0 = box selling not used
  active?: boolean;
  deleted_at?: string | null;
  _synced?: 0 | 1;
}

export interface Sale {
  id: string;
  branch_id: string;
  created_by?: string | null;
  product_id?: string | null;
  product_name: string;
  customer_name?: string;
  qty: number;
  price: number;
  total: number;
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
  _synced?: 0 | 1; // local-only flag (not sent to server)
}

export interface Purchase {
  id: string;
  branch_id: string;
  created_by?: string | null;
  product_id?: string | null;
  product_name: string;
  supplier?: string;
  qty: number;
  cost: number;
  total: number;
  invoice_no?: string | null;
  payment_mode?: "cash" | "credit";
  note?: string | null;
  created_at: string;
  deleted_at?: string | null;
  _synced?: 0 | 1;
}

export interface Customer {
  id: string;
  branch_id: string;
  name: string;
  phone?: string | null;
  balance_due: number;
  deleted_at?: string | null;
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
