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
  const [branches, products, sales, purchases, customers, bills, expenses, settings] = await Promise.all([
    supabase.from("branches").select("*"),
    supabase.from("products").select("*"),
    supabase.from("sales").select("*").order("created_at", { ascending: false }).limit(2000),
    supabase.from("purchases").select("*").order("created_at", { ascending: false }).limit(2000),
    supabase.from("customers").select("*"),
    supabase.from("bills").select("*").order("created_at", { ascending: false }),
    supabase.from("expenses").select("*").order("created_at", { ascending: false }).limit(2000),
    supabase.from("app_settings").select("*").eq("id", "main").maybeSingle(),
  ]);

  if (branches.data) await localdb.branches.bulkPut(branches.data as any);
  if (products.data) await localdb.products.bulkPut(products.data as any);
  if (settings.data) await localdb.settings.put(settings.data as any);

  // Never overwrite a locally-unsynced row with the server copy.
  const mergeKeep = async (table: any, rows: any[]) => {
    for (const r of rows) {
      const local = await table.get(r.id);
      if (!local || local._synced !== 0) await table.put({ ...r, _synced: 1 });
    }
  };
  if (sales.data) await mergeKeep(localdb.sales, sales.data);
  if (purchases.data) await mergeKeep(localdb.purchases, purchases.data);
  if (customers.data) await mergeKeep(localdb.customers, customers.data);
  if (bills.data) await mergeKeep(localdb.bills, bills.data);
  if (expenses.data) await mergeKeep(localdb.expenses, expenses.data);
}

/** Upload everything still marked unsynced. Idempotent: the client-generated
 *  uuid is the primary key, so an upsert can safely retry with no duplicates. */
export async function pushPending(): Promise<number> {
  let pushed = 0;

  const sales = await localdb.sales.where("_synced").equals(0).toArray();
  if (sales.length) {
    const { error } = await supabase.from("sales").upsert(sales.map(clean));
    if (!error) {
      await localdb.sales.bulkPut(sales.map((s) => ({ ...s, _synced: 1 })));
      pushed += sales.length;
    }
  }

  const purchases = await localdb.purchases.where("_synced").equals(0).toArray();
  if (purchases.length) {
    const { error } = await supabase.from("purchases").upsert(purchases.map(clean));
    if (!error) {
      await localdb.purchases.bulkPut(purchases.map((p) => ({ ...p, _synced: 1 })));
      pushed += purchases.length;
    }
  }

  const customers = await localdb.customers.where("_synced").equals(0).toArray();
  if (customers.length) {
    const { error } = await supabase.from("customers").upsert(customers.map(clean));
    if (!error) {
      await localdb.customers.bulkPut(customers.map((c) => ({ ...c, _synced: 1 })));
      pushed += customers.length;
    }
  }

  const bills = await localdb.bills.where("_synced").equals(0).toArray();
  if (bills.length) {
    const { error } = await supabase.from("bills").upsert(bills.map(clean));
    if (!error) {
      await localdb.bills.bulkPut(bills.map((b) => ({ ...b, _synced: 1 })));
      pushed += bills.length;
    }
  }

  const expenses = await localdb.expenses.where("_synced").equals(0).toArray();
  if (expenses.length) {
    const { error } = await supabase.from("expenses").upsert(expenses.map(clean));
    if (!error) {
      await localdb.expenses.bulkPut(expenses.map((e) => ({ ...e, _synced: 1 })));
      pushed += expenses.length;
    }
  }
  return pushed;
}

/** Live updates so the owner's dashboard reflects branch activity instantly.
 *  Every insert/update/delete from any device is written into the local store,
 *  and Dexie's live queries re-render the UI within a second — no refresh. */
export function subscribeRealtime(onChange: () => void) {
  const tables: Record<string, any> = {
    sales: localdb.sales, purchases: localdb.purchases, bills: localdb.bills,
    expenses: localdb.expenses, customers: localdb.customers,
  };
  const ch = supabase.channel("branch-activity");
  for (const [name, table] of Object.entries(tables)) {
    ch.on("postgres_changes", { event: "*", schema: "public", table: name }, async (p) => {
      try {
        if (p.eventType === "DELETE" && (p.old as any)?.id) await table.delete((p.old as any).id);
        else if ((p.new as any)?.id) await table.put({ ...(p.new as any), _synced: 1 });
      } catch { /* ignore */ }
      onChange();
    });
  }
  ch.subscribe();
  return () => { supabase.removeChannel(ch); };
}
