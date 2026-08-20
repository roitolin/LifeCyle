-- ═══════════════════════════════════════════════════════
-- LifeCycle — DECEASED DATE OF PASSING
-- Run this in the Supabase SQL editor.
--
-- Adds a "date of passing" column to funeral_service_requests
-- so requesters can specify when the deceased passed away.
-- ═══════════════════════════════════════════════════════

alter table public.funeral_service_requests
  add column if not exists "deceasedDateOfPassing" timestamptz;

comment on column public.funeral_service_requests."deceasedDateOfPassing" is
  'The date the deceased passed away, as provided by the requester.';

notify pgrst, 'reload schema';
