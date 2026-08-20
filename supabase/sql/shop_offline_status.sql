-- ═══════════════════════════════════════════════════════
-- LifeCycle — SHOP OFFLINE STATUS
-- Run this in the Supabase SQL editor.
--
-- Adds the 'offline' shop status used when a seller clicks
-- "Go Offline". The 1-month subscription window keeps running
-- while the shop is offline, and the shop is hidden from
-- buyers because the public RLS only exposes status = 'live'.
--
-- Full shop status values:
--   'pending'   — registration submitted, under review.
--   'verified'  — approved, not yet live (no paidUntil yet).
--   'live'      — owner clicked Go Live; 1-month window running.
--   'offline'   — owner clicked Go Offline; window keeps running,
--                 shop hidden from buyers.
--   'rejected'  — registration denied by an admin.
-- ═══════════════════════════════════════════════════════

-- The status column is a plain text column, so no constraint
-- change is needed. Document the allowed values for clarity.
comment on column public.funeral_shops.status
  is '''pending'' | ''verified'' | ''live'' | ''offline'' | ''rejected''';
