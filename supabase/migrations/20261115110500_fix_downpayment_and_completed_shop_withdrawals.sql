-- Ensure shop withdrawals include downpayments and orders that have progressed
-- to awaiting_customer_confirmation or completed, and ensure Xendit checkout
-- claims and session syncs always populate shopNetAmount and payoutAmount.
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

  if not exists (
    select 1
    from public.funeral_shop_payout_accounts account
    where account."shopId" = request_row."shopId"
      and account.active
      and account."verifiedByAdmin"
      and nullif(trim(account."accountName"), '') is not null
      and nullif(trim(account."accountNumber"), '') is not null
  ) then
    raise exception 'The assigned shop has no verified payment receiver account.';
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

drop function if exists public.reconcile_xendit_service_event(text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, jsonb);

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
  p_payload jsonb default '{}'::jsonb,
  p_payment_method text default null
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
  payment_id text := coalesce(nullif(trim(p_provider_payment_id), ''), nullif(trim(p_checkout_id), ''));
  currency_code text := nullif(upper(trim(coalesce(p_currency, ''))), '');
  resolved_payment_method text;
  effective_gross numeric(14,2);
  effective_commission numeric(14,2);
  effective_shop_net numeric(14,2);
  inserted_event_count integer := 0;
  became_verified boolean := false;
  shop_name text;
  shop_payout_channel text;
  shop_account_num text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'This function is restricted to the verified Xendit webhook service.';
  end if;
  if normalized_event_id is null or event_type is null
     or char_length(normalized_event_id) > 255 or char_length(event_type) > 255 then
    raise exception 'Valid Xendit event identifiers are required.';
  end if;
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
  where (
      request."paymentProvider" = 'xendit'
      or (reference_id is not null and request.id::text = reference_id)
    )
    and (
      (checkout_id is not null and request."providerCheckoutId" = checkout_id)
      or (reference_id is not null and (request."providerReferenceId" = reference_id or request.id::text = reference_id))
      or (payment_id is not null and request."providerPaymentId" = payment_id)
    )
  order by request."updatedAt" desc
  limit 1
  for update;

  if not found then
    raise exception 'No Xendit service request matches this event.';
  end if;
  if request_row.status not in (
    'awaiting_payment', 'payment_submitted', 'paid_waiting_for_split',
    'payment_verified', 'awaiting_customer_confirmation', 'completed'
  ) then
    raise exception 'This service request is not in a payable Xendit state.';
  end if;

  effective_gross := round(coalesce(
    nullif(p_gross_amount, 0),
    nullif(request_row."paymentAmount", 0),
    case when request_row."paymentOption" = 'downpayment'
      then nullif(request_row."downpaymentAmountSnapshot", 0)
      else coalesce(nullif(request_row."productFullPrice", 0), nullif(request_row."productPrice", 0))
    end,
    0
  ), 2);
  effective_commission := round(effective_gross * 0.3000, 2);
  effective_shop_net := greatest(0, round(effective_gross - effective_commission, 2));

  if event_kind = 'payment_completed' then
    if checkout_id is null and reference_id is null then
      raise exception 'A completed payment must include its session or reference ID.';
    end if;
    if currency_code is not null and currency_code <> 'PHP' then
      raise exception 'The Xendit payment currency does not match PHP checkout.';
    end if;
    if effective_gross <= 0 then
      raise exception 'The Xendit gross payment amount is invalid.';
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

    return jsonb_build_object(
      'requestId', request_row.id,
      'status', request_row.status,
      'providerStatus', request_row."providerStatus",
      'commissionStatus', request_row."commissionStatus",
      'shopNetAmount', coalesce(request_row."shopNetAmount", effective_shop_net),
      'duplicate', true
    );
  end if;

  if event_kind = 'payment_completed' then
    became_verified := request_row."paymentVerifiedAt" is null
      and request_row.status not in ('payment_verified', 'awaiting_customer_confirmation', 'completed');
    resolved_payment_method := coalesce(
      nullif(trim(p_payment_method), ''),
      nullif(trim(p_payload->>'channelCode'), ''),
      nullif(trim(p_payload->>'paymentMethod'), ''),
      nullif(trim(p_payload->>'channel_code'), ''),
      request_row."providerPaymentMethod"
    );

    update public.funeral_service_requests
    set status = case
          when status in ('awaiting_customer_confirmation', 'completed') then status
          else 'payment_verified'
        end,
        "paymentProvider" = 'xendit',
        "paymentAmount" = coalesce(nullif("paymentAmount", 0), effective_gross),
        "commissionRate" = coalesce("commissionRate", 0.3000),
        "commissionAmount" = coalesce(nullif("commissionAmount", 0), effective_commission),
        "shopNetAmount" = coalesce(nullif("shopNetAmount", 0), effective_shop_net),
        "payoutAmount" = coalesce(nullif("payoutAmount", 0), nullif("shopNetAmount", 0), effective_shop_net),
        "providerPaymentId" = coalesce(payment_id, "providerPaymentId"),
        "providerPaymentMethod" = resolved_payment_method,
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
    select "shopName", "payoutChannelCode", "payoutAccountNumber"
    into shop_name, shop_payout_channel, shop_account_num
    from public.funeral_shops
    where id = request_row."shopId";

    insert into public.notifications ("userId", type, title, body, data, read)
    values (
      request_row."shopId",
      'funeral_payment_verified',
      'Payment Received: ₱' || to_char(coalesce(request_row."shopNetAmount", 0), 'FM999,999,990.00'),
      'Customer paid ₱' || to_char(coalesce(request_row."paymentAmount", 0), 'FM999,999,990.00') || ' for order #' || left(request_row.id::text, 8) || '. Your 70% share of ₱' || to_char(coalesce(request_row."shopNetAmount", 0), 'FM999,999,990.00') || ' is ready for you to withdraw to your ' || coalesce(shop_payout_channel, 'payout account') || '.',
      jsonb_build_object(
        'requestId', request_row.id,
        'provider', 'xendit',
        'totalAmount', request_row."paymentAmount",
        'shopNetAmount', request_row."shopNetAmount",
        'adminCommission', request_row."commissionAmount",
        'payoutChannel', shop_payout_channel
      ),
      false
    );

    insert into public.notifications ("userId", type, title, body, data, read)
    select
      admin_user.id,
      'admin_payment_received',
      'Payment Received: ₱' || to_char(coalesce(request_row."paymentAmount", 0), 'FM999,999,990.00'),
      'Payment of ₱' || to_char(coalesce(request_row."paymentAmount", 0), 'FM999,999,990.00') || ' confirmed for ' || coalesce(shop_name, 'Shop') || ' (order #' || left(request_row.id::text, 8) || '). 30% admin commission: ₱' || to_char(coalesce(request_row."commissionAmount", 0), 'FM999,999,990.00') || '; Shop 70% payout: ₱' || to_char(coalesce(request_row."shopNetAmount", 0), 'FM999,999,990.00') || '.',
      jsonb_build_object(
        'requestId', request_row.id,
        'provider', 'xendit',
        'totalAmount', request_row."paymentAmount",
        'adminCommission', request_row."commissionAmount",
        'shopNetAmount', request_row."shopNetAmount",
        'shopId', request_row."shopId",
        'shopName', shop_name
      ),
      false
    from public.users admin_user
    where admin_user.role in ('admin', 'super_admin');

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

