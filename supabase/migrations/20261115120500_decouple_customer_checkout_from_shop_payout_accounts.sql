-- Customer payments (full payment, downpayment, and remaining balance) are
-- collected by the platform/admin Xendit checkout. Funeral shops do not need
-- "Payout Accounts" configured for customer checkout; shops only configure a
-- verified bank account in Shop Withdrawals when withdrawing their 70% share.
begin;

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
    case when request_row."requestType" = 'catalog_product'
            and request_row."paymentOption" = 'downpayment'
      then nullif(round(request_row."downpaymentAmountSnapshot", 2), 0)
    end,
    authoritative_amount,
    nullif(round(request_row."paymentAmount", 2), 0),
    nullif(round(request_row."productPrice", 2), 0)
  );
  if authoritative_amount is null or authoritative_amount <= 0 then
    raise exception 'The selected casket does not have a valid saved product or accepted quote price.';
  end if;

  commission_amount := round(authoritative_amount * 0.3000, 2);
  shop_net_amount := round(authoritative_amount - commission_amount, 2);
  if commission_amount <= 0 or shop_net_amount < 0 then
    raise exception 'The calculated Xendit commission is invalid.';
  end if;

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
        'amount', coalesce(request_row."paymentAmount", authoritative_amount),
        'currency', request_row."providerCurrency",
        'commissionRate', coalesce(request_row."commissionRate", 0.3000),
        'commissionAmount', coalesce(request_row."commissionAmount", commission_amount),
        'shopNetAmount', coalesce(request_row."shopNetAmount", shop_net_amount),
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
      set "paymentAmount" = authoritative_amount,
          "commissionRate" = 0.3000,
          "commissionAmount" = commission_amount,
          "shopNetAmount" = shop_net_amount,
          "payoutAmount" = shop_net_amount,
          "providerIdempotencyKey" = idempotency_key,
          "providerCheckoutClaimId" = claim_id,
          "providerCheckoutClaimedAt" = now(),
          "providerStatus" = 'checkout_claimed',
          "updatedAt" = now()
      where id = request_row.id
      returning * into request_row;
    end if;
  else
    if coalesce(request_row."paymentProvider", '') not in ('manual', '', 'paymongo', 'xendit') then
      raise exception 'This request already belongs to another unsupported payment provider.';
    end if;
    if request_row.status <> 'awaiting_payment' then
      raise exception 'The service request is not awaiting customer payment.';
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
        "payoutChannelCode" = null,
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

create or replace function public.claim_xendit_balance_checkout(
  p_request_id uuid,
  p_user_id uuid,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_row public.funeral_service_requests%rowtype;
  payment_row public.funeral_balance_payments%rowtype;
  receiver_row public.funeral_shop_payout_accounts%rowtype;
  normalized_method text := coalesce(
    nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(p_payment_method, ''))), ''),
    'ANY'
  );
  primary_channel text;
  reference_id uuid;
  claim_id uuid;
