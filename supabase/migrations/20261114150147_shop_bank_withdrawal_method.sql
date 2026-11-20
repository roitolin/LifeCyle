-- Withdrawals use a shop-selected, verified bank account. This is independent
-- of the payment channel the customer used at checkout.
begin;

drop function if exists public.initiate_shop_payout(uuid, text);

create function public.initiate_shop_payout(
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
  if request_row.status <> 'payment_verified'
     and not (request_row.status = 'paid_waiting_for_split' and request_row."providerPaymentCompletedAt" is not null) then
    raise exception 'Payment must be verified before initiating a payout.';
  end if;

  if request_row."payoutId" is not null
     or request_row."payoutStatus" in ('pending', 'succeeded') then
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

  provider_payout_channel := case payout_account."channelCode"
    when 'PH_METROBANK' then 'PH_MET'
    when 'PH_LANDBANK' then 'PH_LBP'
    when 'PH_CHINABANK' then 'PH_CBC'
    when 'PH_SECURITYBANK' then 'PH_SEC'
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

revoke all on function public.initiate_shop_payout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.initiate_shop_payout(uuid, text, text) to service_role;

commit;
