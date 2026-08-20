-- ═══════════════════════════════════════════════════════
-- LifeCycle — PAYMENT QR CODE SETTING (admin-uploaded)
-- Run this in the Supabase SQL editor.
--
-- Admins upload a payment QR code photo that users scan to
-- pay the shop registration fee before registering.
--
-- Storage: images are stored in the existing public "avatars"
-- bucket (see avatars_bucket.sql) under the "payment-qr/" path,
-- so no new bucket is required.
-- ═══════════════════════════════════════════════════════

-- 1. Ensure the central settings table exists (idempotent)
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  "updatedAt" timestamptz not null default now()
);

alter table public.settings enable row level security;

-- 2. Read policy: any authenticated user can read settings
-- (needed by the shop registration page, which requires login)
drop policy if exists "Authenticated users can read settings" on public.settings;
create policy "Authenticated users can read settings"
  on public.settings
  for select
  to authenticated
  using (true);

-- 3. Write policies: admins can manage the "payment_qr_code" setting only.
--    This keeps the rest of the settings table (e.g. the "admin" key)
--    safe from tampering.
drop policy if exists "Admins can insert payment settings" on public.settings;
create policy "Admins can insert payment settings"
  on public.settings
  for insert
  to authenticated
  with check (
    key = 'payment_qr_code'
    and exists (
      select 1 from public.users u
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
    key = 'payment_qr_code'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  )
  with check (
    key = 'payment_qr_code'
    and exists (
      select 1 from public.users u
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
    key = 'payment_qr_code'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  );
