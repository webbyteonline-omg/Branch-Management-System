-- ============================================================
--  Branch Manager — Supabase schema + Row-Level Security
--  Run this in Supabase → SQL Editor (once, on a fresh project).
--  Security is enforced IN THE DATABASE: a staff member's phone
--  physically cannot read or write another branch's rows.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- enums ----------
do $$ begin
  create type user_role as enum ('owner', 'staff');
exception when duplicate_object then null; end $$;

do $$ begin
  create type bill_status as enum ('unpaid', 'paid');
exception when duplicate_object then null; end $$;

-- ---------- core tables ----------
create table if not exists public.branches (
  id           text primary key,                 -- 'seppa', 'dirang', 'ho'
  name         text not null,
  location     text,
  active_staff int default 0,
  created_at   timestamptz not null default now()
);

-- profiles extend Supabase auth.users with role + branch
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  phone      text,
  role       user_role not null default 'staff',
  branch_id  text references public.branches(id),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  unit            text not null default 'pcs',
  sale_price      numeric(12,2) not null default 0,
  cost_price      numeric(12,2) not null default 0,
  low_stock_at    numeric(12,2) not null default 5,   -- alert threshold
  branch_id       text references public.branches(id),-- null = available to all branches
  pieces_per_box  numeric(12,2),                       -- e.g. 12 = 1 box has 12 pcs (null/0 = box selling not used for this product)
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz                         -- soft delete
);
alter table public.products add column if not exists branch_id text references public.branches(id);
alter table public.products add column if not exists pieces_per_box numeric(12,2);
alter table public.products add column if not exists box_price numeric(12,2);       -- independent box sale price (bulk discount), null = not sold by box
alter table public.products add column if not exists box_cost_price numeric(12,2);  -- cost per box, for margin reporting
alter table public.products add column if not exists edited_note text;  -- e.g. "Main Office edited this"
-- id was server-default before; staff now create products offline with a
-- client-generated uuid, so upsert-by-id must work the same way sales/purchases do.
alter table public.products alter column id drop default;

-- Transactional tables use a CLIENT-GENERATED uuid as primary key.
-- The phone creates the id offline; sync does an upsert -> the same
-- entry can never be inserted twice (idempotent, zero duplicates).
create table if not exists public.sales (
  id             uuid primary key,
  branch_id      text not null references public.branches(id),
  created_by     uuid references public.profiles(id),
  product_id     uuid references public.products(id),
  product_name   text not null,
  customer_name  text default 'Walk-in',
  qty            numeric(12,2) not null,
  price          numeric(12,2) not null,
  total          numeric(12,2) not null,
  discount       numeric(12,2) not null default 0,  -- percent discount on the line (back-compat)
  discount_type  text,                              -- 'percent' | 'flat'
  discount_value numeric(12,2),                     -- raw entered discount value
  bill_no        text,                              -- groups items of one bill
  payment_mode   text not null default 'cash',      -- cash | upi | credit | both
  cash_amount    numeric(12,2),                     -- only set when payment_mode = 'both'
  upi_amount     numeric(12,2),                     -- only set when payment_mode = 'both'
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  void_at        timestamptz,                       -- voided: bill stays visible (crossed out), excluded from all totals
  void_snapshot  jsonb                               -- original total/customer captured at void time, for the "tap to view" detail
);
-- for existing databases (safe to re-run):
alter table public.sales add column if not exists bill_no text;
alter table public.sales add column if not exists payment_mode text not null default 'cash';
alter table public.sales add column if not exists discount numeric(12,2) not null default 0;
alter table public.sales add column if not exists discount_type text;
alter table public.sales add column if not exists discount_value numeric(12,2);
alter table public.sales add column if not exists cash_amount numeric(12,2);
alter table public.sales add column if not exists upi_amount numeric(12,2);
alter table public.sales add column if not exists void_at timestamptz;
alter table public.sales add column if not exists void_snapshot jsonb;
alter table public.sales add column if not exists box_qty numeric(12,2);   -- informational: boxes in this line (qty still holds total pieces)
alter table public.sales add column if not exists pcs_qty numeric(12,2);   -- informational: loose pieces in this line
alter table public.sales add column if not exists box_price numeric(12,2); -- informational: box price used, if any
alter table public.sales add column if not exists edited_note text;        -- e.g. "Main Office edited this"

