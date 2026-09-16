begin;

-- Xendit marketplace account metadata. These values are written only by the
-- trusted provisioning Edge Function; shop owners cannot self-assign an
-- account ID or mark provisioning as complete.
alter table public.funeral_shops
  add column if not exists "xenditAccountId" text,
  add column if not exists "xenditProvisioningStatus" text not null default 'not_started',
  add column if not exists "xenditProvisioningError" text,
  add column if not exists "xenditProvisioningAttemptId" uuid,
  add column if not exists "xenditProvisioningStartedAt" timestamptz,
  add column if not exists "xenditProvisionedAt" timestamptz,
  add column if not exists "xenditProvisioningUpdatedAt" timestamptz;

create unique index if not exists funeral_shops_xendit_account_unique
  on public.funeral_shops ("xenditAccountId")
  where "xenditAccountId" is not null;

alter table public.funeral_shops
  drop constraint if exists funeral_shops_xendit_provisioning_status_check;
alter table public.funeral_shops
  add constraint funeral_shops_xendit_provisioning_status_check
  check ("xenditProvisioningStatus" in ('not_started', 'pending', 'provisioned', 'failed'));

-- Reuse the provider-neutral PayMongo columns and add only the provider
-- snapshots needed to prove that the Xendit payment and its 30% route belong
-- to this exact request, shop, split rule, and master business.
alter table public.funeral_service_requests
  add column if not exists "providerIdempotencyKey" text,
  add column if not exists "providerReferenceId" text,
  add column if not exists "providerShopAccountId" text,
  add column if not exists "providerSplitRuleId" text,
  add column if not exists "providerSplitDestinationAccountId" text,
  add column if not exists "providerCheckoutClaimId" uuid,
  add column if not exists "providerCheckoutClaimedAt" timestamptz,
  add column if not exists "providerPaymentCompletedAt" timestamptz,
  add column if not exists "providerSplitCompletedAt" timestamptz,
  add column if not exists "commissionRate" numeric(5,4),
  add column if not exists "commissionAmount" numeric(14,2),
  add column if not exists "shopNetAmount" numeric(14,2),
  add column if not exists "commissionStatus" text,
  add column if not exists "providerSplitPaymentId" text,
  add column if not exists "providerCurrency" text;

create unique index if not exists funeral_service_requests_xendit_idempotency_unique
  on public.funeral_service_requests ("providerIdempotencyKey")
  where "paymentProvider" = 'xendit' and "providerIdempotencyKey" is not null;

create unique index if not exists funeral_service_requests_xendit_reference_unique
  on public.funeral_service_requests ("providerReferenceId")
  where "paymentProvider" = 'xendit' and "providerReferenceId" is not null;

create unique index if not exists funeral_service_requests_xendit_payment_unique
  on public.funeral_service_requests ("providerPaymentId")
  where "paymentProvider" = 'xendit' and "providerPaymentId" is not null;

create unique index if not exists funeral_service_requests_xendit_split_payment_unique
  on public.funeral_service_requests ("providerSplitPaymentId")
  where "paymentProvider" = 'xendit' and "providerSplitPaymentId" is not null;

alter table public.funeral_service_requests
  drop constraint if exists funeral_service_requests_commission_status_check;
alter table public.funeral_service_requests
  add constraint funeral_service_requests_commission_status_check
  check ("commissionStatus" is null or "commissionStatus" in ('pending', 'completed', 'failed'));

alter table public.funeral_service_requests
  drop constraint if exists funeral_service_requests_xendit_commission_check;
alter table public.funeral_service_requests
  add constraint funeral_service_requests_xendit_commission_check
  check (
    "paymentProvider" is distinct from 'xendit'
    or (
      "providerCurrency" = 'PHP'
      and "providerShopAccountId" is not null
      and "providerSplitRuleId" is not null
      and "providerSplitDestinationAccountId" is not null
      and "providerReferenceId" is not null
      and "commissionRate" = 0.3000
      and "paymentAmount" > 0
      and "commissionAmount" = round("paymentAmount" * "commissionRate", 2)
      and "shopNetAmount" = round("paymentAmount" - "commissionAmount", 2)
      and "commissionStatus" in ('pending', 'completed', 'failed')
    )
  ) not valid;

