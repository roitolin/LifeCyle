-- Restore secure admin writes for the shop registration fee setting.
--
-- The original browser upsert can take the INSERT path when the setting row is
-- missing. Checking public.users directly inside the settings policy is brittle
-- because users has its own RLS policies. Keep the role lookup behind a narrowly
-- scoped SECURITY DEFINER helper instead.

begin;

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  "updatedAt" timestamptz not null default now()
);

alter table public.settings enable row level security;

create or replace function public.current_user_can_manage_payment_settings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.users as profile
    where profile.id = (select auth.uid())
      and profile.role in ('super_admin', 'admin', 'funeral_admin')
      and coalesce(profile.disabled, false) = false
  );
$function$;

revoke all on function public.current_user_can_manage_payment_settings() from public, anon, authenticated;
grant execute on function public.current_user_can_manage_payment_settings() to authenticated;

drop policy if exists "Authenticated users can read settings" on public.settings;
create policy "Authenticated users can read settings"
  on public.settings
  for select
  to authenticated
  using (true);

drop policy if exists "Admins can insert payment settings" on public.settings;
create policy "Admins can insert payment settings"
  on public.settings
  for insert
  to authenticated
  with check (
    key = 'shop_payment_settings'
    and public.current_user_can_manage_payment_settings()
  );

drop policy if exists "Admins can update payment settings" on public.settings;
create policy "Admins can update payment settings"
  on public.settings
  for update
  to authenticated
  using (
    key = 'shop_payment_settings'
    and public.current_user_can_manage_payment_settings()
  )
  with check (
    key = 'shop_payment_settings'
    and public.current_user_can_manage_payment_settings()
  );

drop policy if exists "Admins can delete payment settings" on public.settings;
create policy "Admins can delete payment settings"
  on public.settings
  for delete
  to authenticated
  using (
    key = 'shop_payment_settings'
    and public.current_user_can_manage_payment_settings()
  );

insert into public.settings (key, value, "updatedAt")
values ('shop_payment_settings', jsonb_build_object('feeAmount', 0), now())
on conflict (key) do nothing;

notify pgrst, 'reload schema';

commit;
