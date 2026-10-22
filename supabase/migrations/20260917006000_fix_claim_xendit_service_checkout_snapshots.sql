-- =============================================================================
-- Migration: 20260917006000_fix_claim_xendit_service_checkout_snapshots.sql
-- Fix: Allow claim_xendit_service_checkout to initialize checkout snapshots
-- when a request was accepted by shop (setting paymentProvider = 'xendit' but
-- providerCurrency/providerLivemode/providerCheckoutClaimId are still NULL).
-- =============================================================================

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

  -- If this request already has an active Xendit checkout claim with initialized snapshots
  if request_row."paymentProvider" = 'xendit'
     and request_row."providerCheckoutClaimId" is not null
     and request_row."providerReferenceId" is not null
     and request_row."providerCurrency" is not null
     and request_row."providerLivemode" is not null then

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
    -- First time checkout claim initialization (or migration from manual/paymongo)
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

    authoritative_amount := coalesce(
      authoritative_amount,
      nullif(round(request_row."paymentAmount", 2), 0),
      nullif(round(request_row."productPrice", 2), 0)
    );
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

revoke all on function public.claim_xendit_service_checkout(uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_xendit_service_checkout(uuid, text, text, boolean)
  to service_role;
