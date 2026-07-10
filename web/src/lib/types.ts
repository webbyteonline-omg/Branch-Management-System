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
  active?: boolean;
  deleted_at?: string | null;
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
  discount?: number;
  bill_no?: string | null;
  payment_mode?: "cash" | "upi" | "credit";
  created_at: string;
  deleted_at?: string | null;
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
  amount: number;
  paid: number;
  due_amount: number;
  status: "unpaid" | "paid";
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
