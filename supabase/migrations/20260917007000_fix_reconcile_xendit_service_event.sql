-- =============================================================================
-- Migration: 20260917007000_fix_reconcile_xendit_service_event.sql
-- Description: Fix column name references in reconcile_xendit_service_event:
--   - funeral_shops."name" -> funeral_shops."shopName"
--   - request_row."adminCommissionAmount" -> request_row."commissionAmount"
--   - add optional p_payment_method and update providerPaymentMethod
-- =============================================================================

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
  payment_id text := nullif(trim(p_provider_payment_id), '');
  currency_code text := nullif(upper(trim(coalesce(p_currency, ''))), '');
  resolved_payment_method text;
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
  -- Accept payment_completed and payment_expired only
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
    became_verified := request_row.status <> 'payment_verified';
    resolved_payment_method := coalesce(
      nullif(trim(p_payment_method), ''),
      nullif(trim(p_payload->>'channelCode'), ''),
      nullif(trim(p_payload->>'paymentMethod'), ''),
      nullif(trim(p_payload->>'channel_code'), ''),
      request_row."providerPaymentMethod"
    );

    update public.funeral_service_requests
    set status = 'payment_verified',
        "providerPaymentId" = payment_id,
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
    select "shopName", "payoutChannelCode", "payoutAccountNumber"
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
        'adminCommission', request_row."commissionAmount",
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

revoke all on function public.reconcile_xendit_service_event(text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.reconcile_xendit_service_event(text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, jsonb, text) to service_role;
