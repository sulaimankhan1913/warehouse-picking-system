create or replace function public.start_picking(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_status public.order_status;
  v_assigned_picker uuid;
  v_order_number text;
begin
  if v_user_id is null then
    raise exception 'Please sign in again.';
  end if;

  select role into v_role from public.profiles where id = v_user_id and active = true;
  if v_role is null or v_role not in ('admin', 'picker') then
    raise exception 'Only an administrator or picker can start picking.';
  end if;

  select status, assigned_picker, order_number
  into v_status, v_assigned_picker, v_order_number
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;
  if v_status not in ('uploaded', 'ready_to_pick', 'picking') then
    raise exception 'This order is not available for picking.';
  end if;
  if v_assigned_picker is not null and v_assigned_picker <> v_user_id and v_role <> 'admin' then
    raise exception 'This order is assigned to another picker.';
  end if;

  update public.orders
  set status = 'picking',
      assigned_picker = case when v_role = 'admin' or assigned_picker is null then v_user_id else assigned_picker end,
      picking_started_at = coalesce(picking_started_at, now()),
      updated_at = now()
  where id = p_order_id;

  insert into public.audit_logs (order_id, actor_id, action, entity_type, entity_id, details)
  values (p_order_id, v_user_id, 'picking_started', 'order', p_order_id::text, jsonb_build_object('order_number', v_order_number));
end;
$$;

create or replace function public.record_pick(
  p_order_id uuid,
  p_item_id uuid,
  p_quantity numeric,
  p_scanned_barcode text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_status public.order_status;
  v_assigned_picker uuid;
  v_expected numeric;
  v_sku text;
  v_discrepancy public.discrepancy_type;
begin
  if v_user_id is null then
    raise exception 'Please sign in again.';
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'Actual quantity must be zero or greater.';
  end if;

  select role into v_role from public.profiles where id = v_user_id and active = true;
  select status, assigned_picker into v_status, v_assigned_picker
  from public.orders where id = p_order_id;

  if v_role is null or v_role not in ('admin', 'picker') or v_status <> 'picking' then
    raise exception 'This order is not currently being picked.';
  end if;
  if v_role <> 'admin' and v_assigned_picker <> v_user_id then
    raise exception 'This order is assigned to another picker.';
  end if;

  select ordered_quantity, sku into v_expected, v_sku
  from public.order_items
  where id = p_item_id and order_id = p_order_id;

  if not found then
    raise exception 'Order line not found.';
  end if;

  update public.order_items
  set picked_quantity = p_quantity
  where id = p_item_id and order_id = p_order_id;

  delete from public.discrepancies
  where order_item_id = p_item_id
    and resolved = false
    and type in ('short_quantity', 'over_quantity');

  if p_quantity <> v_expected then
    v_discrepancy := case when p_quantity < v_expected then 'short_quantity' else 'over_quantity' end;
    insert into public.discrepancies (
      order_id, order_item_id, type, expected_quantity, actual_quantity,
      scanned_barcode, created_by
    ) values (
      p_order_id, p_item_id, v_discrepancy, v_expected, p_quantity,
      nullif(trim(p_scanned_barcode), ''), v_user_id
    );
  end if;

  insert into public.audit_logs (order_id, actor_id, action, entity_type, entity_id, details)
  values (
    p_order_id, v_user_id, 'pick_quantity_recorded', 'order_item', p_item_id::text,
    jsonb_build_object('sku', v_sku, 'expected', v_expected, 'actual', p_quantity, 'scanned_barcode', p_scanned_barcode)
  );
end;
$$;

create or replace function public.record_wrong_barcode(p_order_id uuid, p_barcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_status public.order_status;
  v_assigned_picker uuid;
begin
  if v_user_id is null then
    raise exception 'Please sign in again.';
  end if;
  if nullif(trim(p_barcode), '') is null then
    raise exception 'Barcode is required.';
  end if;

  select role into v_role from public.profiles where id = v_user_id and active = true;
  select status, assigned_picker into v_status, v_assigned_picker
  from public.orders where id = p_order_id;

  if v_role is null or v_role not in ('admin', 'picker') or v_status <> 'picking' then
    raise exception 'This order is not currently being picked.';
  end if;
  if v_role <> 'admin' and v_assigned_picker <> v_user_id then
    raise exception 'This order is assigned to another picker.';
  end if;

  insert into public.discrepancies (order_id, type, scanned_barcode, note, created_by)
  values (p_order_id, 'wrong_barcode', trim(p_barcode), 'Barcode was not found on this order.', v_user_id);

  insert into public.audit_logs (order_id, actor_id, action, entity_type, entity_id, details)
  values (p_order_id, v_user_id, 'wrong_barcode_scanned', 'order', p_order_id::text, jsonb_build_object('barcode', trim(p_barcode)));
end;
$$;

create or replace function public.finish_picking(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.user_role;
  v_status public.order_status;
  v_assigned_picker uuid;
  v_order_number text;
begin
  if v_user_id is null then
    raise exception 'Please sign in again.';
  end if;

  select role into v_role from public.profiles where id = v_user_id and active = true;
  select status, assigned_picker, order_number
  into v_status, v_assigned_picker, v_order_number
  from public.orders
  where id = p_order_id
  for update;

  if v_role is null or v_role not in ('admin', 'picker') or v_status <> 'picking' then
    raise exception 'This order is not currently being picked.';
  end if;
  if v_role <> 'admin' and v_assigned_picker <> v_user_id then
    raise exception 'This order is assigned to another picker.';
  end if;
  if exists (
    select 1 from public.order_items
    where order_id = p_order_id and picked_quantity is null
  ) then
    raise exception 'Confirm the actual quantity for every order line first.';
  end if;

  update public.orders
  set status = 'ready_to_pack',
      picking_completed_at = now(),
      updated_at = now()
  where id = p_order_id;

  insert into public.audit_logs (order_id, actor_id, action, entity_type, entity_id, details)
  values (p_order_id, v_user_id, 'picking_completed', 'order', p_order_id::text, jsonb_build_object('order_number', v_order_number));
end;
$$;

revoke all on function public.start_picking(uuid) from public;
revoke all on function public.record_pick(uuid, uuid, numeric, text) from public;
revoke all on function public.record_wrong_barcode(uuid, text) from public;
revoke all on function public.finish_picking(uuid) from public;

grant execute on function public.start_picking(uuid) to authenticated;
grant execute on function public.record_pick(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.record_wrong_barcode(uuid, text) to authenticated;
grant execute on function public.finish_picking(uuid) to authenticated;
