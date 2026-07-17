create extension if not exists "pgcrypto";

do $$ begin
  create type public.user_role as enum ('admin', 'picker', 'packer');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.order_status as enum ('uploaded', 'ready_to_pick', 'picking', 'picked', 'ready_to_pack', 'packing', 'packed', 'completed', 'on_hold');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.discrepancy_type as enum ('short_quantity', 'over_quantity', 'wrong_barcode', 'damaged', 'missing_product');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'picker',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

insert into public.profiles (id, full_name)
select id, coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
from auth.users
on conflict (id) do nothing;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  description text not null,
  barcode text unique,
  location text,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_name text not null,
  order_date date,
  due_at timestamptz,
  status public.order_status not null default 'uploaded',
  notes text,
  source_pdf_path text,
  assigned_picker uuid references public.profiles(id),
  assigned_packer uuid references public.profiles(id),
  picking_started_at timestamptz,
  picking_completed_at timestamptz,
  packing_started_at timestamptz,
  packing_completed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id),
  sku text not null,
  description text not null,
  barcode text,
  ordered_quantity numeric(12,3) not null check (ordered_quantity >= 0),
  picked_quantity numeric(12,3),
  packed_quantity numeric(12,3),
  sort_order integer not null default 0
);

create table if not exists public.discrepancies (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete cascade,
  type public.discrepancy_type not null,
  expected_quantity numeric(12,3),
  actual_quantity numeric(12,3),
  scanned_barcode text,
  note text,
  resolved boolean not null default false,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  order_id uuid references public.orders(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists orders_status_idx on public.orders(status);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists discrepancies_order_id_idx on public.discrepancies(order_id);
create index if not exists audit_logs_order_id_created_at_idx on public.audit_logs(order_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.discrepancies enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.current_user_role() returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

drop policy if exists "Authenticated users read profiles" on public.profiles;
drop policy if exists "Admins manage profiles" on public.profiles;
drop policy if exists "Warehouse team reads products" on public.products;
drop policy if exists "Admins manage products" on public.products;
drop policy if exists "Warehouse team reads orders" on public.orders;
drop policy if exists "Admins create orders" on public.orders;
drop policy if exists "Assigned staff update orders" on public.orders;
drop policy if exists "Warehouse team reads items" on public.order_items;
drop policy if exists "Warehouse team updates items" on public.order_items;
drop policy if exists "Admins create items" on public.order_items;
drop policy if exists "Warehouse team reads discrepancies" on public.discrepancies;
drop policy if exists "Warehouse team creates discrepancies" on public.discrepancies;
drop policy if exists "Admins resolve discrepancies" on public.discrepancies;
drop policy if exists "Warehouse team reads audit logs" on public.audit_logs;
drop policy if exists "Warehouse team creates audit logs" on public.audit_logs;

create policy "Authenticated users read profiles" on public.profiles for select to authenticated using (true);
create policy "Admins manage profiles" on public.profiles for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "Warehouse team reads products" on public.products for select to authenticated using (true);
create policy "Admins manage products" on public.products for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "Warehouse team reads orders" on public.orders for select to authenticated using (true);
create policy "Admins create orders" on public.orders for insert to authenticated with check (public.current_user_role() = 'admin');
create policy "Assigned staff update orders" on public.orders for update to authenticated using (public.current_user_role() = 'admin' or assigned_picker = auth.uid() or assigned_packer = auth.uid());
create policy "Warehouse team reads items" on public.order_items for select to authenticated using (true);
create policy "Warehouse team updates items" on public.order_items for update to authenticated using (exists (select 1 from public.orders o where o.id = order_id and (public.current_user_role() = 'admin' or o.assigned_picker = auth.uid() or o.assigned_packer = auth.uid())));
create policy "Admins create items" on public.order_items for insert to authenticated with check (public.current_user_role() = 'admin');
create policy "Warehouse team reads discrepancies" on public.discrepancies for select to authenticated using (true);
create policy "Warehouse team creates discrepancies" on public.discrepancies for insert to authenticated with check (created_by = auth.uid());
create policy "Admins resolve discrepancies" on public.discrepancies for update to authenticated using (public.current_user_role() = 'admin');
create policy "Warehouse team reads audit logs" on public.audit_logs for select to authenticated using (true);
create policy "Warehouse team creates audit logs" on public.audit_logs for insert to authenticated with check (actor_id = auth.uid());

insert into storage.buckets (id, name, public) values ('sales-orders', 'sales-orders', false) on conflict (id) do nothing;
drop policy if exists "Admins upload sales order PDFs" on storage.objects;
drop policy if exists "Warehouse team reads sales order PDFs" on storage.objects;
create policy "Admins upload sales order PDFs" on storage.objects for insert to authenticated with check (bucket_id = 'sales-orders' and public.current_user_role() = 'admin');
create policy "Warehouse team reads sales order PDFs" on storage.objects for select to authenticated using (bucket_id = 'sales-orders');

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_items') then
    alter publication supabase_realtime add table public.order_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'discrepancies') then
    alter publication supabase_realtime add table public.discrepancies;
  end if;
end $$;
