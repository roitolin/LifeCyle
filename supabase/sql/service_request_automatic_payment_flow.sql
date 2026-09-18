-- LifeCycle - AUTOMATIC SERVICE REQUEST PAYMENT FLOW
-- Run this once in the Supabase SQL editor.
--
-- New requests use one authoritative status field:
-- pending_shop_acceptance -> awaiting_payment -> payment_submitted
-- -> payment_verified -> completed.
--
-- The shop configures paymentQrUrl + serviceFeeAmount once on
-- funeral_shops. Accepting a request atomically copies those values
-- onto the request, reduces product stock, and moves directly to
-- awaiting_payment. No per-customer payment setup is required.

begin;

alter table public.funeral_shops
  add column if not exists "paymentQrUrl" text,
  add column if not exists "serviceFeeAmount" numeric;

alter table public.funeral_service_requests
  add column if not exists "paymentQrUrl" text,
  add column if not exists "paymentAmount" numeric,
  add column if not exists "paymentPayerName" text,
  add column if not exists "paymentGcashName" text,
  add column if not exists "paymentGcashNumber" text,
  add column if not exists "paymentReferenceNumber" text,
  add column if not exists "paymentProofImageUrl" text,
  add column if not exists "paymentSubmittedAt" timestamptz,
  add column if not exists "paymentVerifiedAt" timestamptz,
  add column if not exists "paymentRejectionReason" text,
  add column if not exists "completionProofImageUrl" text,
  add column if not exists "shopMarkedCompletedAt" timestamptz,
  add column if not exists "completionProofSeenAt" timestamptz,
  add column if not exists "completedAt" timestamptz;

update public.funeral_service_requests
set status = case status
  when 'confirmed' then 'payment_verified'
  when 'cancelled' then 'cancelled_by_requester'
  else status
end
where status in ('confirmed', 'cancelled');

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'funeral_service_requests'
      and column_name = 'paymentStatus'
  ) then
    update public.funeral_service_requests
    set status = case
      when "paymentStatus" = 'verified' then 'payment_verified'
      when "paymentStatus" = 'submitted' then 'payment_submitted'
      when "paymentStatus" in ('pending', 'rejected') then 'awaiting_payment'
      else status
    end
    where "paymentStatus" in ('pending', 'submitted', 'verified', 'rejected');
  end if;
end $$;

alter table public.funeral_service_requests
  drop column if exists "paymentStatus";

-- Backfill already-accepted requests when the shop has complete settings.
update public.funeral_service_requests request
set
  status = 'awaiting_payment',
  "paymentQrUrl" = shop."paymentQrUrl",
  "paymentAmount" = shop."serviceFeeAmount",
  "paymentRejectionReason" = null,
  "paymentVerifiedAt" = null,
  "updatedAt" = now()
from public.funeral_shops shop
where request."shopId" = shop.id
  and request.status = 'accepted_by_shop'
  and nullif(trim(shop."paymentQrUrl"), '') is not null
  and coalesce(shop."serviceFeeAmount", 0) > 0;

create or replace function public.enforce_funeral_service_request_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_admin boolean := false;
  actor_is_shop boolean := false;
  actor_is_requester boolean := false;
  shop_qr text;
  shop_amount numeric;
