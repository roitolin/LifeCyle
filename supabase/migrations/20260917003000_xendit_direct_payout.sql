begin;

-- ==============================================================================
-- Migration: 20260917003000_xendit_direct_payout.sql
-- Description: Replace XenPlatform split rules with direct Xendit Payouts API.
--   All payments go to admin's account; 70% is paid out to shop via Payouts API.
--   Shops register bank/GCash details instead of getting Xendit sub-accounts.
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add payout account fields to funeral_shops
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.funeral_shops
  add column if not exists "payoutChannelCode" text,
  add column if not exists "payoutAccountName" text,
  add column if not exists "payoutAccountNumber" text,
  add column if not exists "payoutVerifiedByAdmin" boolean not null default false,
  add column if not exists "payoutVerifiedAt" timestamptz;

alter table public.funeral_shops
  drop constraint if exists funeral_shops_payout_channel_check;
alter table public.funeral_shops
  add constraint funeral_shops_payout_channel_check
  check (
    "payoutChannelCode" is null
    or "payoutChannelCode" in (
      'PH_GCASH', 'PH_MAYA',
      'PH_BDO', 'PH_BPI', 'PH_UBP', 'PH_METROBANK',
      'PH_LANDBANK', 'PH_PNB', 'PH_RCBC', 'PH_CHINABANK',
      'PH_SECURITYBANK', 'PH_EASTWESTBANK'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add payout tracking fields to funeral_service_requests
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.funeral_service_requests
  add column if not exists "payoutId" text,
  add column if not exists "payoutStatus" text,
  add column if not exists "payoutAmount" numeric(14,2),
  add column if not exists "payoutCompletedAt" timestamptz,
  add column if not exists "payoutFailureCode" text,
  add column if not exists "payoutChannelCode" text,
  add column if not exists "payoutReferenceId" text;

alter table public.funeral_service_requests
  drop constraint if exists funeral_service_requests_payout_status_check;
alter table public.funeral_service_requests
  add constraint funeral_service_requests_payout_status_check
  check ("payoutStatus" is null or "payoutStatus" in ('pending', 'succeeded', 'failed'));

create unique index if not exists funeral_service_requests_payout_id_unique
  on public.funeral_service_requests ("payoutId")
  where "payoutId" is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Relax the commission constraint: split rule & destination are no longer required
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.funeral_service_requests
  drop constraint if exists funeral_service_requests_xendit_commission_check;
alter table public.funeral_service_requests
  add constraint funeral_service_requests_xendit_commission_check
  check (
    "paymentProvider" is distinct from 'xendit'
    or (
      -- Pre-checkout / awaiting customer checkout initiation
      "providerReferenceId" is null
      and "commissionStatus" is null
    )
    or (
      -- Active or completed checkout: enforce 30% admin commission and 70% shop payout
      "providerCurrency" = 'PHP'
      and "providerReferenceId" is not null
      and "commissionRate" = 0.3000
      and "paymentAmount" > 0
      and "commissionAmount" = round("paymentAmount" * "commissionRate", 2)
      and "shopNetAmount" = round("paymentAmount" - "commissionAmount", 2)
      and "commissionStatus" in ('pending', 'completed', 'failed')
    )
  ) not valid;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Payout webhook events table
-- ─────────────────────────────────────────────────────────────────────────────
create schema if not exists private;

create table if not exists private.xendit_payout_webhook_events (
  event_id text primary key,
  event_type text not null,
  request_id uuid not null references public.funeral_service_requests(id) on delete cascade,
  payout_id text,
  payout_status text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists xendit_payout_webhook_events_request_received
  on private.xendit_payout_webhook_events (request_id, received_at desc);

alter table private.xendit_payout_webhook_events enable row level security;
revoke all on table private.xendit_payout_webhook_events from public, anon, authenticated;
grant select, insert, update on table private.xendit_payout_webhook_events to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Updated claim_xendit_service_checkout — NO split rule / sub-account params
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_xendit_service_checkout(
  p_request_id uuid,
  p_idempotency_key text,
  p_currency text default 'PHP',
  p_livemode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.funeral_service_requests%rowtype;
  shop_row public.funeral_shops%rowtype;
  authoritative_amount numeric(14,2);
  commission_amount numeric(14,2);
  shop_net_amount numeric(14,2);
  idempotency_key text := nullif(trim(p_idempotency_key), '');
  currency_code text := upper(trim(coalesce(p_currency, '')));
  claim_id uuid;
  should_create boolean := false;
  in_progress boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'This function is restricted to the Xendit payment service.';
  end if;
  if p_livemode then
    raise exception 'This integration is restricted to Xendit Test Mode.';
  end if;
  if idempotency_key is null or char_length(idempotency_key) > 255 then
    raise exception 'A valid Xendit idempotency key is required.';
  end if;
  if currency_code <> 'PHP' then
    raise exception 'LifeCycle Xendit casket checkout supports PHP only.';
  end if;

  select * into request_row
  from public.funeral_service_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Funeral service request not found.';
  end if;

  select * into shop_row
  from public.funeral_shops
  where id = request_row."shopId"
  for share;

  if not found then
    raise exception 'The assigned shop was not found.';
  end if;

  -- Shop must have verified payout details instead of a Xendit sub-account
  if not coalesce(shop_row."payoutVerifiedByAdmin", false) then
    raise exception 'The assigned shop does not have verified payout details. Ask an admin to verify the shop payout account.';
  end if;
  if nullif(trim(shop_row."payoutChannelCode"), '') is null
     or nullif(trim(shop_row."payoutAccountName"), '') is null
     or nullif(trim(shop_row."payoutAccountNumber"), '') is null then
    raise exception 'The assigned shop is missing payout bank/GCash details.';
  end if;

  if request_row."paymentProvider" = 'xendit' then
    if request_row."providerCurrency" <> currency_code
       or request_row."providerLivemode" is distinct from p_livemode then
      raise exception 'The checkout request does not match its saved Xendit snapshots.';
    end if;

    if request_row."providerCheckoutId" is not null then
      return jsonb_build_object(
        'requestId', request_row.id,
        'referenceId', request_row."providerReferenceId",
        'amount', request_row."paymentAmount",
        'currency', request_row."providerCurrency",
        'commissionRate', request_row."commissionRate",
        'commissionAmount', request_row."commissionAmount",
        'shopNetAmount', request_row."shopNetAmount",
        'idempotencyKey', request_row."providerIdempotencyKey",
        'checkoutClaimId', request_row."providerCheckoutClaimId",
        'checkoutId', request_row."providerCheckoutId",
        'checkoutUrl', request_row."providerCheckoutUrl",
        'shouldCreate', false,
        'inProgress', false,
        'livemode', request_row."providerLivemode"
      );
    end if;

    if request_row.status <> 'awaiting_payment' then
      raise exception 'This Xendit order cannot create another checkout in its current state.';
    end if;

    if request_row."providerCheckoutClaimedAt" > now() - interval '10 minutes' then
      claim_id := request_row."providerCheckoutClaimId";
      in_progress := true;
    else
      claim_id := gen_random_uuid();
      should_create := true;
      update public.funeral_service_requests
      set "providerIdempotencyKey" = idempotency_key,
          "providerCheckoutClaimId" = claim_id,
          "providerCheckoutClaimedAt" = now(),
          "providerStatus" = 'checkout_claimed',
          "updatedAt" = now()
      where id = request_row.id
      returning * into request_row;
    end if;
  else
    -- Allow migration from legacy providers (manual, paymongo, or unset) to Xendit
    if coalesce(request_row."paymentProvider", '') not in ('manual', '', 'paymongo', 'xendit') then
      raise exception 'This request already belongs to another unsupported payment provider.';
    end if;
    if request_row.status <> 'awaiting_payment' then
      raise exception 'The service request is not awaiting customer payment.';
    end if;

    select round(quote.total, 2)
    into authoritative_amount
    from public.service_request_quotes quote
    where quote.service_request_id = request_row.id
      and quote.status = 'accepted'
      and quote.total > 0
    order by quote.version desc, quote.updated_at desc
    limit 1
    for share;

    authoritative_amount := coalesce(authoritative_amount, round(request_row."productPrice", 2));
    if authoritative_amount is null or authoritative_amount <= 0 then
      raise exception 'The selected casket does not have a valid saved product or accepted quote price.';
    end if;

    -- Strict 30% LifeCycle platform commission and 70% shop payout split
    commission_amount := round(authoritative_amount * 0.3000, 2);
    shop_net_amount := round(authoritative_amount - commission_amount, 2);
    if commission_amount <= 0 or shop_net_amount < 0 then
      raise exception 'The calculated Xendit commission is invalid.';
    end if;

    claim_id := gen_random_uuid();
    should_create := true;

    update public.funeral_service_requests
    set "paymentProvider" = 'xendit',
        "paymentAmount" = authoritative_amount,
        "paymentQrUrl" = null,
        "paymentPayerName" = null,
        "paymentGcashName" = null,
        "paymentGcashNumber" = null,
        "paymentReferenceNumber" = null,
        "paymentProofImageUrl" = null,
        "paymentSubmittedAt" = null,
        "paymentVerifiedAt" = null,
        "paymentRejectionReason" = null,
        "providerIdempotencyKey" = idempotency_key,
        "providerReferenceId" = request_row.id::text,
        "providerShopAccountId" = null,
        "providerSplitRuleId" = null,
        "providerSplitDestinationAccountId" = null,
        "providerCheckoutClaimId" = claim_id,
        "providerCheckoutClaimedAt" = now(),
        "providerCheckoutId" = null,
        "providerCheckoutUrl" = null,
        "providerCheckoutCreatedAt" = null,
        "providerPaymentId" = null,
        "providerPaymentMethod" = null,
        "providerStatus" = 'checkout_claimed',
        "providerLivemode" = p_livemode,
        "providerEventId" = null,
        "providerPaymentCompletedAt" = null,
        "providerSplitCompletedAt" = null,
        "providerSplitPaymentId" = null,
        "providerCurrency" = currency_code,
        "commissionRate" = 0.3000,
        "commissionAmount" = commission_amount,
        "shopNetAmount" = shop_net_amount,
        "commissionStatus" = 'pending',
        "payoutId" = null,
        "payoutStatus" = null,
        "payoutAmount" = shop_net_amount,
        "payoutCompletedAt" = null,
        "payoutFailureCode" = null,
        "payoutChannelCode" = shop_row."payoutChannelCode",
        "payoutReferenceId" = null,
        "updatedAt" = now()
    where id = request_row.id
    returning * into request_row;
  end if;

  return jsonb_build_object(
    'requestId', request_row.id,
    'referenceId', request_row."providerReferenceId",
    'amount', request_row."paymentAmount",
    'currency', request_row."providerCurrency",
    'commissionRate', request_row."commissionRate",
    'commissionAmount', request_row."commissionAmount",
    'shopNetAmount', request_row."shopNetAmount",
    'idempotencyKey', request_row."providerIdempotencyKey",
    'checkoutClaimId', claim_id,
    'checkoutId', request_row."providerCheckoutId",
    'checkoutUrl', request_row."providerCheckoutUrl",
    'shouldCreate', should_create,
    'inProgress', in_progress,
    'livemode', request_row."providerLivemode"
  );
end;
$$;

-- Drop old function signature (7 params) and grant new one (4 params)
drop function if exists public.claim_xendit_service_checkout(uuid, text, text, text, text, text, boolean);
revoke all on function public.claim_xendit_service_checkout(uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_xendit_service_checkout(uuid, text, text, boolean)
  to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Updated reconcile_xendit_service_event — NO split events, immediate verify
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reconcile_xendit_service_event(
  p_event_id text,
  p_event_type text,
  p_event_kind text,
  p_checkout_id text default null,
  p_reference_id text default null,
  p_provider_payment_id text default null,
  p_provider_split_payment_id text default null,
  p_split_rule_id text default null,
  p_shop_account_id text default null,
  p_destination_account_id text default null,
  p_currency text default null,
  p_gross_amount numeric default null,
  p_split_amount numeric default null,
  p_livemode boolean default false,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  request_row public.funeral_service_requests%rowtype;
  existing_event private.xendit_service_webhook_events%rowtype;
  normalized_event_id text := nullif(trim(p_event_id), '');
  event_type text := nullif(trim(p_event_type), '');
  event_kind text := lower(trim(coalesce(p_event_kind, '')));
  checkout_id text := nullif(trim(p_checkout_id), '');
  reference_id text := nullif(trim(p_reference_id), '');
  payment_id text := nullif(trim(p_provider_payment_id), '');
  currency_code text := nullif(upper(trim(coalesce(p_currency, ''))), '');
  inserted_event_count integer := 0;
  became_verified boolean := false;
  shop_name text;
  shop_payout_channel text;
  shop_account_num text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'This function is restricted to the verified Xendit webhook service.';
  end if;
  if normalized_event_id is null or event_type is null
     or char_length(normalized_event_id) > 255 or char_length(event_type) > 255 then
    raise exception 'Valid Xendit event identifiers are required.';
  end if;
  -- Accept payment_completed and payment_expired only (no split events needed)
  if event_kind not in ('payment_completed', 'payment_expired') then
    raise exception 'Unsupported Xendit service event kind.';
  end if;
  if p_livemode then
    raise exception 'Live Xendit events are not accepted by this Test Mode integration.';
  end if;
  if checkout_id is null and reference_id is null and payment_id is null then
    raise exception 'The Xendit event does not contain an order-matching identifier.';
  end if;

  select request.* into request_row
  from public.funeral_service_requests request
  where request."paymentProvider" = 'xendit'
    and (
      (checkout_id is not null and request."providerCheckoutId" = checkout_id)
      or (reference_id is not null and request."providerReferenceId" = reference_id)
      or (payment_id is not null and request."providerPaymentId" = payment_id)
    )
  order by request."updatedAt" desc
  limit 1
  for update;

  if not found then
    raise exception 'No Xendit service request matches this event.';
  end if;
  if request_row.status not in (
    'awaiting_payment', 'payment_verified'
  ) then
    raise exception 'This service request is not in a payable Xendit state.';
  end if;
  if checkout_id is not null and request_row."providerCheckoutId" is distinct from checkout_id then
    raise exception 'The Xendit payment session ID does not match the request.';
  end if;
  if reference_id is not null and request_row."providerReferenceId" is distinct from reference_id then
    raise exception 'The Xendit reference ID does not match the request.';
  end if;
  if request_row."providerLivemode" is distinct from p_livemode then
    raise exception 'The Xendit event mode does not match the checkout.';
  end if;

  if event_kind = 'payment_completed' then
    if checkout_id is null or reference_id is null or payment_id is null then
      raise exception 'A completed payment must include its session, reference, and payment IDs.';
    end if;
    if currency_code <> 'PHP' or request_row."providerCurrency" <> currency_code then
      raise exception 'The Xendit payment currency does not match PHP checkout.';
    end if;
    if p_gross_amount is null or p_gross_amount <> round(p_gross_amount, 2)
       or request_row."paymentAmount" is distinct from p_gross_amount then
      raise exception 'The Xendit gross payment does not match the authoritative casket total.';
    end if;
    if request_row."providerPaymentId" is not null
       and request_row."providerPaymentId" <> payment_id then
      raise exception 'A different Xendit payment is already attached to this request.';
    end if;
  else
    if checkout_id is null or reference_id is null then
      raise exception 'An expired payment session must include its session and reference IDs.';
    end if;
  end if;

  insert into private.xendit_service_webhook_events (
    event_id, event_type, event_kind, request_id,
    checkout_id, provider_payment_id, provider_split_payment_id,
    provider_status, payload
  ) values (
    normalized_event_id, event_type, event_kind, request_row.id,
    checkout_id, payment_id, null, event_kind,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (event_id) do nothing;
  get diagnostics inserted_event_count = row_count;

  if inserted_event_count = 0 then
    select * into existing_event
    from private.xendit_service_webhook_events
    where event_id = normalized_event_id;

    if existing_event.request_id <> request_row.id
       or existing_event.event_type <> event_type
       or existing_event.event_kind <> event_kind then
      raise exception 'The Xendit event ID was already used for different event data.';
    end if;

    return jsonb_build_object(
      'requestId', request_row.id,
      'status', request_row.status,
      'providerStatus', request_row."providerStatus",
      'commissionStatus', request_row."commissionStatus",
      'duplicate', true
    );
  end if;

  if event_kind = 'payment_completed' then
    -- Direct payout model: mark as payment_verified immediately
    became_verified := request_row.status <> 'payment_verified';

    update public.funeral_service_requests
    set status = 'payment_verified',
        "providerPaymentId" = payment_id,
        "providerStatus" = 'payment_verified',
        "providerEventId" = normalized_event_id,
        "providerPaymentCompletedAt" = coalesce("providerPaymentCompletedAt", now()),
        "paymentSubmittedAt" = coalesce("paymentSubmittedAt", now()),
        "paymentVerifiedAt" = coalesce("paymentVerifiedAt", now()),
        "commissionStatus" = 'completed',
        "updatedAt" = now()
    where id = request_row.id
    returning * into request_row;
  else
    -- payment_expired: reset checkout so customer can retry
    if request_row."providerPaymentCompletedAt" is null then
      update public.funeral_service_requests
      set status = 'awaiting_payment',
          "providerStatus" = 'expired',
          "providerEventId" = normalized_event_id,
          "providerCheckoutId" = null,
          "providerCheckoutUrl" = null,
          "providerCheckoutCreatedAt" = null,
          "providerCheckoutClaimId" = null,
          "providerCheckoutClaimedAt" = null,
          "updatedAt" = now()
      where id = request_row.id
      returning * into request_row;
    end if;
  end if;

  update private.xendit_service_webhook_events
  set processed_at = now(),
      resulting_order_status = request_row.status,
      resulting_commission_status = request_row."commissionStatus"
  where event_id = normalized_event_id;

  if became_verified then
    select "name", "payoutChannelCode", "payoutAccountNumber"
    into shop_name, shop_payout_channel, shop_account_num
    from public.funeral_shops
    where id = request_row."shopId";

    -- 1. Notify the Shop Owner with exact 70% payout share and total
    insert into public.notifications ("userId", type, title, body, data, read)
    values (
      request_row."shopId",
      'funeral_payment_verified',
      'Payment Received: ₱' || to_char(coalesce(request_row."shopNetAmount", 0), 'FM999,999,990.00'),
      'Customer paid ₱' || to_char(coalesce(request_row."paymentAmount", 0), 'FM999,999,990.00') || ' for order #' || left(request_row.id::text, 8) || '. Your 70% share of ₱' || to_char(coalesce(request_row."shopNetAmount", 0), 'FM999,999,990.00') || ' is being processed to your ' || coalesce(shop_payout_channel, 'payout account') || '.',
      jsonb_build_object(
        'requestId', request_row.id,
        'provider', 'xendit',
        'totalAmount', request_row."paymentAmount",
        'shopNetAmount', request_row."shopNetAmount",
        'adminCommission', request_row."adminCommissionAmount",
        'payoutChannel', shop_payout_channel
      ),
      false
    );

    -- 2. Notify All System Administrators with exact 30% commission and 70% payout
    insert into public.notifications ("userId", type, title, body, data, read)
    select
      admin_user.id,
      'admin_payment_received',
      'Payment Received: ₱' || to_char(coalesce(request_row."paymentAmount", 0), 'FM999,999,990.00'),
      'Payment of ₱' || to_char(coalesce(request_row."paymentAmount", 0), 'FM999,999,990.00') || ' confirmed for ' || coalesce(shop_name, 'Shop') || ' (order #' || left(request_row.id::text, 8) || '). 30% admin commission: ₱' || to_char(coalesce(request_row."adminCommissionAmount", 0), 'FM999,999,990.00') || '; Shop 70% payout: ₱' || to_char(coalesce(request_row."shopNetAmount", 0), 'FM999,999,990.00') || '.',
      jsonb_build_object(
        'requestId', request_row.id,
        'provider', 'xendit',
        'totalAmount', request_row."paymentAmount",
        'adminCommission', request_row."adminCommissionAmount",
        'shopNetAmount', request_row."shopNetAmount",
        'shopId', request_row."shopId",
        'shopName', shop_name
      ),
      false
    from public.users admin_user
    where admin_user.role in ('admin', 'super_admin', 'funeral_admin');

    -- 3. Notify Customer/Requester
    insert into public.notifications ("userId", type, title, body, data, read)
    values (
      request_row."requesterId",
      'funeral_payment_verified',
      'Payment Confirmed: ₱' || to_char(coalesce(request_row."paymentAmount", 0), 'FM999,999,990.00'),
      'Your casket payment of ₱' || to_char(coalesce(request_row."paymentAmount", 0), 'FM999,999,990.00') || ' was confirmed. ' || coalesce(shop_name, 'The shop') || ' is preparing your service.',
      jsonb_build_object('requestId', request_row.id, 'provider', 'xendit', 'totalAmount', request_row."paymentAmount"),
      false
    );
  end if;

  return jsonb_build_object(
    'requestId', request_row.id,
    'status', request_row.status,
    'providerStatus', request_row."providerStatus",
    'commissionStatus', request_row."commissionStatus",
    'shopNetAmount', request_row."shopNetAmount",
    'duplicate', false
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. initiate_shop_payout — returns shop payout details for Edge Function
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.initiate_shop_payout(
  p_request_id uuid,
  p_payout_reference_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.funeral_service_requests%rowtype;
  shop_row public.funeral_shops%rowtype;
  payout_ref text := nullif(trim(p_payout_reference_id), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'This function is restricted to the payment service.';
  end if;
  if payout_ref is null or char_length(payout_ref) > 255 then
    raise exception 'A valid payout reference ID is required.';
  end if;

  select * into request_row
  from public.funeral_service_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Service request not found.';
  end if;
  if request_row."paymentProvider" <> 'xendit' then
    raise exception 'This request is not a Xendit payment.';
  end if;
  if request_row.status <> 'payment_verified' then
    raise exception 'Payment must be verified before initiating a payout.';
  end if;

  -- Already has a payout
  if request_row."payoutId" is not null then
    return jsonb_build_object(
      'requestId', request_row.id,
      'alreadyInitiated', true,
      'payoutId', request_row."payoutId",
      'payoutStatus', request_row."payoutStatus"
    );
  end if;

  select * into shop_row
  from public.funeral_shops
  where id = request_row."shopId"
  for share;

  if not found or not coalesce(shop_row."payoutVerifiedByAdmin", false) then
    raise exception 'The shop does not have verified payout details.';
  end if;

  update public.funeral_service_requests
  set "payoutStatus" = 'pending',
      "payoutAmount" = request_row."shopNetAmount",
      "payoutChannelCode" = shop_row."payoutChannelCode",
      "payoutReferenceId" = payout_ref,
      "updatedAt" = now()
  where id = request_row.id
  returning * into request_row;

  return jsonb_build_object(
    'requestId', request_row.id,
    'alreadyInitiated', false,
    'payoutAmount', request_row."shopNetAmount",
    'payoutChannelCode', shop_row."payoutChannelCode",
    'payoutAccountName', shop_row."payoutAccountName",
    'payoutAccountNumber', shop_row."payoutAccountNumber",
    'payoutReferenceId', payout_ref,
    'currency', 'PHP'
  );
end;
$$;

revoke all on function public.initiate_shop_payout(uuid, text) from public, anon, authenticated;
grant execute on function public.initiate_shop_payout(uuid, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. reconcile_payout_event — updates payout status from webhook
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reconcile_payout_event(
  p_event_id text,
  p_payout_id text,
  p_reference_id text,
  p_status text,
  p_failure_code text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  request_row public.funeral_service_requests%rowtype;
  event_id text := nullif(trim(p_event_id), '');
  payout_id text := nullif(trim(p_payout_id), '');
  reference_id text := nullif(trim(p_reference_id), '');
  payout_status text := lower(trim(coalesce(p_status, '')));
  failure_code text := nullif(trim(p_failure_code), '');
  inserted_count integer := 0;
  shop_name text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'This function is restricted to the payment service.';
  end if;
  if event_id is null or payout_id is null or reference_id is null then
    raise exception 'Valid payout event identifiers are required.';
  end if;
  if payout_status not in ('succeeded', 'failed') then
    raise exception 'Unsupported payout status.';
  end if;

  select * into request_row
  from public.funeral_service_requests
  where "payoutReferenceId" = reference_id
    and "paymentProvider" = 'xendit'
  for update;

  if not found then
    raise exception 'No service request matches this payout reference.';
  end if;

  insert into private.xendit_payout_webhook_events (
    event_id, event_type, request_id, payout_id, payout_status, payload
  ) values (
    event_id, 'payout.' || payout_status, request_row.id, payout_id, payout_status, coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (event_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    return jsonb_build_object(
      'requestId', request_row.id,
      'payoutStatus', request_row."payoutStatus",
      'duplicate', true
    );
  end if;

  if payout_status = 'succeeded' then
    update public.funeral_service_requests
    set "payoutId" = payout_id,
        "payoutStatus" = 'succeeded',
        "payoutCompletedAt" = now(),
        "payoutFailureCode" = null,
        "updatedAt" = now()
    where id = request_row.id
    returning * into request_row;
  else
    update public.funeral_service_requests
    set "payoutId" = payout_id,
        "payoutStatus" = 'failed',
        "payoutFailureCode" = left(failure_code, 200),
        "updatedAt" = now()
    where id = request_row.id
    returning * into request_row;
  end if;

  update private.xendit_payout_webhook_events
  set processed_at = now()
  where event_id = p_event_id;

  select "name" into shop_name
  from public.funeral_shops
  where id = request_row."shopId";

  if payout_status = 'succeeded' then
    -- 1. Notify Shop that 70% payout is sent/deposited
    insert into public.notifications ("userId", type, title, body, data, read)
    values (
      request_row."shopId",
      'shop_payout_succeeded',
      'Payout Sent: ₱' || to_char(coalesce(request_row."payoutAmount", request_row."shopNetAmount", 0), 'FM999,999,990.00'),
      'Your 70% payout of ₱' || to_char(coalesce(request_row."payoutAmount", request_row."shopNetAmount", 0), 'FM999,999,990.00') || ' for order #' || left(request_row.id::text, 8) || ' has been successfully sent to your ' || coalesce(request_row."payoutChannelCode", 'account') || '.',
      jsonb_build_object(
        'requestId', request_row.id,
        'payoutId', payout_id,
        'amount', coalesce(request_row."payoutAmount", request_row."shopNetAmount", 0),
        'channel', request_row."payoutChannelCode"
      ),
      false
    );

    -- 2. Notify Admins that shop payout completed
    insert into public.notifications ("userId", type, title, body, data, read)
    select
      admin_user.id,
      'admin_payout_completed',
      'Shop Payout Sent: ₱' || to_char(coalesce(request_row."payoutAmount", request_row."shopNetAmount", 0), 'FM999,999,990.00'),
      '70% payout of ₱' || to_char(coalesce(request_row."payoutAmount", request_row."shopNetAmount", 0), 'FM999,999,990.00') || ' for order #' || left(request_row.id::text, 8) || ' (' || coalesce(shop_name, 'Shop') || ') succeeded via ' || coalesce(request_row."payoutChannelCode", 'Xendit') || '.',
      jsonb_build_object(
        'requestId', request_row.id,
        'payoutId', payout_id,
        'amount', coalesce(request_row."payoutAmount", request_row."shopNetAmount", 0),
        'shopId', request_row."shopId",
        'shopName', shop_name
      ),
      false
    from public.users admin_user
    where admin_user.role in ('admin', 'super_admin', 'funeral_admin');
  else
    -- 1. Notify Shop that payout had an issue
    insert into public.notifications ("userId", type, title, body, data, read)
    values (
      request_row."shopId",
      'shop_payout_failed',
      'Payout Issue: ₱' || to_char(coalesce(request_row."payoutAmount", request_row."shopNetAmount", 0), 'FM999,999,990.00'),
      'Your 70% payout of ₱' || to_char(coalesce(request_row."payoutAmount", request_row."shopNetAmount", 0), 'FM999,999,990.00') || ' for order #' || left(request_row.id::text, 8) || ' encountered an issue (' || coalesce(failure_code, 'processing error') || '). An administrator will review your account.',
      jsonb_build_object(
        'requestId', request_row.id,
        'payoutId', payout_id,
        'amount', coalesce(request_row."payoutAmount", request_row."shopNetAmount", 0),
        'failureCode', failure_code
      ),
      false
    );

    -- 2. Alert Admins of the failed payout
    insert into public.notifications ("userId", type, title, body, data, read)
    select
      admin_user.id,
      'admin_payout_failed',
      'ALERT: Shop Payout Failed (₱' || to_char(coalesce(request_row."payoutAmount", request_row."shopNetAmount", 0), 'FM999,999,990.00') || ')',
      '70% payout of ₱' || to_char(coalesce(request_row."payoutAmount", request_row."shopNetAmount", 0), 'FM999,999,990.00') || ' for order #' || left(request_row.id::text, 8) || ' (' || coalesce(shop_name, 'Shop') || ') failed (' || coalesce(failure_code, 'unknown') || '). Please verify shop payout details in Admin Verifications.',
      jsonb_build_object(
        'requestId', request_row.id,
        'payoutId', payout_id,
        'amount', coalesce(request_row."payoutAmount", request_row."shopNetAmount", 0),
        'failureCode', failure_code,
        'shopId', request_row."shopId",
        'shopName', shop_name
      ),
      false
    from public.users admin_user
    where admin_user.role in ('admin', 'super_admin', 'funeral_admin');
  end if;

  return jsonb_build_object(
    'requestId', request_row.id,
    'payoutId', payout_id,
    'payoutStatus', request_row."payoutStatus",
    'duplicate', false
  );
end;
$$;

revoke all on function public.reconcile_payout_event(text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.reconcile_payout_event(text, text, text, text, text, jsonb)
  to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Update protect trigger to allow payout fields only via service_role
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
-- 10. Update flow trigger to remove legacy manual QR code requirement
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
-- 11. Update accept_funeral_service_request for direct payout model
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Protect payout fields on funeral_shops
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.protect_shop_payout_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  is_admin boolean := false;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('admin', 'super_admin', 'funeral_admin')
  ) into is_admin;

  if tg_op = 'UPDATE' then
    if not is_admin then
      -- Non-admins CANNOT mark their own payout account as verified
      if coalesce(new."payoutVerifiedByAdmin", false) = true
         and coalesce(old."payoutVerifiedByAdmin", false) is distinct from true then
        raise exception 'Only an administrator can verify payout account details.';
      end if;

      if new."payoutVerifiedAt" is not null
         and old."payoutVerifiedAt" is distinct from new."payoutVerifiedAt" then
        raise exception 'Only an administrator can set payout verification timestamp.';
      end if;

      -- If a shop owner modifies payout channel or account, reset verification to pending
      if old."payoutChannelCode" is distinct from new."payoutChannelCode"
         or old."payoutAccountName" is distinct from new."payoutAccountName"
         or old."payoutAccountNumber" is distinct from new."payoutAccountNumber" then
        new."payoutVerifiedByAdmin" := false;
        new."payoutVerifiedAt" := null;
      end if;
    end if;
  elsif tg_op = 'INSERT' then
    if not is_admin then
      new."payoutVerifiedByAdmin" := false;
      new."payoutVerifiedAt" := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_shop_payout_fields on public.funeral_shops;
create trigger protect_shop_payout_fields
before insert or update on public.funeral_shops
for each row execute function public.protect_shop_payout_fields();

-- Comments
comment on column public.funeral_shops."payoutChannelCode" is
  'Xendit Payouts channel code (e.g. PH_GCASH, PH_BDO).';
comment on column public.funeral_shops."payoutAccountName" is
  'Account holder name for payout destination.';
comment on column public.funeral_shops."payoutAccountNumber" is
  'Account number / GCash number for payout destination.';
comment on column public.funeral_shops."payoutVerifiedByAdmin" is
  'True when admin has verified the shop payout details.';
comment on column public.funeral_service_requests."payoutId" is
  'Xendit Payout ID from POST /v2/payouts for the 70% shop payout.';
comment on column public.funeral_service_requests."payoutStatus" is
  'Payout status: pending | succeeded | failed.';
comment on function public.initiate_shop_payout(uuid, text) is
  'Returns shop payout details for the Edge Function to call Xendit Payouts API.';
comment on function public.reconcile_payout_event(text, text, text, text, text, jsonb) is
  'Idempotently reconciles Xendit payout webhook events.';

notify pgrst, 'reload schema';

commit;
