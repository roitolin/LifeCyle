-- Allow the server-only payout confirmation RPC to update the legacy readiness
-- fields without being rewritten by the owner-facing payout protection trigger.
-- The setting is transaction-local and is never exposed to client sessions.
create or replace function public.protect_shop_payout_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  is_admin boolean := false;
begin
  if current_setting('app.payout_change_apply', true) = 'true'
     or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('admin', 'super_admin', 'funeral_admin')
  ) into is_admin;

  if tg_op = 'UPDATE' then
    if not is_admin then
      if coalesce(new."payoutVerifiedByAdmin", false) = true
         and coalesce(old."payoutVerifiedByAdmin", false) is distinct from true then
        raise exception 'Only an administrator can verify payout account details.';
      end if;

      if new."payoutVerifiedAt" is not null
         and old."payoutVerifiedAt" is distinct from new."payoutVerifiedAt" then
        raise exception 'Only an administrator can set payout verification timestamp.';
      end if;

      if old."payoutChannelCode" is distinct from new."payoutChannelCode"
         or old."payoutAccountName" is distinct from new."payoutAccountName"
         or old."payoutAccountNumber" is distinct from new."payoutAccountNumber" then
        new."payoutVerifiedByAdmin" := false;
        new."payoutVerifiedAt" := null;
      end if;
    end if;
  elsif tg_op = 'INSERT' then
    if not is_admin then
      new."payoutVerifiedByAdmin" := false;
      new."payoutVerifiedAt" := null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_shop_payout_fields() from public, anon, authenticated;
grant execute on function public.protect_shop_payout_fields() to service_role;

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

  -- The receiver row can be absent for legacy shops even though the legacy
  -- funeral_shops payout fields are populated. Upsert keeps both storage paths
  -- consistent and makes a verified email change immediately usable.
  insert into public.funeral_shop_payout_accounts (
    "shopId", "channelCode", "accountName", "accountNumber", active,
    "verifiedByAdmin", "verifiedAt", "createdAt", "updatedAt"
  ) values (
    challenge."shopId", challenge."channelCode", challenge."accountName", challenge."accountNumber", true,
    true, changed_at, changed_at, changed_at
  )
  on conflict ("shopId", "channelCode") do update
    set "accountName" = excluded."accountName",
        "accountNumber" = excluded."accountNumber",
        active = true,
        "verifiedByAdmin" = true,
        "verifiedAt" = changed_at,
        "updatedAt" = changed_at;

  perform set_config('app.payout_change_apply', 'true', true);
  update public.funeral_shops
     set "payoutChannelCode" = challenge."channelCode",
         "payoutAccountName" = challenge."accountName",
         "payoutAccountNumber" = challenge."accountNumber",
         "payoutVerifiedByAdmin" = true,
         "payoutVerifiedAt" = changed_at
   where id = challenge."shopId";
  if not found then raise exception using errcode = 'P0002', message = 'funeral_shop_not_found'; end if;

  update public.payout_account_change_challenges
     set status = 'consumed', "consumedAt" = changed_at
   where id = challenge.id;

  return query select challenge."shopId", challenge."channelCode", challenge."accountName", true;
end;
$$;

revoke all on function public.apply_payout_account_change(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_payout_account_change(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