begin
  if actor_id is not null then
    select exists (
      select 1
      from public.users
      where id = actor_id
        and role in ('admin', 'super_admin', 'funeral_admin')
    ) into actor_is_admin;

    actor_is_shop := actor_id = old."shopId";
    actor_is_requester := actor_id = old."requesterId";
  end if;

  -- Acceptance transition: pending_shop_acceptance -> awaiting_payment
  -- (or legacy transitional accepted_by_shop)
  if old.status = 'pending_shop_acceptance'
     and new.status in ('accepted_by_shop', 'awaiting_payment') then
    if actor_id is not null and not actor_is_shop and not actor_is_admin then
      raise exception 'Only the assigned shop can accept this request.';
    end if;

    select
      nullif(trim("paymentQrUrl"), ''),
      "serviceFeeAmount"
    into shop_qr, shop_amount
    from public.funeral_shops
    where id = old."shopId";

    declare
      final_amount numeric := coalesce(
        nullif(new."paymentAmount", 0),
        nullif(old."productPrice", 0),
        shop_amount,
        0
      );
    begin
      if final_amount <= 0 then
        raise exception 'Configure the casket product price or shop default amount before accepting requests.';
      end if;

      -- Keep stock handling inside the transition trigger so current,
      -- legacy, and direct API clients all follow the same atomic rule.
      if old."productId" is not null
         and old."productId" <> 'custom_casket_design' then
        update public.funeral_products
        set
          stock = greatest(coalesce(stock, 0) - 1, 0),
          "updatedAt" = now()
        where id::text = old."productId"
          and "shopId" = old."shopId"
          and coalesce(stock, 0) > 0;

        if not found then
          raise exception 'This product is out of stock.';
        end if;
      end if;

      new.status := 'awaiting_payment';
      new."paymentProvider" := coalesce(new."paymentProvider", 'xendit');
      new."paymentQrUrl" := coalesce(nullif(trim(new."paymentQrUrl"), ''), shop_qr, 'xendit://hosted');
      new."paymentAmount" := final_amount;
      new."paymentPayerName" := null;
      new."paymentGcashName" := null;
      new."paymentGcashNumber" := null;
      new."paymentReferenceNumber" := null;
      new."paymentProofImageUrl" := null;
      new."paymentSubmittedAt" := null;
      new."paymentVerifiedAt" := null;
      new."paymentRejectionReason" := null;
      new."acceptedAt" := coalesce(new."acceptedAt", now());
      new."shopRespondedAt" := coalesce(new."shopRespondedAt", now());
      new."handledByShopId" := coalesce(new."handledByShopId", actor_id);
    end;
  end if;

  if old.status is distinct from new.status and actor_id is not null and not actor_is_admin then
    if old.status = 'pending_shop_acceptance' and new.status = 'cancelled_by_requester' then
      if not actor_is_requester then
        raise exception 'Only the requester can cancel this request.';
      end if;
    elsif old.status = 'pending_shop_acceptance' and new.status in ('awaiting_payment', 'declined_by_shop') then
      if not actor_is_shop then
        raise exception 'Only the assigned shop can respond to this request.';
      end if;
    elsif old.status = 'accepted_by_shop' and new.status = 'awaiting_payment' then
      if not actor_is_shop then
        raise exception 'Only the assigned shop can prepare payment.';
      end if;
    elsif old.status = 'accepted_by_shop' and new.status = 'cancelled_by_requester' then
      if not actor_is_requester then
        raise exception 'Only the requester can cancel this request.';
      end if;
    elsif old.status = 'awaiting_payment' and new.status = 'payment_submitted' then
      if not actor_is_requester then
        raise exception 'Only the requester can submit payment.';
      end if;
      if nullif(trim(old."paymentQrUrl"), '') is null or coalesce(old."paymentAmount", 0) <= 0 then
        raise exception 'The shop payment details are incomplete.';
      end if;
      if nullif(trim(new."paymentPayerName"), '') is null
         or nullif(trim(new."paymentGcashName"), '') is null
         or nullif(trim(new."paymentGcashNumber"), '') is null
         or nullif(trim(new."paymentProofImageUrl"), '') is null then
        raise exception 'Sender name, GCash name, GCash number, and payment proof are required.';
      end if;
      new."paymentSubmittedAt" := coalesce(new."paymentSubmittedAt", now());
      new."paymentRejectionReason" := null;
    elsif old.status = 'awaiting_payment' and new.status = 'cancelled_by_requester' then
      if not actor_is_requester then
        raise exception 'Only the requester can cancel this request.';
      end if;
    elsif old.status = 'payment_submitted' and new.status = 'payment_verified' then
      if not actor_is_shop then
        raise exception 'Only the assigned shop can verify payment.';
      end if;
      new."paymentVerifiedAt" := coalesce(new."paymentVerifiedAt", now());
      new."paymentRejectionReason" := null;
    elsif old.status = 'payment_submitted' and new.status = 'awaiting_payment' then
      if not actor_is_shop then
        raise exception 'Only the assigned shop can reject payment.';
      end if;
      if nullif(trim(new."paymentRejectionReason"), '') is null then
        raise exception 'A payment rejection reason is required.';
      end if;
      new."paymentPayerName" := null;
      new."paymentGcashName" := null;
      new."paymentGcashNumber" := null;
      new."paymentReferenceNumber" := null;
      new."paymentProofImageUrl" := null;
      new."paymentSubmittedAt" := null;
      new."paymentVerifiedAt" := null;
    elsif old.status = 'payment_verified' and new.status = 'awaiting_customer_confirmation' then
      if not actor_is_shop then
        raise exception 'Only the assigned shop can mark this request as delivered.';
      end if;
      if nullif(trim(new."completionProofImageUrl"), '') is null then
        raise exception 'A completion proof photo is required before marking the request as delivered.';
      end if;
      new."shopMarkedCompletedAt" := coalesce(new."shopMarkedCompletedAt", now());
      new."completedAt" := null;
    elsif old.status = 'awaiting_customer_confirmation' and new.status = 'completed' then
      if not actor_is_requester then
        raise exception 'Only the requester can confirm this request as done.';
      end if;
      new."completedAt" := coalesce(new."completedAt", now());
    elsif old.status = 'awaiting_customer_confirmation' and new.status = 'payment_verified' then
      if not actor_is_shop then
        raise exception 'Only the assigned shop can reopen this request for correction.';
      end if;
      new."shopMarkedCompletedAt" := null;
      new."completionProofImageUrl" := null;
      new."completedAt" := null;
    else
      raise exception 'Invalid service request transition: % -> %', old.status, new.status;
    end if;
  end if;

  new."updatedAt" := now();
  return new;
