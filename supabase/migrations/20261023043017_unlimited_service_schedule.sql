-- Service schedules are not constrained by a per-shop overlapping-service cap.
-- Keep product stock and explicitly blocked dates as the availability controls.

alter table public.funeral_shops
  drop constraint if exists funeral_shops_service_capacity_check;

alter table public.funeral_shops
  drop column if exists "serviceCapacity";

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
  active_bookings integer := 0;
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

  if not exists (
    select 1
    from public.funeral_shops as shop
    where shop.id = p_shop_id
  ) then
    return jsonb_build_object(
      'available', false,
      'reason', 'shop_not_found',
      'message', 'The selected funeral shop is unavailable.'
    );
  end if;

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

  -- Retain the count for availability diagnostics, but never use it to reject a schedule.
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

  if availability_reason is null and blocked_date is not null then
    availability_reason := 'blocked_date';
  end if;

  return jsonb_build_object(
    'available', availability_reason is null,
    'reason', availability_reason,
    'message', case availability_reason
      when 'product_unavailable' then 'This casket is not available from the selected shop.'
      when 'out_of_stock' then 'This casket is currently out of stock.'
      when 'blocked_date' then 'The shop marked part of this wake schedule as unavailable.'
      else 'The shop is available for these dates.'
    end,
    'capacity', null,
    'activeBookings', active_bookings,
    'remainingCapacity', null,
    'blockedDate', blocked_date,
    'stock', product_stock
  );
end;
$$;

comment on function public.get_funeral_service_availability(uuid, date, date, text, uuid) is
  'Checks casket stock and blocked shop dates. Overlapping service schedules are unlimited.';

notify pgrst, 'reload schema';
