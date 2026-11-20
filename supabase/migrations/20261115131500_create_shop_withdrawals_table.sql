-- Create shop_withdrawals table for custom-amount shop withdrawals and withdrawal history

create table if not exists public.shop_withdrawals (
  id uuid primary key default gen_random_uuid(),
  "shopId" uuid not null references public.funeral_shops(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  "channelCode" text not null,
  "accountName" text not null,
  "accountNumber" text not null,
  "referenceNo" text not null,
  "payoutReferenceId" text not null unique,
  "payoutId" text,
  status text not null default 'in_progress',
  "failureCode" text,
  "createdAt" timestamptz not null default now(),
  "completedAt" timestamptz,
  "updatedAt" timestamptz not null default now()
);

create index if not exists idx_shop_withdrawals_shop_created
  on public.shop_withdrawals ("shopId", "createdAt" desc);

alter table public.shop_withdrawals enable row level security;

drop policy if exists "Shop owners can view own withdrawals" on public.shop_withdrawals;
create policy "Shop owners can view own withdrawals"
  on public.shop_withdrawals
  for select
  to authenticated
  using ("shopId" = auth.uid());

-- Backfill any existing real payouts from funeral_service_requests into shop_withdrawals
insert into public.shop_withdrawals (
  "shopId",
  amount,
  "channelCode",
  "accountName",
  "accountNumber",
  "referenceNo",
  "payoutReferenceId",
  "payoutId",
  status,
  "failureCode",
  "createdAt",
  "completedAt",
  "updatedAt"
)
select
  r."shopId",
  coalesce(nullif(r."payoutAmount", 0), nullif(r."shopNetAmount", 0), round(coalesce(r."paymentAmount", 0) * 0.70, 2)),
  coalesce(r."payoutChannelCode", 'PH_BDO'),
  coalesce(s."payoutAccountName", 'Shop Account'),
  coalesce(s."payoutAccountNumber", '0000'),
  lpad((floor(extract(epoch from coalesce(r."payoutCompletedAt", r."updatedAt", r."createdAt", now())) * 1000)::bigint)::text, 19, '7'),
  coalesce(r."payoutReferenceId", 'legacy-payout-' || r.id::text),
  r."payoutId",
  case
    when lower(coalesce(r."payoutStatus", '')) = 'succeeded' then 'transferred'
    when lower(coalesce(r."payoutStatus", '')) in ('failed', 'cancelled', 'reversed') then 'failed'
    else 'in_progress'
  end,
  r."payoutFailureCode",
  coalesce(r."payoutCompletedAt", r."updatedAt", r."createdAt", now()),
  r."payoutCompletedAt",
  coalesce(r."updatedAt", now())
from public.funeral_service_requests r
left join public.funeral_shops s on s.id = r."shopId"
where r."payoutId" is not null
  and coalesce(nullif(r."payoutAmount", 0), nullif(r."shopNetAmount", 0), round(coalesce(r."paymentAmount", 0) * 0.70, 2)) > 0
on conflict ("payoutReferenceId") do nothing;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261115131500', 'create_shop_withdrawals_table')
on conflict (version) do nothing;

