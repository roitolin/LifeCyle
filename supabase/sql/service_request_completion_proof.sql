-- LifeCycle - COMPLETION PROOF & CUSTOMER CONFIRMATION FOR SERVICE REQUESTS
-- Run this once in the Supabase SQL editor before releasing the updated app.
--
-- New flow after payment is verified:
--   payment_verified
--     -> (shop attaches completion proof + marks as completed)
--     -> awaiting_customer_confirmation
--     -> (customer reviews the proof and confirms done)
--     -> completed
--
-- Shops must attach a completion proof photo before moving the request to
-- awaiting_customer_confirmation. Only the requester can then mark it done.

alter table public.funeral_service_requests
  add column if not exists "completionProofImageUrl" text,
  add column if not exists "shopMarkedCompletedAt" timestamptz,
  add column if not exists "completionProofSeenAt" timestamptz;

comment on column public.funeral_service_requests."completionProofImageUrl" is
  'Photo proof attached by the shop when marking the service request as delivered.';
comment on column public.funeral_service_requests."shopMarkedCompletedAt" is
  'Time the shop marked the request as delivered and attached its completion proof.';
comment on column public.funeral_service_requests."completionProofSeenAt" is
  'When the requester first viewed the shop''s completion proof (status = awaiting_customer_confirmation). Null until the family has seen it.';

-- Refresh the status check constraint to include the new state.
alter table public.funeral_service_requests
  drop constraint if exists funeral_service_requests_status_check;

alter table public.funeral_service_requests
  add constraint funeral_service_requests_status_check
  check (status in (
    'pending_shop_acceptance',
    'accepted_by_shop',
    'awaiting_payment',
    'payment_submitted',
    'payment_verified',
    'awaiting_customer_confirmation',
    'completed',
    'declined_by_shop',
    'cancelled_by_requester'
  )) not valid;

-- Require the proof on the payment_verified -> awaiting_customer_confirmation
-- transition and allow only the requester to advance to completed.
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
        raise exception 'Attach a completion proof photo before marking the request as delivered.';
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

-- Keep the flow trigger attached (idempotent; run after
-- service_request_automatic_payment_flow.sql).
drop trigger if exists enforce_funeral_service_request_flow
  on public.funeral_service_requests;
create trigger enforce_funeral_service_request_flow
before update on public.funeral_service_requests
for each row execute function public.enforce_funeral_service_request_flow();

comment on column public.funeral_service_requests.status is
  'pending_shop_acceptance | accepted_by_shop (legacy transitional) | awaiting_payment | payment_submitted | payment_verified | awaiting_customer_confirmation | completed | declined_by_shop | cancelled_by_requester';
comment on column public.funeral_service_requests."paymentRejectionReason" is
  'Required reason shown to the requester when a submitted payment is rejected.';

notify pgrst, 'reload schema';
