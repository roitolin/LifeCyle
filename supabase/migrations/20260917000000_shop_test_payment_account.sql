begin;

create table if not exists public.shop_test_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null unique references public.funeral_shops(id) on delete cascade,
  account_label text not null,
  provider text not null default 'xendit' check (provider = 'xendit'),
  environment text not null default 'test' check (environment = 'test'),
  status text not null default 'registered' check (status = 'registered'),
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_test_payment_account_label_length
    check (char_length(trim(account_label)) between 3 and 80)
);

comment on table public.shop_test_payment_accounts is
  'Non-financial shop registration required before Xendit Test Mode checkout. This table never stores card, bank, GCash, OTP, PIN, or other payment credentials.';
comment on column public.shop_test_payment_accounts.account_label is
  'A display-only test profile label. It is not a GCash, bank, card, or Xendit customer account identifier.';

alter table public.shop_test_payment_accounts enable row level security;

revoke all on table public.shop_test_payment_accounts from public, anon, authenticated;
grant select on table public.shop_test_payment_accounts to authenticated;

drop policy if exists shop_test_payment_accounts_select_own
  on public.shop_test_payment_accounts;
create policy shop_test_payment_accounts_select_own
  on public.shop_test_payment_accounts
  for select
  to authenticated
  using (shop_id = auth.uid());

create or replace function public.register_shop_test_payment_account(
  p_account_label text,
  p_confirm_test_only boolean default false
)
returns public.shop_test_payment_accounts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_label text := trim(coalesce(p_account_label, ''));
  shop_status text;
  registered_account public.shop_test_payment_accounts%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if p_confirm_test_only is distinct from true then
    raise exception 'You must confirm that this account is for Xendit Test Mode only.';
  end if;
  if char_length(normalized_label) not between 3 and 80 then
    raise exception 'The test account name must be between 3 and 80 characters.';
  end if;

  select lower(coalesce(status, ''))
  into shop_status
  from public.funeral_shops
  where id = current_user_id;

  if not found or shop_status not in ('verified', 'live', 'offline') then
    raise exception 'Your funeral shop must be verified before registering a test payment account.';
  end if;

  insert into public.shop_test_payment_accounts (
    shop_id,
    account_label,
    provider,
    environment,
    status
  ) values (
    current_user_id,
    normalized_label,
    'xendit',
    'test',
    'registered'
  )
  on conflict (shop_id) do update
    set account_label = excluded.account_label,
        provider = 'xendit',
        environment = 'test',
        status = 'registered',
        updated_at = now()
  returning * into registered_account;

  return registered_account;
end;
$$;

revoke all on function public.register_shop_test_payment_account(text, boolean)
  from public, anon;
grant execute on function public.register_shop_test_payment_account(text, boolean)
  to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create or replace function private.notify_shop_test_payment_account_registered()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  registered_shop_name text;
begin
  select coalesce(nullif(trim("shopName"), ''), 'A funeral shop')
  into registered_shop_name
  from public.funeral_shops
  where id = new.shop_id;

  insert into public.notifications (
    "userId",
    type,
    title,
    body,
    data,
    read,
    dedupe_key
  )
  select
    administrator.id,
    'shop_payment_account_registered',
    'Test payment account registered',
    registered_shop_name || ' registered an Xendit Test payment account and can now start Test Mode payments.',
    jsonb_build_object(
      'shopId', new.shop_id,
      'paymentAccountId', new.id,
      'provider', new.provider,
      'environment', new.environment
    ),
    false,
    'shop-test-payment-account:' || new.shop_id::text
  from public.users administrator
  where lower(coalesce(administrator.role, '')) in ('admin', 'super_admin', 'funeral_admin')
    and coalesce(administrator.disabled, false) = false
  on conflict ("userId", dedupe_key) do nothing;

  return new;
end;
$$;

revoke all on function private.notify_shop_test_payment_account_registered()
  from public, anon, authenticated;

drop trigger if exists lifecycle_shop_test_payment_account_notification
  on public.shop_test_payment_accounts;
create trigger lifecycle_shop_test_payment_account_notification
after insert on public.shop_test_payment_accounts
for each row execute function private.notify_shop_test_payment_account_registered();

notify pgrst, 'reload schema';

commit;
