-- LifeCycle - ADD GCASH ACCOUNT NAME TO SERVICE REQUEST PAYMENTS
-- Run this once in the Supabase SQL editor before releasing the updated mobile app.

alter table public.funeral_service_requests
  add column if not exists "paymentGcashName" text;

comment on column public.funeral_service_requests."paymentGcashName" is
  'Name registered to the GCash account used for the payment.';

notify pgrst, 'reload schema';