-- The Xendit webhook flow introduces two intermediate failure/waiting states.
-- Keep all manual and PayMongo states so existing orders remain valid.
alter table public.funeral_service_requests
  drop constraint if exists funeral_service_requests_status_check;
alter table public.funeral_service_requests
  add constraint funeral_service_requests_status_check
  check (status in (
    'pending_shop_acceptance',
    'accepted_by_shop',
    'awaiting_payment',
    'payment_submitted',
    'paid_waiting_for_split',
    'commission_failed',
    'payment_verified',
    'awaiting_customer_confirmation',
    'completed',
    'declined_by_shop',
    'cancelled_by_requester'
  )) not valid;

-- Webhook payloads and idempotency records are deliberately outside the
-- exposed public schema. Only the service role and SECURITY DEFINER RPC below
-- can access them.
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.xendit_service_webhook_events (
  event_id text primary key,
  event_type text not null,
  event_kind text not null
    check (event_kind in ('payment_completed', 'payment_expired', 'split_completed', 'split_failed')),
  request_id uuid not null references public.funeral_service_requests(id) on delete cascade,
  checkout_id text,
  provider_payment_id text,
  provider_split_payment_id text,
  provider_status text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  resulting_order_status text,
  resulting_commission_status text
);

create index if not exists xendit_service_webhook_events_request_received
  on private.xendit_service_webhook_events (request_id, received_at desc);

alter table private.xendit_service_webhook_events enable row level security;
revoke all on table private.xendit_service_webhook_events from public, anon, authenticated;
grant select, insert, update on table private.xendit_service_webhook_events to service_role;

create or replace function public.protect_xendit_shop_account_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new."xenditAccountId" is not null
       or new."xenditProvisioningStatus" <> 'not_started'
       or new."xenditProvisioningError" is not null
       or new."xenditProvisioningAttemptId" is not null
       or new."xenditProvisioningStartedAt" is not null
       or new."xenditProvisionedAt" is not null
       or new."xenditProvisioningUpdatedAt" is not null then
      raise exception 'Xendit account fields can be set only by the provisioning service.';
    end if;
  elsif old."xenditAccountId" is distinct from new."xenditAccountId"
     or old."xenditProvisioningStatus" is distinct from new."xenditProvisioningStatus"
     or old."xenditProvisioningError" is distinct from new."xenditProvisioningError"
     or old."xenditProvisioningAttemptId" is distinct from new."xenditProvisioningAttemptId"
     or old."xenditProvisioningStartedAt" is distinct from new."xenditProvisioningStartedAt"
     or old."xenditProvisionedAt" is distinct from new."xenditProvisionedAt"
     or old."xenditProvisioningUpdatedAt" is distinct from new."xenditProvisioningUpdatedAt" then
    raise exception 'Xendit account fields can be changed only by the provisioning service.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_xendit_shop_account_fields on public.funeral_shops;
create trigger protect_xendit_shop_account_fields
before insert or update on public.funeral_shops
for each row execute function public.protect_xendit_shop_account_fields();

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
       or new."providerCurrency" is not null then
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
     or old."providerCurrency" is distinct from new."providerCurrency" then
    raise exception 'Xendit payment fields can be changed only by the payment service.';
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

drop trigger if exists protect_xendit_service_payment_fields on public.funeral_service_requests;
create trigger protect_xendit_service_payment_fields
before insert or update on public.funeral_service_requests
for each row execute function public.protect_xendit_service_payment_fields();

