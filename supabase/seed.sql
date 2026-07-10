-- ============================================================
--  Seed reference data — run AFTER schema.sql.
--  Users are created in Supabase Auth (see DEPLOY.md), not here.
-- ============================================================

insert into public.branches (id, name, location, active_staff) values
  ('ho',     'Head Office',   'Main Office',        0),
  ('seppa',  'Seppa Branch',  'Seppa, Arunachal',   6),
  ('dirang', 'Dirang Branch', 'Dirang, Arunachal',  4)
on conflict (id) do update set name = excluded.name, location = excluded.location, active_staff = excluded.active_staff;

insert into public.products (name, unit, sale_price, cost_price) values
  ('Bisleri 1L (box)',    'box',   240, 200),
  ('Bisleri 500ml (box)', 'box',   180, 150),
  ('Rice 25kg bag',       'bag',  1250,1100),
  ('Sugar 1kg',           'kg',     48,  42),
  ('Cooking Oil 1L',      'ltr',   145, 128),
  ('Maggi (pack)',        'pack',   14,  11),
  ('Tea 250g',            'pack',  130, 112),
  ('Biscuit (box)',       'box',   300, 260),
  ('Cement bag 50kg',     'bag',   410, 370),
  ('Cold Drink (crate)',  'crate', 520, 460)
on conflict do nothing;
