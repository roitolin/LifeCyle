-- LifeCycle - CHURCH AND CEMETERY DETAILS
-- Run this once in the Supabase SQL editor before releasing the updated app.

alter table public.funeral_service_requests
  add column if not exists "churchName" text,
  add column if not exists "cemeteryName" text;

comment on column public.funeral_service_requests."churchName" is
  'Church or chapel selected for the funeral service.';

comment on column public.funeral_service_requests."cemeteryName" is
  'Cemetery selected for the burial.';

notify pgrst, 'reload schema';
