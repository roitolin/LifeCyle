-- Confirming an owner's email proves control of the sign-in email, not
-- ownership of the payout destination. Test receivers await admin review.
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
begin
  select pending.* into challenge
    from public.payout_account_change_challenges as pending
   where pending.id = p_challenge_id
     and pending."shopId" = p_shop_id
   for update;
  if not found then raise exception using errcode = 'P0002', message = 'payout_change_not_found'; end if;
  if challenge.status <> 'pending' then raise exception using errcode = 'P0001', message = 'payout_change_not_pending'; end if;
  if challenge."expiresAt" <= changed_at then raise exception using errcode = 'P0001', message = 'payout_change_expired'; end if;
  if challenge."failedAttempts" >= 5 then raise exception using errcode = 'P0001', message = 'payout_change_attempts_exceeded'; end if;

  insert into public.funeral_shop_payout_accounts (
    "shopId", "channelCode", "accountName", "accountNumber", active,
    "verifiedByAdmin", "verifiedAt", "createdAt", "updatedAt"
  ) values (
    challenge."shopId", challenge."channelCode", challenge."accountName", challenge."accountNumber", false,
    false, null, changed_at, changed_at
  )
  on conflict ("shopId", "channelCode") do update
    set "accountName" = excluded."accountName",
        "accountNumber" = excluded."accountNumber",
        active = false,
        "verifiedByAdmin" = false,
        "verifiedAt" = null,
        "updatedAt" = changed_at;

  perform set_config('app.payout_change_apply', 'true', true);
  update public.funeral_shops
     set "payoutChannelCode" = challenge."channelCode",
         "payoutAccountName" = challenge."accountName",
         "payoutAccountNumber" = challenge."accountNumber",
         "payoutVerifiedByAdmin" = false,
         "payoutVerifiedAt" = null
   where id = challenge."shopId";
  if not found then raise exception using errcode = 'P0002', message = 'funeral_shop_not_found'; end if;

  update public.payout_account_change_challenges
     set status = 'consumed', "consumedAt" = changed_at
   where id = challenge.id;

  return query select challenge."shopId", challenge."channelCode", challenge."accountName", false;
end;
$$;

revoke all on function public.apply_payout_account_change(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_payout_account_change(uuid, uuid) to service_role;

create or replace function public.approve_test_payout_receiver(
  p_shop_id uuid,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  shop public.funeral_shops%rowtype;
  account public.funeral_shop_payout_accounts%rowtype;
  reviewed_at timestamptz := now();
begin
  select s.* into shop from public.funeral_shops as s
    where s.id = p_shop_id for update;
  if not found or shop.status not in ('verified', 'live', 'offline') then
    raise exception using errcode = 'P0001', message = 'shop_not_ready';
  end if;

  select a.* into account from public.funeral_shop_payout_accounts as a
    where a.id = p_account_id and a."shopId" = p_shop_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'receiver_not_found'; end if;
  if account."verifiedByAdmin" then
    raise exception using errcode = 'P0001', message = 'receiver_already_reviewed';
  end if;

  update public.funeral_shop_payout_accounts
     set active = true,
         "verifiedByAdmin" = true,
         "verifiedAt" = reviewed_at,
         "updatedAt" = reviewed_at
   where id = p_account_id;

  update public.funeral_shops
     set "payoutChannelCode" = account."channelCode",
         "payoutAccountName" = account."accountName",
         "payoutAccountNumber" = account."accountNumber",
         "payoutVerifiedByAdmin" = true,
         "payoutVerifiedAt" = reviewed_at
   where id = p_shop_id;

  return jsonb_build_object(
    'shopId', p_shop_id,
    'payoutChannelCode', account."channelCode",
    'payoutAccountName', account."accountName",
    'payoutVerified', true,
    'testMode', true
  );
end;
$$;

revoke all on function public.approve_test_payout_receiver(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_test_payout_receiver(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
