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
    sales.data ? mergeKeep(localdb.sales, sales.data) : null,
    purchases.data ? mergeKeep(localdb.purchases, purchases.data) : null,
    customers.data ? mergeKeep(localdb.customers, customers.data) : null,
    bills.data ? mergeKeep(localdb.bills, bills.data) : null,
    expenses.data ? mergeKeep(localdb.expenses, expenses.data) : null,
  ]);
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
 *  and Dexie's live queries re-render the UI within a second — no refresh.
 *  Reconnects automatically if the socket drops (flaky mountain internet) —
 *  Supabase channels don't always self-heal after a network blip. */
export function subscribeRealtime(onChange: () => void) {
  const tables: Record<string, any> = {
    sales: localdb.sales, purchases: localdb.purchases, bills: localdb.bills,
    expenses: localdb.expenses, customers: localdb.customers,
  };
  let ch: ReturnType<typeof supabase.channel> | null = null;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (stopped) return;
    ch = supabase.channel("branch-activity-" + Date.now());
    for (const [name, table] of Object.entries(tables)) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: name }, async (p) => {
        try {
          if (p.eventType === "DELETE" && (p.old as any)?.id) await table.delete((p.old as any).id);
          else if ((p.new as any)?.id) await table.put({ ...(p.new as any), _synced: 1 });
        } catch { /* ignore */ }
        onChange();
      });
    }
    ch.subscribe((status) => {
      if (stopped) return;
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        // Drop and reconnect after a short delay instead of staying dead silently.
        if (ch) supabase.removeChannel(ch);
        retryTimer = setTimeout(connect, 4000);
      }
    });
  };
  connect();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (ch) supabase.removeChannel(ch);
  };
}