-- Acquire a short provisioning lease. The attempt ID prevents an old or
-- concurrent Xendit response from overwriting a newer provisioning attempt.
create or replace function public.claim_xendit_shop_provisioning(p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  shop_row public.funeral_shops%rowtype;
  owner_row public.users%rowtype;
  attempt_id uuid;
  should_provision boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'This function is restricted to the Xendit provisioning service.';
  end if;

  select * into shop_row
  from public.funeral_shops
  where id = p_shop_id
  for update;

  if not found then
    raise exception 'Funeral shop not found.';
  end if;

  if lower(trim(coalesce(shop_row.status, ''))) not in ('verified', 'live', 'offline') then
    raise exception 'Verify the funeral shop before provisioning Xendit.';
  end if;
  if char_length(trim(coalesce(shop_row."shopName", ''))) < 2 then
    raise exception 'The verified funeral shop name is invalid.';
  end if;

  select * into owner_row
  from public.users
  where id = shop_row.id
  for share;

  if not found
     or owner_row.role <> 'funeral'
     or coalesce(owner_row.disabled, false)
     or nullif(trim(owner_row.email), '') is null
     or trim(owner_row.email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'The funeral shop owner account is not eligible for Xendit provisioning.';
  end if;

  if shop_row."xenditAccountId" is not null then
    if shop_row."xenditProvisioningStatus" <> 'provisioned' then
      update public.funeral_shops
      set "xenditProvisioningStatus" = 'provisioned',
          "xenditProvisioningError" = null,
          "xenditProvisionedAt" = coalesce("xenditProvisionedAt", now()),
          "xenditProvisioningUpdatedAt" = now()
      where id = shop_row.id
      returning * into shop_row;
    end if;
  elsif shop_row."xenditProvisioningStatus" = 'pending'
        and shop_row."xenditProvisioningStartedAt" > now() - interval '10 minutes' then
    attempt_id := shop_row."xenditProvisioningAttemptId";
  else
    attempt_id := gen_random_uuid();
    should_provision := true;

    update public.funeral_shops
    set "xenditProvisioningStatus" = 'pending',
        "xenditProvisioningError" = null,
        "xenditProvisioningAttemptId" = attempt_id,
        "xenditProvisioningStartedAt" = now(),
        "xenditProvisioningUpdatedAt" = now()
    where id = shop_row.id
    returning * into shop_row;
  end if;

  return jsonb_build_object(
    'shopId', shop_row.id,
    'shopName', shop_row."shopName",
    'email', lower(trim(owner_row.email)),
    'shouldProvision', should_provision,
    'xenditAccountId', shop_row."xenditAccountId",
    'provisioningStatus', shop_row."xenditProvisioningStatus",
    'provisioningAttemptId', coalesce(attempt_id, shop_row."xenditProvisioningAttemptId")
  );
end;
$$;

create or replace function public.finish_xendit_shop_provisioning(
  p_shop_id uuid,
  p_attempt_id uuid,
  p_xendit_account_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  shop_row public.funeral_shops%rowtype;
  account_id text := nullif(trim(p_xendit_account_id), '');
  error_message text := nullif(trim(p_error), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'This function is restricted to the Xendit provisioning service.';
  end if;

  if p_attempt_id is null then
    raise exception 'A provisioning attempt ID is required.';
  end if;
  if (account_id is null) = (error_message is null) then
    raise exception 'Provide exactly one of the Xendit account ID or provisioning error.';
  end if;
  if account_id is not null and (char_length(account_id) > 255 or account_id !~ '^[A-Za-z0-9_-]+$') then
    raise exception 'Invalid Xendit account ID.';
  end if;

  select * into shop_row
  from public.funeral_shops
  where id = p_shop_id
  for update;

  if not found then
    raise exception 'Funeral shop not found.';
  end if;
  if shop_row."xenditProvisioningAttemptId" is distinct from p_attempt_id then
    raise exception 'This Xendit provisioning attempt is stale.';
  end if;

  if shop_row."xenditProvisioningStatus" = 'provisioned' then
    if shop_row."xenditAccountId" is distinct from account_id then
      raise exception 'This shop was already provisioned with another Xendit account.';
    end if;
  elsif shop_row."xenditProvisioningStatus" = 'failed' then
    if error_message is null then
      raise exception 'A failed provisioning attempt cannot be completed with a late success response.';
    end if;
  elsif shop_row."xenditProvisioningStatus" <> 'pending' then
    raise exception 'This shop does not have an active Xendit provisioning claim.';
  elsif account_id is not null then
    update public.funeral_shops
    set "xenditAccountId" = account_id,
        "xenditProvisioningStatus" = 'provisioned',
        "xenditProvisioningError" = null,
        "xenditProvisionedAt" = now(),
        "xenditProvisioningUpdatedAt" = now()
    where id = shop_row.id
    returning * into shop_row;
  else
    update public.funeral_shops
    set "xenditProvisioningStatus" = 'failed',
        "xenditProvisioningError" = left(error_message, 2000),
        "xenditProvisionedAt" = null,
        "xenditProvisioningUpdatedAt" = now()
    where id = shop_row.id
    returning * into shop_row;
  end if;

  return jsonb_build_object(
    'shopId', shop_row.id,
    'xenditAccountId', shop_row."xenditAccountId",
    'provisioningStatus', shop_row."xenditProvisioningStatus",
    'provisioningError', shop_row."xenditProvisioningError",
    'provisionedAt', shop_row."xenditProvisionedAt"
  );
end;
$$;

-- Claiming snapshots the authoritative order price. An accepted final quote
-- wins; otherwise the saved productPrice is used. paymentAmount is corrected
-- here so the old shop-level serviceFeeAmount can never drive Xendit's split.
create or replace function public.claim_xendit_service_checkout(
  p_request_id uuid,
  p_idempotency_key text,
  p_shop_account_id text,
  p_split_rule_id text,
  p_master_business_id text,
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
  shop_account_id text := nullif(trim(p_shop_account_id), '');
  split_rule_id text := nullif(trim(p_split_rule_id), '');
  master_business_id text := nullif(trim(p_master_business_id), '');
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
  if shop_account_id is null or char_length(shop_account_id) > 255
     or split_rule_id is null or char_length(split_rule_id) > 255
     or master_business_id is null or char_length(master_business_id) > 255 then
    raise exception 'Xendit shop, split-rule, and master-business IDs are required.';
  end if;
  if shop_account_id = master_business_id then
    raise exception 'The shop account must be different from the commission destination.';
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

  if not found
     or shop_row."xenditProvisioningStatus" <> 'provisioned'
     or nullif(trim(shop_row."xenditAccountId"), '') is null then
    raise exception 'The assigned shop does not have a provisioned Xendit account.';
  end if;
  if shop_row."xenditAccountId" <> shop_account_id then
    raise exception 'The supplied Xendit shop account does not match the assigned shop.';
  end if;

  if request_row."paymentProvider" = 'xendit' then
    if request_row."providerShopAccountId" <> shop_account_id
       or request_row."providerSplitRuleId" <> split_rule_id
       or request_row."providerSplitDestinationAccountId" <> master_business_id
       or request_row."providerCurrency" <> currency_code
       or request_row."providerLivemode" is distinct from p_livemode then
      raise exception 'The checkout request does not match its saved Xendit snapshots.';
    end if;

    if request_row."providerCheckoutId" is not null then
      return jsonb_build_object(
        'requestId', request_row.id,
        'referenceId', request_row."providerReferenceId",
        'shopAccountId', request_row."providerShopAccountId",
        'amount', request_row."paymentAmount",
        'currency', request_row."providerCurrency",
        'commissionRate', request_row."commissionRate",
        'commissionAmount', request_row."commissionAmount",
        'shopNetAmount', request_row."shopNetAmount",
        'splitRuleId', request_row."providerSplitRuleId",
        'masterBusinessId', request_row."providerSplitDestinationAccountId",
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
    if request_row."paymentProvider" not in ('manual', '') then
      raise exception 'This request already belongs to another payment provider.';
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
        "providerShopAccountId" = shop_account_id,
        "providerSplitRuleId" = split_rule_id,
        "providerSplitDestinationAccountId" = master_business_id,
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
        "updatedAt" = now()
    where id = request_row.id
    returning * into request_row;
  end if;

  return jsonb_build_object(
    'requestId', request_row.id,
    'referenceId', request_row."providerReferenceId",
    'shopAccountId', request_row."providerShopAccountId",
    'amount', request_row."paymentAmount",
    'currency', request_row."providerCurrency",
    'commissionRate', request_row."commissionRate",
    'commissionAmount', request_row."commissionAmount",
    'shopNetAmount', request_row."shopNetAmount",
    'splitRuleId', request_row."providerSplitRuleId",
    'masterBusinessId', request_row."providerSplitDestinationAccountId",
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

create or replace function public.store_xendit_service_checkout(
  p_request_id uuid,
  p_checkout_claim_id uuid,
  p_idempotency_key text,
  p_payment_session_id text,
  p_payment_link_url text,
  p_shop_account_id text,
  p_amount numeric,
  p_currency text,
  p_livemode boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.funeral_service_requests%rowtype;
  payment_session_id text := nullif(trim(p_payment_session_id), '');
  payment_link_url text := nullif(trim(p_payment_link_url), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'This function is restricted to the Xendit payment service.';
  end if;
  if payment_session_id is null or char_length(payment_session_id) > 255 then
    raise exception 'A valid Xendit payment session ID is required.';
  end if;
  if payment_link_url is null or char_length(payment_link_url) > 2048
     or payment_link_url !~* '^https://[^[:space:]]+$' then
    raise exception 'A valid HTTPS Xendit checkout URL is required.';
  end if;

  select * into request_row
  from public.funeral_service_requests
  where id = p_request_id
  for update;

  if not found or request_row."paymentProvider" <> 'xendit' then
    raise exception 'Xendit service checkout claim not found.';
  end if;
  if request_row.status <> 'awaiting_payment' then
    raise exception 'This service request is no longer awaiting payment.';
  end if;
  if request_row."providerCheckoutClaimId" is distinct from p_checkout_claim_id
     or request_row."providerIdempotencyKey" is distinct from nullif(trim(p_idempotency_key), '') then
    raise exception 'The Xendit checkout claim or idempotency key does not match.';
  end if;
  if request_row."providerShopAccountId" is distinct from nullif(trim(p_shop_account_id), '')
     or request_row."providerCurrency" is distinct from upper(trim(coalesce(p_currency, '')))
     or request_row."providerLivemode" is distinct from p_livemode then
    raise exception 'The Xendit checkout response does not match the saved provider context.';
  end if;
  if p_amount is null or p_amount <> round(p_amount, 2)
     or request_row."paymentAmount" is distinct from p_amount then
    raise exception 'The Xendit checkout amount does not match the authoritative casket total.';
  end if;

  if request_row."providerCheckoutId" is not null then
    if request_row."providerCheckoutId" <> payment_session_id
       or request_row."providerCheckoutUrl" is distinct from payment_link_url then
      raise exception 'A different Xendit checkout is already stored for this request.';
    end if;
  else
    update public.funeral_service_requests
    set "providerCheckoutId" = payment_session_id,
        "providerCheckoutUrl" = payment_link_url,
        "providerCheckoutCreatedAt" = now(),
        "providerStatus" = 'checkout_created',
        "updatedAt" = now()
    where id = request_row.id
    returning * into request_row;
  end if;

  return jsonb_build_object(
    'requestId', request_row.id,
    'checkoutId', request_row."providerCheckoutId",
    'checkoutUrl', request_row."providerCheckoutUrl",
    'providerStatus', request_row."providerStatus",
    'amount', request_row."paymentAmount",
    'currency', request_row."providerCurrency"
  );
end;
$$;

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
  split_payment_id text := nullif(trim(p_provider_split_payment_id), '');
  split_rule_id text := nullif(trim(p_split_rule_id), '');
  shop_account_id text := nullif(trim(p_shop_account_id), '');
  destination_account_id text := nullif(trim(p_destination_account_id), '');
  currency_code text := nullif(upper(trim(coalesce(p_currency, ''))), '');
  inserted_event_count integer := 0;
  became_verified boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'This function is restricted to the verified Xendit webhook service.';
  end if;
  if normalized_event_id is null or event_type is null
     or char_length(normalized_event_id) > 255 or char_length(event_type) > 255 then
    raise exception 'Valid Xendit event identifiers are required.';
  end if;
  if event_kind not in ('payment_completed', 'payment_expired', 'split_completed', 'split_failed') then
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
    'awaiting_payment', 'paid_waiting_for_split', 'commission_failed', 'payment_verified'
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
  if shop_account_id is not null
     and request_row."providerShopAccountId" is distinct from shop_account_id then
    raise exception 'The Xendit shop account does not match the checkout.';
  end if;

  if event_kind = 'payment_completed' then
    if checkout_id is null or reference_id is null or payment_id is null or shop_account_id is null then
      raise exception 'A completed payment must include its session, reference, payment, and shop account IDs.';
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
  elsif event_kind in ('split_completed', 'split_failed') then
    if split_payment_id is null or split_rule_id is null
       or destination_account_id is null or currency_code is null
       or p_split_amount is null then
      raise exception 'A split event must include its split, rule, destination, currency, and amount.';
    end if;
    if split_rule_id <> request_row."providerSplitRuleId" then
      raise exception 'The split event does not use the expected LifeCycle split rule.';
    end if;
    if destination_account_id <> request_row."providerSplitDestinationAccountId" then
      raise exception 'The split commission was not routed to the expected master business.';
    end if;
    if currency_code <> 'PHP' or request_row."providerCurrency" <> currency_code then
      raise exception 'The Xendit split currency does not match PHP checkout.';
    end if;
    if p_split_amount <> round(p_split_amount, 2)
       or request_row."commissionAmount" is distinct from p_split_amount
       or request_row."commissionAmount" is distinct from round(request_row."paymentAmount" * 0.3000, 2) then
      raise exception 'The Xendit split amount is not the required 30%% commission.';
    end if;
    if request_row."providerSplitPaymentId" is not null
       and request_row."providerSplitPaymentId" <> split_payment_id
       and not (request_row."commissionStatus" = 'failed' and event_kind = 'split_completed') then
      raise exception 'A different Xendit split payment is already attached to this request.';
    end if;
    if request_row."commissionStatus" = 'completed' and event_kind = 'split_failed' then
      raise exception 'A completed commission cannot be changed to failed.';
    end if;
  else
    if checkout_id is null or reference_id is null then
      raise exception 'An expired payment session must include its session and reference IDs.';
    end if;
  end if;

  insert into private.xendit_service_webhook_events (
    event_id,
    event_type,
    event_kind,
    request_id,
    checkout_id,
    provider_payment_id,
    provider_split_payment_id,
    provider_status,
    payload
  ) values (
    normalized_event_id,
    event_type,
    event_kind,
    request_row.id,
    checkout_id,
    payment_id,
    split_payment_id,
    event_kind,
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
    became_verified := request_row.status <> 'payment_verified'
      and request_row."commissionStatus" = 'completed';

    update public.funeral_service_requests
    set status = case
          when "commissionStatus" = 'completed' then 'payment_verified'
          when "commissionStatus" = 'failed' then 'commission_failed'
          else 'paid_waiting_for_split'
        end,
        "providerPaymentId" = payment_id,
        "providerStatus" = case
          when "commissionStatus" = 'completed' then 'payment_verified'
          when "commissionStatus" = 'failed' then 'commission_failed'
          else 'paid_waiting_for_split'
        end,
        "providerEventId" = normalized_event_id,
        "providerPaymentCompletedAt" = coalesce("providerPaymentCompletedAt", now()),
        "paymentSubmittedAt" = coalesce("paymentSubmittedAt", now()),
        "paymentVerifiedAt" = case
          when "commissionStatus" = 'completed' then coalesce("paymentVerifiedAt", now())
          else null
        end,
        "updatedAt" = now()
    where id = request_row.id
    returning * into request_row;
  elsif event_kind = 'split_completed' then
    became_verified := request_row.status <> 'payment_verified'
      and request_row."providerPaymentCompletedAt" is not null;

    update public.funeral_service_requests
    set status = case
          when "providerPaymentCompletedAt" is not null then 'payment_verified'
          else status
        end,
        "commissionStatus" = 'completed',
        "providerSplitPaymentId" = split_payment_id,
        "providerSplitCompletedAt" = coalesce("providerSplitCompletedAt", now()),
        "providerStatus" = case
          when "providerPaymentCompletedAt" is not null then 'payment_verified'
          else 'split_completed_waiting_for_payment'
        end,
        "providerEventId" = normalized_event_id,
        "paymentVerifiedAt" = case
          when "providerPaymentCompletedAt" is not null then coalesce("paymentVerifiedAt", now())
          else null
        end,
        "updatedAt" = now()
    where id = request_row.id
    returning * into request_row;
  elsif event_kind = 'split_failed' then
    update public.funeral_service_requests
    set status = 'commission_failed',
        "commissionStatus" = 'failed',
        "providerSplitPaymentId" = split_payment_id,
        "providerSplitCompletedAt" = null,
        "providerStatus" = 'commission_failed',
        "providerEventId" = normalized_event_id,
        "paymentVerifiedAt" = null,
        "updatedAt" = now()
    where id = request_row.id
    returning * into request_row;
  else
    if request_row."providerPaymentCompletedAt" is null
       and request_row."commissionStatus" <> 'completed' then
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
    insert into public.notifications ("userId", type, title, body, data, read)
    values
      (
        request_row."shopId",
        'funeral_payment_verified',
        'Customer Payment Confirmed',
        'Xendit confirmed the casket payment and LifeCycle commission.',
        jsonb_build_object('requestId', request_row.id, 'provider', 'xendit'),
        false
      ),
      (
        request_row."requesterId",
        'funeral_payment_verified',
        'Payment Confirmed',
        'Your casket payment was confirmed.',
        jsonb_build_object('requestId', request_row.id, 'provider', 'xendit'),
        false
      );
  end if;

  return jsonb_build_object(
    'requestId', request_row.id,
    'status', request_row.status,
    'providerStatus', request_row."providerStatus",
    'commissionStatus', request_row."commissionStatus",
    'duplicate', false
  );
end;
$$;

revoke all on function public.protect_xendit_shop_account_fields() from public, anon, authenticated;
revoke all on function public.protect_xendit_service_payment_fields() from public, anon, authenticated;

revoke all on function public.claim_xendit_shop_provisioning(uuid) from public, anon, authenticated;
grant execute on function public.claim_xendit_shop_provisioning(uuid) to service_role;

revoke all on function public.finish_xendit_shop_provisioning(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.finish_xendit_shop_provisioning(uuid, uuid, text, text) to service_role;

revoke all on function public.claim_xendit_service_checkout(uuid, text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_xendit_service_checkout(uuid, text, text, text, text, text, boolean)
  to service_role;

revoke all on function public.store_xendit_service_checkout(uuid, uuid, text, text, text, text, numeric, text, boolean)
  from public, anon, authenticated;
grant execute on function public.store_xendit_service_checkout(uuid, uuid, text, text, text, text, numeric, text, boolean)
  to service_role;

revoke all on function public.reconcile_xendit_service_event(
  text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.reconcile_xendit_service_event(
  text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, jsonb
) to service_role;

comment on column public.funeral_shops."xenditAccountId" is
  'Xendit xenPlatform test sub-account ID. Unique and writable only through service-role provisioning RPCs.';
comment on column public.funeral_shops."xenditProvisioningStatus" is
  'not_started | pending | provisioned | failed';
comment on column public.funeral_service_requests."commissionRate" is
  'Immutable commission-rate snapshot set to 0.3000 when an Xendit checkout is claimed.';
comment on column public.funeral_service_requests."commissionAmount" is
  'Expected LifeCycle commission in PHP major units, rounded to two decimal places.';
comment on column public.funeral_service_requests."shopNetAmount" is
  'Gross amount less the 30% commission, before Xendit deducts provider transaction fees.';
comment on column public.funeral_service_requests."commissionStatus" is
  'Xendit commission route state: pending | completed | failed. Null for legacy manual/PayMongo records.';
comment on column public.funeral_service_requests."providerSplitPaymentId" is
  'Xendit split-payment identifier confirmed by a verified webhook.';
comment on table private.xendit_service_webhook_events is
  'Private, service-role-only Xendit webhook idempotency and audit records.';
comment on function public.claim_xendit_service_checkout(uuid, text, text, text, text, text, boolean) is
  'Atomically snapshots the accepted quote or saved casket product price and acquires a short Xendit checkout creation lease.';
comment on function public.reconcile_xendit_service_event(
  text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, jsonb
) is
  'Idempotently reconciles verified Xendit webhook data. payment_verified requires both the full PHP payment and the exact 30% split to the snapshotted master business.';

comment on column public.funeral_service_requests.status is
  'pending_shop_acceptance | accepted_by_shop (legacy transitional) | awaiting_payment | payment_submitted | paid_waiting_for_split | commission_failed | payment_verified | awaiting_customer_confirmation | completed | declined_by_shop | cancelled_by_requester';

notify pgrst, 'reload schema';

commit;
