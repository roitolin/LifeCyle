-- Keep edited payout details pending until the shop owner proves access to
-- the account email. The active receiver remains unchanged until confirmation.
create table if not exists public.payout_account_change_challenges (
  id uuid primary key default gen_random_uuid(),
  "shopId" uuid not null references public.funeral_shops(id) on delete cascade,
  "channelCode" text not null,
  "accountName" text not null,
  "accountNumber" text not null,
  status text not null default 'pending',
  "failedAttempts" smallint not null default 0,
  "expiresAt" timestamptz not null,
  "lastSentAt" timestamptz not null default now(),
  "createdAt" timestamptz not null default now(),
  "consumedAt" timestamptz,
  constraint payout_account_change_channel_check check (
    "channelCode" = any (array[
      'PH_GCASH', 'PH_MAYA', 'PH_BDO', 'PH_BPI', 'PH_UBP', 'PH_METROBANK',
      'PH_LANDBANK', 'PH_PNB', 'PH_RCBC', 'PH_CHINABANK',
      'PH_SECURITYBANK', 'PH_EASTWESTBANK'
    ])
  ),
  constraint payout_account_change_name_check
    check (char_length(btrim("accountName")) between 2 and 120),
  constraint payout_account_change_number_check
    check (char_length(btrim("accountNumber")) between 4 and 30),
  constraint payout_account_change_status_check
    check (status = any (array['pending', 'consumed', 'cancelled', 'expired'])),
  constraint payout_account_change_attempts_check
    check ("failedAttempts" between 0 and 5),
  constraint payout_account_change_expiry_check
    check ("expiresAt" > "createdAt")
);

create unique index if not exists payout_account_change_pending_shop_channel_idx
  on public.payout_account_change_challenges ("shopId", "channelCode")
  where status = 'pending';

create index if not exists payout_account_change_expiry_idx
  on public.payout_account_change_challenges ("expiresAt")
  where status = 'pending';

comment on table public.payout_account_change_challenges is
  'Server-only pending payout receiver edits awaiting email OTP confirmation.';

alter table public.payout_account_change_challenges enable row level security;
revoke all on table public.payout_account_change_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.payout_account_change_challenges to service_role;

create or replace function public.apply_payout_account_change(
  p_challenge_id uuid,
  p_shop_id uuid
)
returns table (
  "shopId" uuid,
  "payoutChannelCode" text,
  "payoutAccountName" text,
  "payoutVerified" boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  challenge public.payout_account_change_challenges%rowtype;
  changed_at timestamptz := now();
  affected_rows integer;
begin
  select pending.*
    into challenge
    from public.payout_account_change_challenges as pending
   where pending.id = p_challenge_id
     and pending."shopId" = p_shop_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'payout_change_not_found';
  end if;
  if challenge.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'payout_change_not_pending';
  end if;
  if challenge."expiresAt" <= changed_at then
    raise exception using errcode = 'P0001', message = 'payout_change_expired';
  end if;
  if challenge."failedAttempts" >= 5 then
    raise exception using errcode = 'P0001', message = 'payout_change_attempts_exceeded';
  end if;

  update public.funeral_shop_payout_accounts
     set "accountName" = challenge."accountName",
         "accountNumber" = challenge."accountNumber",
         active = true,
         "verifiedByAdmin" = true,
         "verifiedAt" = changed_at,
         "updatedAt" = changed_at
   where "shopId" = challenge."shopId"
     and "channelCode" = challenge."channelCode";

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using errcode = 'P0002', message = 'payout_account_not_found';
  end if;

  update public.funeral_shops
     set "payoutChannelCode" = challenge."channelCode",
         "payoutAccountName" = challenge."accountName",
         "payoutAccountNumber" = challenge."accountNumber",
         "payoutVerifiedByAdmin" = true,
         "payoutVerifiedAt" = changed_at,
         "xenditProvisioningStatus" = 'provisioned',
         "xenditProvisioningError" = null,
         "xenditProvisioningUpdatedAt" = changed_at
   where id = challenge."shopId";

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using errcode = 'P0002', message = 'funeral_shop_not_found';
  end if;

  update public.payout_account_change_challenges
     set status = 'consumed',
         "consumedAt" = changed_at
   where id = challenge.id;

  return query
  select challenge."shopId", challenge."channelCode", challenge."accountName", true;
end;
$$;

revoke all on function public.apply_payout_account_change(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_payout_account_change(uuid, uuid) to service_role;
