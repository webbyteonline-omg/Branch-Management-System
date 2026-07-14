import type { Profile, Sale, Purchase } from "./../lib/types";

export interface SharedProps {
  profile: Profile;
  online: boolean;
  onToggleOnline: () => void;
  onLogout: () => void;
  onSync: () => void;
  syncError?: string | null;
}

export const sum = <T,>(rows: T[], k: keyof T) =>
  rows.reduce((a, x) => a + (Number(x[k]) || 0), 0);

// Hide soft-deleted rows from normal views.
export const live = <T extends { deleted_at?: string | null }>(rows: T[]) =>
  rows.filter((r) => !r.deleted_at);
export const deletedOnly = <T extends { deleted_at?: string | null }>(rows: T[]) =>
  rows.filter((r) => !!r.deleted_at);

// Current stock for a product at a branch = purchases in − sales out (live rows only).
export function computeStock(productId: string, branchId: string, sales: Sale[], purchases: Purchase[]): number {
  const inQty = purchases.filter((p) => !p.deleted_at && p.branch_id === branchId && p.product_id === productId).reduce((a, p) => a + Number(p.qty), 0);
  const outQty = sales.filter((s) => !s.deleted_at && s.branch_id === branchId && s.product_id === productId).reduce((a, s) => a + Number(s.qty), 0);
  return inQty - outQty;
}

export function topItems(sales: Sale[], n = 3): string[] {
  const m: Record<string, number> = {};
  sales.forEach((s) => { m[s.product_name] = (m[s.product_name] || 0) + s.total; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
}

export const shortBranch = (name: string) => name.replace(" Branch", "");

// Products available at a branch: its own products + shared (branch_id null).
export function productsForBranch<T extends { branch_id?: string | null; deleted_at?: string | null }>(products: T[], branchId: string): T[] {
  return products.filter((p) => !p.deleted_at && (!p.branch_id || p.branch_id === branchId));
}
