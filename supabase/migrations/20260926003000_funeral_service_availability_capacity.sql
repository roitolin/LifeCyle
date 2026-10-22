alter table public.funeral_shops
  add column if not exists "serviceCapacity" integer not null default 1;

alter table public.funeral_shops
  drop constraint if exists funeral_shops_service_capacity_check;

alter table public.funeral_shops
  add constraint funeral_shops_service_capacity_check
  check ("serviceCapacity" between 1 and 20);

comment on column public.funeral_shops."serviceCapacity" is
  'Maximum number of overlapping active wake services the shop can handle.';

create index if not exists funeral_service_requests_shop_schedule_capacity_idx
  on public.funeral_service_requests ("shopId", "wakeStartDate", "wakeEndDate", status);

create index if not exists shop_schedule_events_blocked_date_idx
  on public.shop_schedule_events (shop_id, event_date)
  where event_type = 'blocked';

-- Correctly compare the request product text identifier with UUID catalog IDs
-- while retaining authoritative variation pricing.
create or replace function public.set_funeral_catalog_request_price()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  base_price numeric;
  variation_price numeric;
  product_shop_id uuid;
begin
  if new."requestType" is distinct from 'catalog_product' or new."productId" is null then
    return new;
  end if;

  select product.price, product."shopId"
    into base_price, product_shop_id
  from public.funeral_products as product
  where product.id::text = new."productId";

  if not found then
    raise exception 'Selected funeral product does not exist.';
  end if;

  new."shopId" := product_shop_id;

  if new."variationId" is not null then
    select variation.price, variation.name
      into variation_price, new."variationName"
    from public.funeral_product_variations as variation
    where variation.id = new."variationId"
      and variation."productId"::text = new."productId";

    if not found then
      raise exception 'Selected product variation is invalid.';
    end if;
  elsif nullif(btrim(coalesce(new."variationName", '')), '') is not null then
    select variation.price, variation.id
      into variation_price, new."variationId"
    from public.funeral_product_variations as variation
    where variation."productId"::text = new."productId"
      and variation.name = new."variationName"
    order by variation.id
    limit 1;

    if not found then
      raise exception 'Selected product variation is invalid.';
    end if;
  elsif exists (
    select 1
    from public.funeral_product_variations as variation
    where variation."productId"::text = new."productId"
  ) then
    raise exception 'A product variation must be selected.';
  end if;

  new."productPrice" := round(coalesce(variation_price, base_price, 0), 2);
  return new;
end;
$$;

