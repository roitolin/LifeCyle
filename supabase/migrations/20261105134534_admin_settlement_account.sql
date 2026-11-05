-- One private platform settlement account, visible only to active admins.
-- Checkout still settles to the Xendit master balance. This record does not
-- configure a withdrawal destination at Xendit.
begin;

create or replace function public.current_user_can_manage_payment_settings()
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1 from public.users profile
    where profile.id = (select auth.uid())
      and profile.role in ('admin', 'super_admin')
      and coalesce(profile.disabled, false) = false
  );
$function$;
revoke all on function public.current_user_can_manage_payment_settings() from public, anon, authenticated;
grant execute on function public.current_user_can_manage_payment_settings() to authenticated;

create table public.admin_settlement_account (
  id smallint primary key default 1 check (id = 1),
  channel text not null check (channel in ('bank', 'ewallet')),
  provider_name text not null check (length(btrim(provider_name)) between 2 and 80),
  account_holder text not null check (length(btrim(account_holder)) between 2 and 120),
  account_number text not null check (length(btrim(account_number)) between 6 and 40),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
comment on table public.admin_settlement_account is
  'Admin-only record of the intended Xendit withdrawal account; does not configure Xendit routing.';
alter table public.admin_settlement_account enable row level security;
revoke all on public.admin_settlement_account from public, anon, authenticated;
grant select, insert, update on public.admin_settlement_account to authenticated;

create policy admin_settlement_select on public.admin_settlement_account
  for select to authenticated
  using ((select public.current_user_can_manage_payment_settings()));
create policy admin_settlement_insert on public.admin_settlement_account
  for insert to authenticated
  with check ((select public.current_user_can_manage_payment_settings()) and updated_by = (select auth.uid()));
create policy admin_settlement_update on public.admin_settlement_account
  for update to authenticated
  using ((select public.current_user_can_manage_payment_settings()))
  with check ((select public.current_user_can_manage_payment_settings()) and updated_by = (select auth.uid()));

notify pgrst, 'reload schema';
commit;
