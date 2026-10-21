-- The payout email verification RPC must only update payout receiver fields.
-- Legacy Xendit provisioning columns are protected by a separate trigger and
-- are not part of this flow.
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
  select pending.* into challenge
    from public.payout_account_change_challenges as pending
   where pending.id = p_challenge_id
     and pending."shopId" = p_shop_id
   for update;
  if not found then raise exception using errcode = 'P0002', message = 'payout_change_not_found'; end if;
  if challenge.status <> 'pending' then raise exception using errcode = 'P0001', message = 'payout_change_not_pending'; end if;
  if challenge."expiresAt" <= changed_at then raise exception using errcode = 'P0001', message = 'payout_change_expired'; end if;
  if challenge."failedAttempts" >= 5 then raise exception using errcode = 'P0001', message = 'payout_change_attempts_exceeded'; end if;

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
  if affected_rows <> 1 then raise exception using errcode = 'P0002', message = 'payout_account_not_found'; end if;

  update public.funeral_shops
     set "payoutChannelCode" = challenge."channelCode",
         "payoutAccountName" = challenge."accountName",
         "payoutAccountNumber" = challenge."accountNumber",
         "payoutVerifiedByAdmin" = true,
         "payoutVerifiedAt" = changed_at
   where id = challenge."shopId";
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then raise exception using errcode = 'P0002', message = 'funeral_shop_not_found'; end if;

  update public.payout_account_change_challenges
     set status = 'consumed', "consumedAt" = changed_at
   where id = challenge.id;

  return query select challenge."shopId", challenge."channelCode", challenge."accountName", true;
end;
$$;

revoke all on function public.apply_payout_account_change(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_payout_account_change(uuid, uuid) to service_role;
