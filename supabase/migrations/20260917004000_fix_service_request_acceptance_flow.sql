-- =============================================================================
-- Migration: 20260917004000_fix_service_request_acceptance_flow.sql
-- Fix: Remove legacy manual QR requirement when accepting service requests
-- under the Xendit Direct Payout model. Allow catalog casket productPrice to
-- satisfy the payment amount, default paymentQrUrl to 'xendit://hosted', and
-- align triggers (enforce_funeral_service_request_flow & protect_xendit_service_payment_fields).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Update enforce_funeral_service_request_flow
-- ─────────────────────────────────────────────────────────────────────────────
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
  final_amount numeric;
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

    -- Resolve payment amount: explicit new amount -> casket product price -> shop default fee
    final_amount := coalesce(
      nullif(new."paymentAmount", 0),
      nullif(old."productPrice", 0),
      shop_amount,
      0
    );

    if final_amount <= 0 then
      raise exception 'Configure the casket product price or shop default amount before accepting requests.';
    end if;

    -- Stock handling for catalog products
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
      if coalesce(old."paymentAmount", 0) <= 0 then
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

drop trigger if exists enforce_funeral_service_request_flow
  on public.funeral_service_requests;
create trigger enforce_funeral_service_request_flow
before update on public.funeral_service_requests
for each row execute function public.enforce_funeral_service_request_flow();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Update protect_xendit_service_payment_fields
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.protect_xendit_service_payment_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_is_service_role boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if actor_is_service_role then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new."paymentProvider" = 'xendit'
       or new."providerIdempotencyKey" is not null
       or new."providerReferenceId" is not null
       or new."providerShopAccountId" is not null
       or new."providerSplitRuleId" is not null
       or new."providerSplitDestinationAccountId" is not null
       or new."providerCheckoutClaimId" is not null
       or new."providerCheckoutClaimedAt" is not null
       or new."providerPaymentCompletedAt" is not null
       or new."providerSplitCompletedAt" is not null
       or new."commissionRate" is not null
       or new."commissionAmount" is not null
       or new."shopNetAmount" is not null
       or new."commissionStatus" is not null
       or new."providerSplitPaymentId" is not null
       or new."providerCurrency" is not null
       or new."payoutId" is not null
       or new."payoutStatus" is not null
       or new."payoutAmount" is not null
       or new."payoutCompletedAt" is not null
       or new."payoutFailureCode" is not null
       or new."payoutChannelCode" is not null
       or new."payoutReferenceId" is not null then
      raise exception 'Xendit payment fields can be set only by the payment service.';
    end if;
    return new;
  end if;

  if old."providerIdempotencyKey" is distinct from new."providerIdempotencyKey"
     or old."providerReferenceId" is distinct from new."providerReferenceId"
     or old."providerShopAccountId" is distinct from new."providerShopAccountId"
     or old."providerSplitRuleId" is distinct from new."providerSplitRuleId"
     or old."providerSplitDestinationAccountId" is distinct from new."providerSplitDestinationAccountId"
     or old."providerCheckoutClaimId" is distinct from new."providerCheckoutClaimId"
     or old."providerCheckoutClaimedAt" is distinct from new."providerCheckoutClaimedAt"
     or old."providerPaymentCompletedAt" is distinct from new."providerPaymentCompletedAt"
     or old."providerSplitCompletedAt" is distinct from new."providerSplitCompletedAt"
     or old."commissionRate" is distinct from new."commissionRate"
     or old."commissionAmount" is distinct from new."commissionAmount"
     or old."shopNetAmount" is distinct from new."shopNetAmount"
     or old."commissionStatus" is distinct from new."commissionStatus"
     or old."providerSplitPaymentId" is distinct from new."providerSplitPaymentId"
     or old."providerCurrency" is distinct from new."providerCurrency"
     or old."payoutId" is distinct from new."payoutId"
     or old."payoutStatus" is distinct from new."payoutStatus"
     or old."payoutAmount" is distinct from new."payoutAmount"
     or old."payoutCompletedAt" is distinct from new."payoutCompletedAt"
     or old."payoutFailureCode" is distinct from new."payoutFailureCode"
     or old."payoutChannelCode" is distinct from new."payoutChannelCode"
     or old."payoutReferenceId" is distinct from new."payoutReferenceId" then
    raise exception 'Xendit payment fields can be changed only by the payment service.';
  end if;

  -- Allow the initial shop acceptance or response transition from pending_shop_acceptance
  if old.status = 'pending_shop_acceptance'
     and new.status in ('awaiting_payment', 'declined_by_shop', 'cancelled_by_requester') then
    if old."providerCheckoutId" is distinct from new."providerCheckoutId"
       or old."providerCheckoutUrl" is distinct from new."providerCheckoutUrl"
       or old."providerPaymentId" is distinct from new."providerPaymentId"
       or old."providerPaymentMethod" is distinct from new."providerPaymentMethod"
       or old."providerStatus" is distinct from new."providerStatus"
       or old."providerLivemode" is distinct from new."providerLivemode"
       or old."providerEventId" is distinct from new."providerEventId"
       or old."providerCheckoutCreatedAt" is distinct from new."providerCheckoutCreatedAt"
       or old."paymentSubmittedAt" is distinct from new."paymentSubmittedAt"
       or old."paymentVerifiedAt" is distinct from new."paymentVerifiedAt" then
      raise exception 'Xendit checkout fields can be changed only by the payment service.';
    end if;
    return new;
  end if;

  if old."paymentProvider" = 'xendit' or new."paymentProvider" = 'xendit' then
    if old."paymentProvider" is distinct from new."paymentProvider"
       or old."paymentAmount" is distinct from new."paymentAmount"
       or old."providerCheckoutId" is distinct from new."providerCheckoutId"
       or old."providerCheckoutUrl" is distinct from new."providerCheckoutUrl"
       or old."providerPaymentId" is distinct from new."providerPaymentId"
       or old."providerPaymentMethod" is distinct from new."providerPaymentMethod"
       or old."providerStatus" is distinct from new."providerStatus"
       or old."providerLivemode" is distinct from new."providerLivemode"
       or old."providerEventId" is distinct from new."providerEventId"
       or old."providerCheckoutCreatedAt" is distinct from new."providerCheckoutCreatedAt"
       or old."paymentSubmittedAt" is distinct from new."paymentSubmittedAt"
       or old."paymentVerifiedAt" is distinct from new."paymentVerifiedAt" then
      raise exception 'Xendit payment state can be changed only by the payment service.';
    end if;

    if old.status is distinct from new.status
       and not (
         (old.status = 'awaiting_payment' and new.status = 'cancelled_by_requester')
         or (old.status = 'payment_verified' and new.status = 'awaiting_customer_confirmation')
         or (old.status = 'awaiting_customer_confirmation' and new.status in ('completed', 'payment_verified'))
       ) then
      raise exception 'Only a verified Xendit webhook can change the payment state.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_xendit_service_payment_fields
  on public.funeral_service_requests;
create trigger protect_xendit_service_payment_fields
before insert or update on public.funeral_service_requests
for each row execute function public.protect_xendit_service_payment_fields();

revoke all on function public.protect_xendit_service_payment_fields() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Update accept_funeral_service_request RPC
-- ─────────────────────────────────────────────────────────────────────────────
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

notify pgrst, 'reload schema';
