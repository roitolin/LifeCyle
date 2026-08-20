-- ═══════════════════════════════════════════════════════
-- LifeCycle — SHOP PAYMENTS (seller payment submissions)
-- Run this in the Supabase SQL editor.
--
-- When a verified shop pays the registration fee, the seller
-- fills in their payment details (full name, GCash number,
-- reference number), attaches a screenshot as proof of
-- payment, and the record is stored here for admin review.
-- ═══════════════════════════════════════════════════════

create table if not exists public.shop_payments (
  id uuid primary key default gen_random_uuid(),
  "shopId" uuid not null references public.users(id) on delete cascade,
  "payerName" text not null default '',
  "gcashName" text,
  "gcashNumber" text not null default '',
  "referenceNumber" text not null default '',
  amount numeric not null default 0,
  "proofImageUrl" text not null default '',
  status text not null default 'pending',
  "rejectionReason" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- Add the proof screenshot column to installs that ran the earlier version
alter table public.shop_payments add column if not exists "proofImageUrl" text not null default '';
alter table public.shop_payments add column if not exists "gcashName" text;
alter table public.shop_payments add column if not exists "rejectionReason" text;
alter table public.shop_payments add column if not exists "updatedAt" timestamptz not null default now();

-- Subscription columns: when a payment was verified and when its 1-month
-- live access runs out (set by the admin when verifying the payment).
alter table public.shop_payments add column if not exists "verifiedAt" timestamptz;
alter table public.shop_payments add column if not exists "expiresAt" timestamptz;

alter table public.shop_payments enable row level security;

-- Sellers can submit (insert) a payment for their own shop
drop policy if exists "Sellers can insert their own payments" on public.shop_payments;
create policy "Sellers can insert their own payments"
  on public.shop_payments
  for insert
  to authenticated
  with check (auth.uid() = "shopId");

-- Sellers can read their own payment submissions
drop policy if exists "Sellers can read their own payments" on public.shop_payments;
create policy "Sellers can read their own payments"
  on public.shop_payments
  for select
  to authenticated
  using (auth.uid() = "shopId");

-- Admins can read all payment submissions
drop policy if exists "Admins can read payments" on public.shop_payments;
create policy "Admins can read payments"
  on public.shop_payments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  );

-- Admins can verify (approve/reject) payment submissions
drop policy if exists "Admins can update payments" on public.shop_payments;
create policy "Admins can update payments"
  on public.shop_payments
  for update
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  );