revoke all on function public.reconcile_xendit_service_event(text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.reconcile_xendit_service_event(text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, jsonb, text) to service_role, postgres;

drop function if exists public.initiate_shop_payout(uuid, text);

create or replace function public.initiate_shop_payout(
  p_request_id uuid,
  p_payout_reference_id text,
  p_payout_channel_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.funeral_service_requests%rowtype;
  payout_account public.funeral_shop_payout_accounts%rowtype;
  payout_ref text := nullif(trim(p_payout_reference_id), '');
  configured_channel text := upper(nullif(trim(p_payout_channel_code), ''));
  provider_payout_channel text;
  gross_paid numeric(14,2);
  resolved_payout_amount numeric(14,2);
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

  if not found then raise exception 'Service request not found.'; end if;
  if request_row.status not in ('payment_verified', 'awaiting_customer_confirmation', 'completed')
     and not (request_row.status = 'paid_waiting_for_split' and request_row."providerPaymentCompletedAt" is not null)
     and request_row."paymentVerifiedAt" is null
     and request_row."providerPaymentCompletedAt" is null then
    raise exception 'Payment must be verified before initiating a payout.';
  end if;

  if request_row."payoutId" is not null
     or request_row."payoutStatus" = 'succeeded' then
    return jsonb_build_object(
      'requestId', request_row.id,
      'alreadyInitiated', true,
      'payoutId', request_row."payoutId",
      'payoutStatus', request_row."payoutStatus"
    );
  end if;

  if configured_channel not in (
    'PH_BDO', 'PH_BPI', 'PH_UBP', 'PH_METROBANK', 'PH_LANDBANK',
    'PH_PNB', 'PH_RCBC', 'PH_CHINABANK', 'PH_SECURITYBANK'
  ) then
    raise exception 'A supported bank payout method is required.';
  end if;

  select * into payout_account
  from public.funeral_shop_payout_accounts account
  where account."shopId" = request_row."shopId"
    and account."channelCode" = configured_channel
    and account.active
    and account."verifiedByAdmin"
  for share;

  if not found then
    raise exception 'The selected bank receiver must be active and verified.';
  end if;

  gross_paid := round(coalesce(
    nullif(request_row."paymentAmount", 0),
    case when request_row."paymentOption" = 'downpayment'
      then nullif(request_row."downpaymentAmountSnapshot", 0)
      else coalesce(nullif(request_row."productFullPrice", 0), nullif(request_row."productPrice", 0))
    end,
    0
  ), 2);
  resolved_payout_amount := round(coalesce(
    nullif(request_row."shopNetAmount", 0),
    nullif(request_row."payoutAmount", 0),
    gross_paid - round(gross_paid * 0.3000, 2)
  ), 2);

  if resolved_payout_amount <= 0 then
    raise exception 'This sale has no withdrawable shop share.';
  end if;

  provider_payout_channel := case payout_account."channelCode"
    when 'PH_METROBANK' then 'PH_MET'
    when 'PH_LANDBANK' then 'PH_LBP'
    when 'PH_CHINABANK' then 'PH_CBC'
    when 'PH_SECURITYBANK' then 'PH_SEC'
    else payout_account."channelCode"
  end;

  update public.funeral_service_requests
  set "payoutStatus" = 'pending',
      "shopNetAmount" = coalesce(nullif("shopNetAmount", 0), resolved_payout_amount),
      "payoutAmount" = resolved_payout_amount,
      "payoutChannelCode" = provider_payout_channel,
      "payoutReferenceId" = payout_ref,
      "updatedAt" = now()
  where id = request_row.id
  returning * into request_row;

  return jsonb_build_object(
    'requestId', request_row.id,
    'alreadyInitiated', false,
    'payoutAmount', resolved_payout_amount,
    'payoutChannelCode', provider_payout_channel,
    'payoutAccountName', payout_account."accountName",
    'payoutAccountNumber', payout_account."accountNumber",
    'payoutReferenceId', payout_ref,
    'currency', 'PHP'
  );
end;
$$;

revoke all on function public.initiate_shop_payout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.initiate_shop_payout(uuid, text, text) to service_role;

-- Reset orphaned payout reservations that were marked 'pending' before manual shop
-- withdrawals without an actual Xendit payoutId so shop owners can withdraw them.
update public.funeral_service_requests
set "payoutStatus" = null,
    "payoutReferenceId" = null,
    "payoutChannelCode" = null
where "payoutStatus" = 'pending'
  and "payoutId" is null
  and "payoutCompletedAt" is null;

-- Backfill shopNetAmount and payoutAmount (70% of paid gross or downpayment) for
-- any paid Xendit orders where shopNetAmount was missing or zero.
update public.funeral_service_requests
set "shopNetAmount" = round(
      coalesce(
        nullif("paymentAmount", 0),
        case when "paymentOption" = 'downpayment'
          then nullif("downpaymentAmountSnapshot", 0)
          else coalesce(nullif("productFullPrice", 0), nullif("productPrice", 0))
        end,
        0
      ) * 0.7000,
      2
    ),
    "payoutAmount" = round(
      coalesce(
        nullif("paymentAmount", 0),
        case when "paymentOption" = 'downpayment'
          then nullif("downpaymentAmountSnapshot", 0)
          else coalesce(nullif("productFullPrice", 0), nullif("productPrice", 0))
        end,
        0
      ) * 0.7000,
      2
    ),
    "commissionAmount" = coalesce(
      nullif("commissionAmount", 0),
      round(
        coalesce(
          nullif("paymentAmount", 0),
          case when "paymentOption" = 'downpayment'
            then nullif("downpaymentAmountSnapshot", 0)
            else coalesce(nullif("productFullPrice", 0), nullif("productPrice", 0))
          end,
          0
        ) * 0.3000,
        2
      )
    )
where ("paymentProvider" = 'xendit' or "providerPaymentCompletedAt" is not null)
  and (
    status in ('payment_verified', 'awaiting_customer_confirmation', 'completed')
    or "paymentVerifiedAt" is not null
    or "providerPaymentCompletedAt" is not null
  )
  and (coalesce("shopNetAmount", 0) <= 0 or coalesce("payoutAmount", 0) <= 0);

insert into supabase_migrations.schema_migrations (version, name)
values
  ('20261114133248', 'manual_shop_withdrawals'),
  ('20261114150147', 'shop_bank_withdrawal_method'),
  ('20261115110500', 'fix_downpayment_and_completed_shop_withdrawals')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;

