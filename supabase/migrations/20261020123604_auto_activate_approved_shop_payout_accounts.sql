-- Treat payout verification columns as server-managed readiness flags. Approved
-- shops no longer wait for a separate administrator review after saving valid
-- receiver details through provision-xendit-shop.
begin;

create or replace function public.protect_shop_payout_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  is_admin boolean := false;
  jwt_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  -- Trusted Edge Function requests and direct migration/database sessions may
  -- manage the compatibility readiness fields. Browser/mobile clients may not.
  if jwt_role = 'service_role'
     or session_user in ('postgres', 'supabase_admin', 'cli_login_postgres') then
    return new;
  end if;

  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and role in ('admin', 'super_admin', 'funeral_admin')
      and not coalesce(disabled, false)
  ) into is_admin;

  if tg_op = 'UPDATE' then
    if not is_admin then
      if coalesce(new."payoutVerifiedByAdmin", false) = true
         and coalesce(old."payoutVerifiedByAdmin", false) is distinct from true then
        raise exception 'Payout readiness must be set through the trusted payout service.';
      end if;

      if new."payoutVerifiedAt" is not null
         and old."payoutVerifiedAt" is distinct from new."payoutVerifiedAt" then
        raise exception 'Payout readiness time must be set through the trusted payout service.';
      end if;

      if old."payoutChannelCode" is distinct from new."payoutChannelCode"
         or old."payoutAccountName" is distinct from new."payoutAccountName"
         or old."payoutAccountNumber" is distinct from new."payoutAccountNumber" then
        new."payoutVerifiedByAdmin" := false;
        new."payoutVerifiedAt" := null;
      end if;
    end if;
  elsif tg_op = 'INSERT' and not is_admin then
    new."payoutVerifiedByAdmin" := false;
    new."payoutVerifiedAt" := null;
  end if;

  return new;
end;
$$;

update public.funeral_shop_payout_accounts as account
set "verifiedByAdmin" = true,
    "verifiedAt" = coalesce(account."verifiedAt", now()),
    "updatedAt" = now()
from public.funeral_shops as shop
where shop.id = account."shopId"
  and lower(coalesce(shop.status, '')) in ('verified', 'live', 'offline')
  and account.active
  and nullif(trim(account."accountName"), '') is not null
  and nullif(trim(account."accountNumber"), '') is not null
  and account."verifiedByAdmin" is distinct from true;

with ready_accounts as (
  select distinct on (account."shopId")
    account."shopId",
    account."channelCode",
    account."accountName",
    account."accountNumber",
    account."verifiedAt"
  from public.funeral_shop_payout_accounts as account
  join public.funeral_shops as shop on shop.id = account."shopId"
  where lower(coalesce(shop.status, '')) in ('verified', 'live', 'offline')
    and account.active
    and account."verifiedByAdmin"
    and nullif(trim(account."accountName"), '') is not null
    and nullif(trim(account."accountNumber"), '') is not null
  order by account."shopId", account."updatedAt" desc, account."createdAt" desc
)
update public.funeral_shops as shop
set "payoutChannelCode" = ready."channelCode",
    "payoutAccountName" = ready."accountName",
    "payoutAccountNumber" = ready."accountNumber",
    "payoutVerifiedByAdmin" = true,
    "payoutVerifiedAt" = coalesce(ready."verifiedAt", now()),
    "updatedAt" = now()
from ready_accounts as ready
where shop.id = ready."shopId";

comment on table public.funeral_shop_payout_accounts is
  'Per-channel shop receiver accounts. Active server-validated rows enable the matching customer payment method for approved shops.';

comment on column public.funeral_shop_payout_accounts."verifiedByAdmin" is
  'Compatibility readiness flag managed by trusted server flows; it does not require a separate administrator review.';

comment on column public.funeral_shop_payout_accounts."verifiedAt" is
  'Time the receiver account became checkout-ready through a trusted server flow.';

comment on column public.funeral_shops."payoutVerifiedByAdmin" is
  'Compatibility readiness flag indicating the shop has at least one server-validated payout receiver.';

comment on column public.funeral_shops."payoutVerifiedAt" is
  'Time the shop payout summary became checkout-ready through a trusted server flow.';

commit;
