import { supabase } from "./supabase";
import { localdb } from "./db";
import type { Profile, Sale, Purchase } from "./types";

// Strip local-only fields before sending to the server.
const clean = <T extends { _synced?: number }>(row: T) => {
  const { _synced, ...rest } = row;
  return rest;
};

/** Pull server data into the local store. RLS means a staff phone only
 *  ever receives its own branch's rows — enforced by the database. */
export async function pullAll(profile: Profile): Promise<void> {
  const [branches, products, sales, purchases, customers, bills, expenses, settings, payments] = await Promise.all([
    supabase.from("branches").select("*"),
    supabase.from("products").select("*"),
    supabase.from("sales").select("*").order("created_at", { ascending: false }).limit(2000),
    supabase.from("purchases").select("*").order("created_at", { ascending: false }).limit(2000),
    supabase.from("customers").select("*"),
    supabase.from("bills").select("*").order("created_at", { ascending: false }),
    supabase.from("expenses").select("*").order("created_at", { ascending: false }).limit(2000),
    supabase.from("app_settings").select("*").eq("id", "main").maybeSingle(),
    supabase.from("payments").select("*").order("created_at", { ascending: false }).limit(2000),
  ]);

  if (branches.data) await localdb.branches.bulkPut(branches.data as any);
  if (settings.data) await localdb.settings.put(settings.data as any);

  // Never overwrite a locally-unsynced row with the server copy.
  // Batched: one bulk read of local rows instead of an await-per-row loop,
  // which is what made pullAll() slow once a branch had thousands of rows.
  const mergeKeep = async (table: any, rows: any[]) => {
    if (!rows.length) return;
    const ids = rows.map((r) => r.id);
    const locals = await table.bulkGet(ids);
    const toPut: any[] = [];
    rows.forEach((r, i) => {
      const local = locals[i];
      if (!local || local._synced !== 0) toPut.push({ ...r, _synced: 1 });
    });
    if (toPut.length) await table.bulkPut(toPut);
  };
  await Promise.all([
    products.data ? mergeKeep(localdb.products, products.data) : null,
    sales.data ? mergeKeep(localdb.sales, sales.data) : null,
    purchases.data ? mergeKeep(localdb.purchases, purchases.data) : null,
    customers.data ? mergeKeep(localdb.customers, customers.data) : null,
    bills.data ? mergeKeep(localdb.bills, bills.data) : null,
    expenses.data ? mergeKeep(localdb.expenses, expenses.data) : null,
    payments.data ? mergeKeep(localdb.payments, payments.data) : null,
  ]);
}

/** The local cache only keeps the most recent ~2000 rows per table (fast,
 *  fine for day-to-day screens). Exports/statements need to be complete even
 *  for older custom date ranges, so they fetch straight from the server for
 *  the exact window requested instead of relying on the capped local copy. */
export async function fetchRangeFresh<T = any>(
  table: "sales" | "purchases" | "expenses",
  from: number, to: number, branchIds?: string[] | null,
): Promise<T[]> {
  let q = supabase.from(table).select("*")
    .gte("created_at", new Date(from).toISOString())
    .lte("created_at", new Date(to).toISOString())
    .order("created_at", { ascending: false });
  if (branchIds && branchIds.length) q = q.in("branch_id", branchIds);
  const { data, error } = await q;
  if (error) throw error;
  return (data as T[]) ?? [];
}

export class SyncError extends Error {
  table: string; cause: any;
  constructor(table: string, cause: any) {
    super(`Failed to sync ${table}: ${cause?.message || cause}`);
    this.table = table; this.cause = cause;
  }
}

/** Upload everything still marked unsynced. Idempotent: the client-generated
 *  uuid is the primary key, so an upsert can safely retry with no duplicates.
 *  IMPORTANT: errors are NOT swallowed — a row that fails to push (e.g. a
 *  schema mismatch between the app and the deployed database) stays
 *  _synced:0 forever and previously failed completely silently, with no way
 *  to tell it apart from "just hasn't synced yet". Now every failure is
 *  collected and thrown so the caller can surface it (toast/console) instead
 *  of the data quietly never arriving. */
export async function pushPending(): Promise<{ pushed: number; errors: SyncError[] }> {
  let pushed = 0;
  const errors: SyncError[] = [];

  const tables: { name: SyncTableName; table: any }[] = [
    { name: "products", table: localdb.products },
    { name: "sales", table: localdb.sales },
    { name: "purchases", table: localdb.purchases },
    { name: "customers", table: localdb.customers },
    { name: "bills", table: localdb.bills },
    { name: "expenses", table: localdb.expenses },
    { name: "payments", table: localdb.payments },
  ];

  for (const { name, table } of tables) {
    const rows = await table.where("_synced").equals(0).toArray();
    if (!rows.length) continue;
    const { error } = await supabase.from(name).upsert(rows.map(clean));
    if (error) {
      console.error(`[sync] push failed for ${name}:`, error);
      errors.push(new SyncError(name, error));
    } else {
      await table.bulkPut(rows.map((r: any) => ({ ...r, _synced: 1 })));
      pushed += rows.length;
    }
  }

  return { pushed, errors };
}
type SyncTableName = "sales" | "purchases" | "customers" | "bills" | "expenses" | "products" | "payments";

// Note: this app deliberately does NOT use realtime/websocket sync. Every
// screen syncs once automatically on login/app-open, and otherwise only when
// the user taps the manual "Sync" button (pushPending + pullAll above). Kept
// simple on purpose for a production business tool — no background socket to
// babysit, no silent partial-sync states.