end;
$$;

drop trigger if exists enforce_funeral_service_request_flow
  on public.funeral_service_requests;
create trigger enforce_funeral_service_request_flow
before update on public.funeral_service_requests
for each row execute function public.enforce_funeral_service_request_flow();

create or replace function public.accept_funeral_service_request(p_request_id uuid)
returns setof public.funeral_service_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.funeral_service_requests%rowtype;
  shop_qr text;
  shop_amount numeric;
  actor_is_admin boolean;
  computed_amount numeric;
begin
  select *
  into request_row
  from public.funeral_service_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Service request not found.';
  end if;

  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('admin', 'super_admin', 'funeral_admin')
  ) into actor_is_admin;

  if auth.uid() is distinct from request_row."shopId" and not actor_is_admin then
    raise exception 'Only the assigned shop can accept this request.';
  end if;

  if request_row.status <> 'pending_shop_acceptance' then
    raise exception 'This request has already been processed.';
  end if;

  select nullif(trim("paymentQrUrl"), ''), "serviceFeeAmount"
  into shop_qr, shop_amount
  from public.funeral_shops
  where id = request_row."shopId";

  computed_amount := coalesce(nullif(request_row."productPrice", 0), shop_amount, 0);

  if computed_amount <= 0 then
    raise exception 'Configure the casket product price or shop default amount before accepting requests.';
  end if;

  return query
  update public.funeral_service_requests
  set
    status = 'awaiting_payment',
    "paymentProvider" = 'xendit',
    "paymentQrUrl" = coalesce(shop_qr, 'xendit://hosted'),
    "paymentAmount" = computed_amount,
    "paymentPayerName" = null,
    "paymentGcashName" = null,
    "paymentGcashNumber" = null,
    "paymentReferenceNumber" = null,
    "paymentProofImageUrl" = null,
    "paymentSubmittedAt" = null,
    "paymentVerifiedAt" = null,
    "paymentRejectionReason" = null,
    "acceptedAt" = now(),
    "shopRespondedAt" = now(),
    "handledByShopId" = auth.uid(),
    "updatedAt" = now()
  where id = p_request_id
  returning *;
end;
$$;

revoke all on function public.accept_funeral_service_request(uuid) from public;
grant execute on function public.accept_funeral_service_request(uuid) to authenticated;

-- If a shop had legacy accepted requests without payment details,
-- saving its one-time payment settings advances them automatically.
create or replace function public.apply_shop_payment_settings_to_accepted_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(new."paymentQrUrl"), '') is not null
     and coalesce(new."serviceFeeAmount", 0) > 0 then
    update public.funeral_service_requests
    set
      status = 'awaiting_payment',
      "paymentQrUrl" = new."paymentQrUrl",
      "paymentAmount" = new."serviceFeeAmount",
      "paymentRejectionReason" = null,
      "paymentVerifiedAt" = null,
      "updatedAt" = now()
    where "shopId" = new.id
      and status = 'accepted_by_shop';
  end if;
  return new;
end;
$$;

drop trigger if exists apply_shop_payment_settings_to_accepted_requests
  on public.funeral_shops;
create trigger apply_shop_payment_settings_to_accepted_requests
after update of "paymentQrUrl", "serviceFeeAmount"
on public.funeral_shops
for each row execute function public.apply_shop_payment_settings_to_accepted_requests();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'funeral_service_requests_status_check'
      and conrelid = 'public.funeral_service_requests'::regclass
  ) then
    alter table public.funeral_service_requests
      add constraint funeral_service_requests_status_check
      check (status in (
        'pending_shop_acceptance',
        'accepted_by_shop',
        'awaiting_payment',
        'payment_submitted',
        'payment_verified',
        'completed',
        'declined_by_shop',
        'cancelled_by_requester'
      )) not valid;
  end if;
end $$;

comment on column public.funeral_service_requests.status is
  'pending_shop_acceptance | accepted_by_shop (legacy transitional) | awaiting_payment | payment_submitted | payment_verified | completed | declined_by_shop | cancelled_by_requester';
comment on column public.funeral_service_requests."paymentRejectionReason" is
  'Required reason shown to the requester when a submitted payment is rejected.';

notify pgrst, 'reload schema';

commit;
