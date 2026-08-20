-- ═══════════════════════════════════════════════════════
-- LifeCycle — ADD SHOP COVER IMAGE COLUMN
-- Run this in the Supabase SQL editor.
-- Adds a cover/banner image field to funeral_shops
-- (profile picture remains "shopImageUrl").
-- ═══════════════════════════════════════════════════════

alter table public.funeral_shops
  add column if not exists "coverImageUrl" text;

-- ───────────────────────────────────────────────────────
-- Refresh PostgREST schema cache
-- ───────────────────────────────────────────────────────
notify pgrst, 'reload schema';