create table if not exists public.purchases (
  id            uuid primary key,
  branch_id     text not null references public.branches(id),
  created_by    uuid references public.profiles(id),
  product_id    uuid references public.products(id),
  product_name  text not null,
  supplier      text,
  qty           numeric(12,2) not null,
  cost          numeric(12,2) not null,
  total         numeric(12,2) not null,
  invoice_no    text,                              -- supplier's bill number
  payment_mode  text not null default 'cash',      -- cash | credit (owed to supplier)
  note          text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
alter table public.purchases add column if not exists invoice_no text;
alter table public.purchases add column if not exists payment_mode text not null default 'cash';
alter table public.purchases add column if not exists note text;
alter table public.purchases add column if not exists edited_note text;

create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  branch_id   text not null references public.branches(id),
  name        text not null,
  phone       text,
  balance_due numeric(12,2) not null default 0,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
alter table public.customers add column if not exists edited_note text;

create table if not exists public.bills (
  id            uuid primary key,
  branch_id     text not null references public.branches(id),
  customer_name text not null,
  bill_no       text,                              -- links back to the sales bill_no, if any
  amount        numeric(12,2) not null,
  paid          numeric(12,2) not null default 0,
  due_amount    numeric(12,2) not null default 0,
  status        bill_status not null default 'unpaid',
  due_date      timestamptz,                        -- when this udhaar is expected to be cleared
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  void_at       timestamptz,                         -- voided: stays visible everywhere, crossed out, excluded from all totals
  void_snapshot jsonb                                -- original amount/paid/due captured at void time, for the "tap to view" detail
);
alter table public.bills add column if not exists bill_no text;
alter table public.bills add column if not exists due_date timestamptz;
alter table public.bills add column if not exists void_at timestamptz;
alter table public.bills add column if not exists void_snapshot jsonb;
alter table public.bills add column if not exists edited_note text;

-- shop expenses (rent, transport, salary, etc.) — feeds the day book
create table if not exists public.expenses (
  id         uuid primary key,
  branch_id  text not null references public.branches(id),
  created_by uuid references public.profiles(id),
  category   text not null default 'General',
  note       text,
  amount     numeric(12,2) not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.expenses add column if not exists edited_note text;

-- single-row company profile used on printed invoices
create table if not exists public.app_settings (
  id         text primary key default 'main',
  company    text default 'My Shop',
  address    text,
  phone      text,
  gstin      text,
  footer     text default 'Thank you for your business!'
);
insert into public.app_settings (id) values ('main') on conflict (id) do nothing;

create index if not exists idx_expenses_branch_time  on public.expenses(branch_id, created_at desc);
create index if not exists idx_sales_branch_time     on public.sales(branch_id, created_at desc);
create index if not exists idx_purchases_branch_time on public.purchases(branch_id, created_at desc);
create index if not exists idx_bills_branch          on public.bills(branch_id);
create index if not exists idx_customers_branch      on public.customers(branch_id);
create index if not exists idx_products_branch       on public.products(branch_id);

-- ---------- helper functions (SECURITY DEFINER avoids RLS recursion) ----------
create or replace function public.app_role()
  returns user_role language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.app_branch()
  returns text language sql stable security definer set search_path = public as
$$ select branch_id from public.profiles where id = auth.uid() $$;

create or replace function public.is_owner()
  returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(public.app_role() = 'owner', false) $$;

-- ---------- enable RLS ----------
alter table public.branches  enable row level security;
alter table public.profiles  enable row level security;
alter table public.products  enable row level security;
alter table public.sales     enable row level security;
alter table public.purchases enable row level security;
alter table public.customers enable row level security;
alter table public.bills     enable row level security;
alter table public.expenses  enable row level security;
alter table public.app_settings enable row level security;

-- reference data: any signed-in user can read; only owner can change
drop policy if exists branches_read on public.branches;
create policy branches_read on public.branches for select to authenticated using (true);
drop policy if exists branches_write on public.branches;
create policy branches_write on public.branches for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- products: everyone can read all products (needed for cross-branch billing lookups).
-- Writes: owner can touch anything; staff can create/edit/delete only products
-- scoped to their own branch (branch_id = their branch) — never the shared
-- (branch_id null = all-branches) catalog, which stays owner-managed.
drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated using (true);
drop policy if exists products_write on public.products;
create policy products_write on public.products for all to authenticated
  using (public.is_owner() or branch_id = public.app_branch())
  with check (public.is_owner() or branch_id = public.app_branch());

-- profiles: owner sees all; a user always sees own row
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (public.is_owner() or id = auth.uid());
drop policy if exists profiles_write on public.profiles;
create policy profiles_write on public.profiles for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- branch-scoped tables: owner = all branches, staff = own branch only
do $$
declare t text;
begin
  foreach t in array array['sales','purchases','customers','bills','expenses'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format($f$create policy %I_read on public.%I for select to authenticated
      using (public.is_owner() or branch_id = public.app_branch())$f$, t, t);

    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($f$create policy %I_write on public.%I for all to authenticated
      using (public.is_owner() or branch_id = public.app_branch())
      with check (public.is_owner() or branch_id = public.app_branch())$f$, t, t);
  end loop;
end $$;

-- app_settings: readable by all signed-in users, writable by owner only
drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select to authenticated using (true);
drop policy if exists settings_write on public.app_settings;
create policy settings_write on public.app_settings for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- ---------- realtime (owner dashboard updates live) ----------
do $$ begin
  alter publication supabase_realtime add table public.sales;
  alter publication supabase_realtime add table public.purchases;
  alter publication supabase_realtime add table public.bills;
  alter publication supabase_realtime add table public.expenses;
  alter publication supabase_realtime add table public.products;
exception when duplicate_object then null; end $$;

-- ---------- auto-create a profile when a new auth user is added ----------
-- Owner creates staff in Supabase Auth with user_metadata {name, role, branch_id}.
create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, phone, role, branch_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    new.raw_user_meta_data->>'phone',
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'staff'),
    new.raw_user_meta_data->>'branch_id'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- server-side total validation (anti-tamper) ----------
-- A modified client could otherwise POST a fabricated `total` on a sale or
-- purchase while keeping qty/price small. These triggers recompute the
-- expected amount from qty/price/discount (percent or flat) and reject
-- totals that fall outside a small rounding tolerance. Billing is simple
-- (no GST), so this is a tight check, not a range.
create or replace function public.check_sale_total()
  returns trigger language plpgsql as $$
declare gross numeric(12,2); disc numeric(12,2); expected numeric(12,2);
begin
  gross := new.qty * new.price;
  if new.discount_type = 'flat' then
    disc := coalesce(new.discount_value, 0);
  else
    disc := gross * coalesce(new.discount_value, new.discount, 0) / 100.0;
  end if;
  expected := round(greatest(0, gross - disc), 2);
  if abs(new.total - expected) > 1.0 then
    raise exception 'sales.total (%) does not match expected amount % (qty*price minus discount)', new.total, expected;
  end if;
  return new;
end $$;

drop trigger if exists trg_check_sale_total on public.sales;
create trigger trg_check_sale_total
  before insert or update on public.sales
  for each row execute function public.check_sale_total();

create or replace function public.check_purchase_total()
  returns trigger language plpgsql as $$
declare expected numeric(12,2);
begin
  expected := round(new.qty * new.cost, 2);
  if abs(new.total - expected) > 1.0 then
    raise exception 'purchases.total (%) does not match qty*cost = %', new.total, expected;
  end if;
  return new;
end $$;

drop trigger if exists trg_check_purchase_total on public.purchases;
create trigger trg_check_purchase_total
  before insert or update on public.purchases
  for each row execute function public.check_purchase_total();
