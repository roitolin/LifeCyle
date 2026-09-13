-- LifeCycle - SELECTED SERVICE PACKAGES
-- Run this once in the Supabase SQL editor before releasing the updated app.

alter table public.funeral_service_requests
  add column if not exists "packageItems" text[] not null default '{}'::text[];

comment on column public.funeral_service_requests."packageItems" is
  'Optional package items selected on the product page, such as Flowers and Candles.';

notify pgrst, 'reload schema';
