alter table public.order_items
add column if not exists bin_location text;

create table if not exists public.order_item_batches (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  batch_number text not null,
  expiry_date date,
  quantity numeric(12,3) not null check (quantity >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists order_item_batches_item_id_idx
on public.order_item_batches(order_item_id, sort_order);

alter table public.order_item_batches enable row level security;

drop policy if exists "Warehouse team reads item batches" on public.order_item_batches;
drop policy if exists "Admins manage item batches" on public.order_item_batches;
drop policy if exists "Admins delete items" on public.order_items;

create policy "Warehouse team reads item batches"
on public.order_item_batches for select to authenticated
using (true);

create policy "Admins manage item batches"
on public.order_item_batches for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy "Admins delete items"
on public.order_items for delete to authenticated
using (public.current_user_role() = 'admin');
