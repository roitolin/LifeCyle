-- ═══════════════════════════════════════════════════════
-- LifeCycle — PAYMENT SUBSCRIPTION (1-month shop access)
-- Run this in the Supabase SQL editor.
--
-- The 1-month live window starts ONLY when the shop owner
-- clicks "Go Live", not when the admin verifies the payment.
-- This migration adds:
--   shop_payments."verifiedAt" / "expiresAt" — when a payment
--     was verified and when its paid access runs out
--     (informational only; does not start the live window).
--   funeral_shops."paidUntil" — the date the shop's current
--     paid period ends. Set when the owner goes live and
--     drives buyer visibility.
-- Buyer-facing RLS is updated so only LIVE shops with an
-- active paid period are visible to the public.
-- ═══════════════════════════════════════════════════════

-- Track when each payment was verified and when it expires
alter table public.shop_payments add column if not exists "verifiedAt" timestamptz;
alter table public.shop_payments add column if not exists "expiresAt" timestamptz;

-- When the shop's current paid period ends (set on Go Live)
alter table public.funeral_shops add column if not exists "paidUntil" timestamptz;

-- Backfill payments that are already verified. verifiedAt/expiresAt are
-- informational only — they do NOT start the shop's live window.
update public.shop_payments
set "verifiedAt" = coalesce("verifiedAt", now()),
    "expiresAt"  = coalesce("expiresAt", now() + interval '1 month')
where status = 'verified';

-- Shops that are already live get a fresh 1-month window from the migration
-- date so they keep working after this change. Owners who are verified but
-- not yet live are NOT given a window — it starts when they Go Live.
update public.funeral_shops
set "paidUntil" = now() + interval '1 month'
where status = 'live'
  and "paidUntil" is null;

-- Buyers can now only see shops that are LIVE and inside their
-- paid period. Approved-but-not-live shops stay hidden until the
-- owner activates (Go Live) their shop.
drop policy if exists "Anyone can view verified shops" on public.funeral_shops;
drop policy if exists "Authenticated users can view verified shops" on public.funeral_shops;
drop policy if exists "Allow anonymous users to read verified funeral shops" on public.funeral_shops;
create policy "Anyone can view live shops"
  on public.funeral_shops for select
  to anon, authenticated
  using (status = 'live' and "paidUntil" > now());
