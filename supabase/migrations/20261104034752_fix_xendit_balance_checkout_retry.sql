begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Failed provider requests previously left a submitted row in `creating` with
-- no checkout URL. That row blocked both retries and selecting another channel.
create or replace function public.release_xendit_balance_checkout(
  p_payment_id uuid,
  p_checkout_claim_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  released boolean := false;
  safe_reason text := pg_catalog.left(
    coalesce(nullif(pg_catalog.btrim(p_reason), ''), 'The test checkout could not be created.'),
    500
  );
begin
  if pg_catalog.current_setting('role', true) <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Payment service authorization is required.';
  end if;

  perform pg_catalog.set_config('lifecycle.balance_provider_write', 'on', true);
  update public.funeral_balance_payments
  set status = 'rejected',
      reviewed_by = null,
      reviewed_at = pg_catalog.clock_timestamp(),
      rejection_reason = safe_reason,
      provider_status = 'expired',
      provider_updated_at = pg_catalog.clock_timestamp()
  where id = p_payment_id
    and checkout_claim_id = p_checkout_claim_id
    and status = 'submitted'
    and provider_status = 'creating'
    and provider_checkout_id is null;
  released := found;
  perform pg_catalog.set_config('lifecycle.balance_provider_write', 'off', true);

  return released;
end;
$function$;

revoke all on function public.release_xendit_balance_checkout(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_xendit_balance_checkout(uuid, uuid, text)
  to service_role;

comment on function public.release_xendit_balance_checkout(uuid, uuid, text) is
  'Releases a server-owned remaining-balance claim only when Xendit did not create a checkout.';

-- Release only old claims that never obtained a provider checkout. Active or
-- completed sessions are intentionally untouched to prevent duplicate payment.
select pg_catalog.set_config('lifecycle.balance_provider_write', 'on', true);
update public.funeral_balance_payments
set status = 'rejected',
    reviewed_by = null,
    reviewed_at = pg_catalog.clock_timestamp(),
    rejection_reason = 'The previous test checkout could not be created. Please try again.',
    provider_status = 'expired',
    provider_updated_at = pg_catalog.clock_timestamp()
where status = 'submitted'
  and provider_status = 'creating'
  and provider_checkout_id is null
  and checkout_claimed_at < pg_catalog.clock_timestamp() - interval '2 minutes';
select pg_catalog.set_config('lifecycle.balance_provider_write', 'off', true);

-- Cards are a Xendit customer payment channel. Shop payouts still need a real
-- receiver, so send card proceeds to the first active verified bank account.
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
  payout_account public.funeral_shop_payout_accounts%rowtype;
  payout_ref text := nullif(trim(p_payout_reference_id), '');
  configured_channel text;
  provider_payout_channel text;
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
  if request_row."paymentProvider" <> 'xendit' then
    raise exception 'This request is not a Xendit payment.';
  end if;
  if request_row.status <> 'payment_verified' then
    raise exception 'Payment must be verified before initiating a payout.';
  end if;

  if request_row."payoutId" is not null then
    return jsonb_build_object(
      'requestId', request_row.id,
      'alreadyInitiated', true,
      'payoutId', request_row."payoutId",
      'payoutStatus', request_row."payoutStatus"
    );
  end if;

  configured_channel := nullif(trim(request_row."payoutChannelCode"), '');
  if configured_channel is null then
    configured_channel := case lower(coalesce(request_row."providerPaymentMethod", ''))
      when 'gcash' then 'PH_GCASH'
      when 'ph_gcash' then 'PH_GCASH'
      when 'paymaya' then 'PH_MAYA'
      when 'maya' then 'PH_MAYA'
      when 'ph_paymaya' then 'PH_MAYA'
      when 'ph_bdo' then 'PH_BDO'
      when 'ph_bpi' then 'PH_BPI'
      when 'ph_ubp' then 'PH_UBP'
      when 'ph_met' then 'PH_METROBANK'
      when 'ph_lbp' then 'PH_LANDBANK'
      when 'ph_pnb' then 'PH_PNB'
      when 'ph_rcbc' then 'PH_RCBC'
      when 'ph_cbc' then 'PH_CHINABANK'
      when 'ph_sec' then 'PH_SECURITYBANK'
      when 'ph_ewb' then 'PH_EASTWESTBANK'
      when 'bdo_online_banking' then 'PH_BDO'
      when 'bpi_direct_debit' then 'PH_BPI'
      when 'unionbank_online_banking' then 'PH_UBP'
      when 'rcbc_online_banking' then 'PH_RCBC'
      when 'chinabank_direct_debit' then 'PH_CHINABANK'
      else null
    end;
  end if;

  if configured_channel = 'PH_CARDS' then
    select * into payout_account
    from public.funeral_shop_payout_accounts account
    where account."shopId" = request_row."shopId"
      and account."channelCode" in (
        'PH_BDO', 'PH_BPI', 'PH_UBP', 'PH_METROBANK', 'PH_LANDBANK',
        'PH_PNB', 'PH_RCBC', 'PH_CHINABANK', 'PH_SECURITYBANK'
      )
      and account.active and account."verifiedByAdmin"
    order by account."verifiedAt" asc nulls last, account."createdAt" asc, account.id
    limit 1 for share;
  elsif configured_channel is not null then
    select * into payout_account
    from public.funeral_shop_payout_accounts account
    where account."shopId" = request_row."shopId"
      and account."channelCode" = configured_channel
      and account.active and account."verifiedByAdmin"
    for share;
  else
    select * into payout_account
    from public.funeral_shop_payout_accounts account
    where account."shopId" = request_row."shopId"
      and account.active and account."verifiedByAdmin"
    order by account."verifiedAt" asc nulls last, account."createdAt" asc
    limit 1 for share;
  end if;

  if not found then
    raise exception 'The selected customer payment method no longer has an active verified receiver account.';
  end if;

  provider_payout_channel := case payout_account."channelCode"
    when 'PH_MAYA' then 'PH_PAYMAYA'
    when 'PH_METROBANK' then 'PH_MET'
    when 'PH_LANDBANK' then 'PH_LBP'
    when 'PH_CHINABANK' then 'PH_CBC'
    when 'PH_SECURITYBANK' then 'PH_SEC'
    when 'PH_EASTWESTBANK' then 'PH_EWB'
    else payout_account."channelCode"
  end;

  update public.funeral_service_requests
  set "payoutStatus" = 'pending',
      "payoutAmount" = request_row."shopNetAmount",
      "payoutChannelCode" = provider_payout_channel,
      "payoutReferenceId" = payout_ref,
      "updatedAt" = now()
  where id = request_row.id
  returning * into request_row;

  return jsonb_build_object(
    'requestId', request_row.id,
    'alreadyInitiated', false,
    'payoutAmount', request_row."shopNetAmount",
    'payoutChannelCode', provider_payout_channel,
    'payoutAccountName', payout_account."accountName",
    'payoutAccountNumber', payout_account."accountNumber",
    'payoutReferenceId', payout_ref,
    'currency', 'PHP'
  );
end;
$$;

revoke all on function public.initiate_shop_payout(uuid, text) from public, anon, authenticated;
grant execute on function public.initiate_shop_payout(uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
