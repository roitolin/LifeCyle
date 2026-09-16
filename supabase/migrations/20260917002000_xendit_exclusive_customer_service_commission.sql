begin;

-- ==============================================================================
-- Migration: 20260917002000_xendit_exclusive_customer_service_commission.sql
-- Description: Enforce exclusive Xendit customer checkout for caskets/products
-- with automatic 30% admin commission and 70% shop payout routing.
-- ==============================================================================

-- Update claim_xendit_service_checkout to allow seamless migration from legacy
-- providers (paymongo / manual / null) to Xendit, and strictly compute the 30% / 70% split.
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

revoke all on function public.claim_xendit_service_checkout(uuid, text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_xendit_service_checkout(uuid, text, text, text, text, text, boolean)
  to service_role;

-- Update accept_funeral_service_request so catalog casket requests with productPrice
-- are ready for Xendit without blocking on legacy manual QR codes
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

  if coalesce(shop_amount, 0) <= 0 and coalesce(request_row."productPrice", 0) <= 0 then
    raise exception 'Configure the casket product price or shop default amount before accepting requests.';
  end if;

  return query
  update public.funeral_service_requests
  set
    status = 'awaiting_payment',
    "paymentProvider" = 'xendit',
    "paymentQrUrl" = coalesce(shop_qr, 'xendit://hosted'),
    "paymentAmount" = coalesce(nullif(request_row."productPrice", 0), shop_amount, 0),
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

commit;