begin
  if pg_catalog.current_setting('role', true) <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Payment service authorization is required.';
  end if;

  select * into request_row
  from public.funeral_service_requests
  where id = p_request_id
  for update;

  if not found or request_row."requesterId" is distinct from p_user_id then
    raise exception 'This service request is not available to this customer.';
  end if;
  if request_row."paymentOption" is distinct from 'downpayment'
     or request_row."paymentVerifiedAt" is null
     or request_row.status not in ('payment_verified', 'awaiting_customer_confirmation', 'completed')
     or coalesce(request_row."remainingBalance", 0) <= 0 then
    raise exception 'A confirmed downpayment with an outstanding balance is required.';
  end if;

  select pg_catalog.upper(pg_catalog.btrim(coalesce(shop."payoutChannelCode", '')))
    into primary_channel
  from public.funeral_shops shop
  where shop.id = request_row."shopId";

  select * into receiver_row
  from public.funeral_shop_payout_accounts
  where "shopId" = request_row."shopId"
    and active
    and "verifiedByAdmin"
  order by ("channelCode" = primary_channel) desc nulls last,
    "verifiedAt" asc nulls last, "createdAt" asc, id
  limit 1
  for share;

  select * into payment_row
  from public.funeral_balance_payments
  where request_id = p_request_id and status <> 'rejected'
  order by submitted_at desc
  limit 1
  for update;

  if found then
    if payment_row.provider_reference_id is null then
      raise exception 'A cash or manual balance payment is already awaiting review.';
    end if;
    if payment_row.status = 'verified' then
      return pg_catalog.jsonb_build_object(
        'paymentId', payment_row.id,
        'requestId', payment_row.request_id,
        'paid', true,
        'status', payment_row.status,
        'providerStatus', payment_row.provider_status
      );
    end if;
    if coalesce(payment_row.provider_payment_method, payment_row.receiver_channel) is distinct from normalized_method then
      raise exception 'This checkout is already locked to another payment method.';
    end if;
    if payment_row.provider_status = 'creating'
       and payment_row.provider_checkout_id is null
       and payment_row.checkout_claimed_at < pg_catalog.clock_timestamp() - interval '2 minutes' then
      claim_id := gen_random_uuid();
      perform pg_catalog.set_config('lifecycle.balance_provider_write', 'on', true);
      update public.funeral_balance_payments
      set checkout_claim_id = claim_id,
          checkout_claimed_at = pg_catalog.clock_timestamp(),
          provider_updated_at = pg_catalog.clock_timestamp()
      where id = payment_row.id
      returning * into payment_row;
      perform pg_catalog.set_config('lifecycle.balance_provider_write', 'off', true);
    end if;
    return pg_catalog.jsonb_build_object(
      'paymentId', payment_row.id,
      'requestId', payment_row.request_id,
      'amount', payment_row.amount,
      'referenceId', payment_row.provider_reference_id,
      'checkoutClaimId', payment_row.checkout_claim_id,
      'idempotencyKey', 'lifecycle-balance-' || payment_row.provider_reference_id::text,
      'checkoutId', payment_row.provider_checkout_id,
      'checkoutUrl', payment_row.provider_checkout_url,
      'providerStatus', payment_row.provider_status,
      'shouldCreate', payment_row.provider_checkout_id is null,
      'inProgress', payment_row.provider_checkout_id is null
        and payment_row.checkout_claimed_at >= pg_catalog.clock_timestamp() - interval '2 minutes'
        and payment_row.checkout_claim_id is distinct from claim_id,
      'paid', false
    );
  end if;

  reference_id := gen_random_uuid();
  claim_id := gen_random_uuid();
  perform pg_catalog.set_config('lifecycle.balance_provider_write', 'on', true);
  insert into public.funeral_balance_payments (
    request_id, amount, method, status, receiver_account_id,
    receiver_channel, receiver_name, receiver_number, reference_number,
    submitted_by, provider_reference_id, provider_status,
    provider_payment_method, provider_livemode, checkout_claim_id,
    checkout_claimed_at, provider_updated_at
  ) values (
    p_request_id,
    pg_catalog.round(request_row."remainingBalance", 2),
    case when normalized_method in ('PH_GCASH', 'PH_MAYA', 'ANY') then 'wallet' else 'bank' end,
    'submitted',
    receiver_row.id,
    coalesce(receiver_row."channelCode", case when normalized_method = 'ANY' then 'PH_GCASH' else normalized_method end),
    coalesce(receiver_row."accountName", 'LifeCycle Platform'),
    coalesce(receiver_row."accountNumber", 'XENDIT'),
    'XEN-' || pg_catalog.upper(pg_catalog.left(reference_id::text, 8)),
    request_row."requesterId",
    reference_id,
    'creating',
    normalized_method,
    false,
    claim_id,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  ) returning * into payment_row;
  perform pg_catalog.set_config('lifecycle.balance_provider_write', 'off', true);

  return pg_catalog.jsonb_build_object(
    'paymentId', payment_row.id,
    'requestId', payment_row.request_id,
    'amount', payment_row.amount,
    'referenceId', payment_row.provider_reference_id,
    'checkoutClaimId', payment_row.checkout_claim_id,
    'idempotencyKey', 'lifecycle-balance-' || payment_row.provider_reference_id::text,
    'providerStatus', payment_row.provider_status,
    'shouldCreate', true,
    'inProgress', false,
    'paid', false
  );
end;
$function$;

revoke all on function public.claim_xendit_balance_checkout(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_xendit_balance_checkout(uuid, uuid, text) to service_role;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261115120500', 'decouple_customer_checkout_from_shop_payout_accounts')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;

