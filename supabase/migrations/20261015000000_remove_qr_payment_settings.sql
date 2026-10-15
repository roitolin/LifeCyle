-- Replace the legacy QR payment setting with a fee-only checkout setting.

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  "updatedAt" timestamptz not null default now()
);

alter table public.settings enable row level security;

insert into public.settings (key, value, "updatedAt")
select
  'shop_payment_settings',
  jsonb_build_object(
    'feeAmount',
    case
      when coalesce(value ->> 'feeAmount', '') ~ '^\d+(\.\d+)?$'
        then (value ->> 'feeAmount')::numeric
      else 0
    end
  ),
  now()
from public.settings
where key = 'payment_qr_code'
on conflict (key) do nothing;

delete from public.settings where key = 'payment_qr_code';

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
    and exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  );

drop policy if exists "Admins can update payment settings" on public.settings;
create policy "Admins can update payment settings"
  on public.settings
  for update
  to authenticated
  using (
    key = 'shop_payment_settings'
    and exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  )
  with check (
    key = 'shop_payment_settings'
    and exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  );

drop policy if exists "Admins can delete payment settings" on public.settings;
create policy "Admins can delete payment settings"
  on public.settings
  for delete
  to authenticated
  using (
    key = 'shop_payment_settings'
    and exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  );

notify pgrst, 'reload schema';