create or replace function public.get_funeral_service_availability(
  p_shop_id uuid,
  p_wake_start_date date,
  p_wake_end_date date,
  p_product_id text default null,
  p_exclude_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  shop_capacity integer;
  active_bookings integer := 0;
  remaining_capacity integer := 0;
  blocked_date date;
  product_stock integer;
  product_active boolean;
  product_shop_id uuid;
  availability_reason text := null;
begin
  if p_shop_id is null then
    return jsonb_build_object(
      'available', false,
      'reason', 'shop_not_found',
      'message', 'The selected funeral shop is unavailable.'
    );
  end if;

  if p_wake_start_date is null or p_wake_end_date is null or p_wake_end_date < p_wake_start_date then
    return jsonb_build_object(
      'available', false,
      'reason', 'invalid_schedule',
      'message', 'Choose a valid wake start and end date.'
    );
  end if;

  select shop."serviceCapacity"
    into shop_capacity
  from public.funeral_shops as shop
  where shop.id = p_shop_id;

  if not found then
    return jsonb_build_object(
      'available', false,
      'reason', 'shop_not_found',
      'message', 'The selected funeral shop is unavailable.'
    );
  end if;

  shop_capacity := greatest(coalesce(shop_capacity, 1), 1);

  if nullif(btrim(coalesce(p_product_id, '')), '') is not null
     and p_product_id <> 'custom_casket_design' then
    select product.stock, product.active, product."shopId"
      into product_stock, product_active, product_shop_id
    from public.funeral_products as product
    where product.id::text = p_product_id;

    if not found or product_shop_id is distinct from p_shop_id then
      availability_reason := 'product_unavailable';
    elsif not coalesce(product_active, false) or coalesce(product_stock, 0) <= 0 then
      availability_reason := 'out_of_stock';
    end if;
  end if;

  select event.event_date
    into blocked_date
  from public.shop_schedule_events as event
  where event.shop_id = p_shop_id
    and event.event_type = 'blocked'
    and event.event_date between p_wake_start_date and p_wake_end_date
  order by event.event_date
  limit 1;

  select count(*)::integer
    into active_bookings
  from public.funeral_service_requests as request
  where request."shopId" = p_shop_id
    and (p_exclude_request_id is null or request.id <> p_exclude_request_id)
    and request.status in (
      'accepted_by_shop',
      'awaiting_payment',
      'payment_submitted',
      'payment_verified',
      'awaiting_customer_confirmation'
    )
    and request."wakeStartDate" is not null
    and request."wakeEndDate" is not null
    and request."wakeStartDate" <= p_wake_end_date
    and request."wakeEndDate" >= p_wake_start_date;

  remaining_capacity := greatest(shop_capacity - active_bookings, 0);

  if availability_reason is null and blocked_date is not null then
    availability_reason := 'blocked_date';
  end if;
  if availability_reason is null and active_bookings >= shop_capacity then
    availability_reason := 'capacity_reached';
  end if;

  return jsonb_build_object(
    'available', availability_reason is null,
    'reason', availability_reason,
    'message', case availability_reason
      when 'product_unavailable' then 'This casket is not available from the selected shop.'
      when 'out_of_stock' then 'This casket is currently out of stock.'
      when 'blocked_date' then 'The shop marked part of this wake schedule as unavailable.'
      when 'capacity_reached' then 'The shop is already at full service capacity for these dates.'
      else 'The shop is available for these dates.'
    end,
    'capacity', shop_capacity,
    'activeBookings', active_bookings,
    'remainingCapacity', remaining_capacity,
    'blockedDate', blocked_date,
    'stock', product_stock
  );
end;
$$;

revoke all on function public.get_funeral_service_availability(uuid, date, date, text, uuid)
  from public, anon;
grant execute on function public.get_funeral_service_availability(uuid, date, date, text, uuid)
  to authenticated;

create or replace function public.guard_funeral_service_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  availability jsonb;
  active_statuses constant text[] := array[
    'accepted_by_shop',
    'awaiting_payment',
    'payment_submitted',
    'payment_verified',
    'awaiting_customer_confirmation'
  ];
begin
  if new."requestType" not in ('catalog_product', 'custom_casket') then
    return new;
  end if;

  if new.status <> 'pending_shop_acceptance' and not (new.status = any(active_statuses)) then
    return new;
  end if;

  if new."wakeStartDate" is null or new."wakeEndDate" is null then
    raise exception 'Wake start and end dates are required for availability checking.';
  end if;

  if new.status = any(active_statuses) then
    perform 1
    from public.funeral_shops
    where id = new."shopId"
    for update;
  end if;

  availability := public.get_funeral_service_availability(
    new."shopId",
    new."wakeStartDate",
    new."wakeEndDate",
    new."productId",
    case when tg_op = 'UPDATE' then new.id else null end
  );

  if not coalesce((availability ->> 'available')::boolean, false) then
    raise exception '%', coalesce(availability ->> 'message', 'The shop is unavailable for the selected dates.');
  end if;

  return new;
end;
$$;

drop trigger if exists check_funeral_service_availability
  on public.funeral_service_requests;

create trigger check_funeral_service_availability
before insert or update of status, "shopId", "productId", "wakeStartDate", "wakeEndDate"
on public.funeral_service_requests
for each row
execute function public.guard_funeral_service_availability();

comment on function public.get_funeral_service_availability(uuid, date, date, text, uuid) is
  'Checks casket stock, blocked shop dates, and overlapping active services against shop capacity.';

notify pgrst, 'reload schema';
