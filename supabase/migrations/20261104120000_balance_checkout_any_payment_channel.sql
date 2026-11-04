begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Customers choose among the shop's configured payment channels on Xendit's page.
-- `ANY` decouples the customer channel from the shop receiver: the balance is
-- recorded against the shop's primary payout account (funeral_shops), falling
-- back to its earliest active verified receiver. Specific channels are still
-- accepted for older clients.
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

  if normalized_method = 'ANY' then
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
  elsif normalized_method = 'PH_CARDS' then
    -- Card brands are customer checkout channels, not shop payout accounts.
    -- Route the collected balance to the shop's first active verified bank receiver.
    select * into receiver_row
    from public.funeral_shop_payout_accounts
    where "shopId" = request_row."shopId"
      and "channelCode" in (
        'PH_BDO', 'PH_BPI', 'PH_UBP', 'PH_METROBANK', 'PH_LANDBANK',
        'PH_PNB', 'PH_RCBC', 'PH_CHINABANK', 'PH_SECURITYBANK'
      )
      and active
      and "verifiedByAdmin"
    order by "verifiedAt" asc nulls last, "createdAt" asc, id
    limit 1
    for share;
  else
    select * into receiver_row
    from public.funeral_shop_payout_accounts
    where "shopId" = request_row."shopId"
      and "channelCode" = normalized_method
      and active
      and "verifiedByAdmin"
    order by "updatedAt" desc nulls last, id
    limit 1
    for share;
  end if;
  if not found then
    raise exception 'This shop has not configured an active payment receiver account yet.';
  end if;

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
    case when receiver_row."channelCode" in ('PH_GCASH', 'PH_MAYA') then 'wallet' else 'bank' end,
    'submitted',
    receiver_row.id,
    receiver_row."channelCode",
    receiver_row."accountName",
    receiver_row."accountNumber",
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

notify pgrst, 'reload schema';
commit;

