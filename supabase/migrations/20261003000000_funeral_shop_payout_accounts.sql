-- Multiple shop receiver accounts and customer payment-method gating.
begin;

create table if not exists public.funeral_shop_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  "shopId" uuid not null references public.funeral_shops(id) on delete cascade,
  "channelCode" text not null,
  "accountName" text not null,
  "accountNumber" text not null,
  active boolean not null default true,
  "verifiedByAdmin" boolean not null default false,
  "verifiedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint funeral_shop_payout_accounts_channel_check check (
    "channelCode" in (
      'PH_GCASH', 'PH_MAYA', 'PH_BDO', 'PH_BPI', 'PH_UBP', 'PH_METROBANK',
      'PH_LANDBANK', 'PH_PNB', 'PH_RCBC', 'PH_CHINABANK',
      'PH_SECURITYBANK', 'PH_EASTWESTBANK'
    )
  ),
  constraint funeral_shop_payout_accounts_name_check
    check (char_length(trim("accountName")) between 2 and 120),
  constraint funeral_shop_payout_accounts_number_check
    check (char_length(trim("accountNumber")) between 4 and 30),
  constraint funeral_shop_payout_accounts_shop_channel_unique unique ("shopId", "channelCode")
);

create index if not exists funeral_shop_payout_accounts_shop_active_idx
  on public.funeral_shop_payout_accounts ("shopId", active, "verifiedByAdmin");

comment on table public.funeral_shop_payout_accounts is
  'Per-channel shop receiver accounts. Only active and administrator-verified rows enable the matching customer payment method.';

alter table public.funeral_shop_payout_accounts enable row level security;
revoke all on table public.funeral_shop_payout_accounts from public, anon, authenticated;
grant select on table public.funeral_shop_payout_accounts to authenticated;

drop policy if exists funeral_shop_payout_accounts_select_own on public.funeral_shop_payout_accounts;
create policy funeral_shop_payout_accounts_select_own
  on public.funeral_shop_payout_accounts for select to authenticated
  using ("shopId" = auth.uid());

insert into public.funeral_shop_payout_accounts (
  "shopId", "channelCode", "accountName", "accountNumber", active,
  "verifiedByAdmin", "verifiedAt", "createdAt", "updatedAt"
)
select
  id, "payoutChannelCode", "payoutAccountName", "payoutAccountNumber", true,
  coalesce("payoutVerifiedByAdmin", false), "payoutVerifiedAt", now(), now()
from public.funeral_shops
where nullif(trim("payoutChannelCode"), '') is not null
  and nullif(trim("payoutAccountName"), '') is not null
  and nullif(trim("payoutAccountNumber"), '') is not null
on conflict ("shopId", "channelCode") do nothing;
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

  -- Checkout is available only when this shop has at least one active, verified receiver account.
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
-- Select the exact receiver account chosen for checkout, then translate the
-- app's legacy channel identifiers to Xendit's current payout channel codes.
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

  if not found then
    raise exception 'Service request not found.';
  end if;
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
      when 'bdo_online_banking' then 'PH_BDO'
      when 'bpi_direct_debit' then 'PH_BPI'
      when 'unionbank_online_banking' then 'PH_UBP'
      when 'rcbc_online_banking' then 'PH_RCBC'
      when 'chinabank_direct_debit' then 'PH_CHINABANK'
      else null
    end;
  end if;

  if configured_channel is not null then
    select * into payout_account
    from public.funeral_shop_payout_accounts account
    where account."shopId" = request_row."shopId"
      and account."channelCode" = configured_channel
      and account.active
      and account."verifiedByAdmin"
    for share;
  else
    select * into payout_account
    from public.funeral_shop_payout_accounts account
    where account."shopId" = request_row."shopId"
      and account.active
      and account."verifiedByAdmin"
    order by account."verifiedAt" asc nulls last, account."createdAt" asc
    limit 1
    for share;
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

commit;
