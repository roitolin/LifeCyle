-- ═══════════════════════════════════════════════════════
-- LifeCycle — SERVICE REQUEST PAYMENT QR & AMOUNT
-- Run this in the Supabase SQL editor.
--
-- 1) Shops can set their own payment QR code + service fee
--    amount on funeral_shops (like admin sets the global
--    registration fee in Admin > Payments).
-- 2) When a shop accepts a request, the QR + amount are
--    snapshotted onto the service request so the requester
--    can see and pay them.
-- 3) Requesters can submit their payment details + proof
--    directly on the request row (no new table needed).
-- ═══════════════════════════════════════════════════════

-- ── Shop-side payment settings ─────────────────────────
alter table public.funeral_shops
  add column if not exists "paymentQrUrl" text,
  add column if not exists "serviceFeeAmount" numeric;

-- ── Request-side payment snapshot / status ─────────────
alter table public.funeral_service_requests
  add column if not exists "paymentQrUrl" text,
  add column if not exists "paymentAmount" numeric,
  add column if not exists "paymentPayerName" text,
  add column if not exists "paymentGcashName" text,
  add column if not exists "paymentGcashNumber" text,
  add column if not exists "paymentReferenceNumber" text,
  add column if not exists "paymentProofImageUrl" text,
  add column if not exists "paymentSubmittedAt" timestamptz,
  add column if not exists "paymentVerifiedAt" timestamptz,
  add column if not exists "paymentRejectionReason" text,
  add column if not exists "completedAt" timestamptz;

comment on column public.funeral_shops."paymentQrUrl" is
  'The shop''s payment QR code image (e.g. GCash) shown to requesters after the shop accepts their request.';
comment on column public.funeral_shops."serviceFeeAmount" is
  'The amount requesters must send to the shop after the shop accepts their request.';
comment on column public.funeral_service_requests.status is
  'Single payment and fulfilment state: pending_shop_acceptance | awaiting_payment | payment_submitted | payment_verified | completed | declined_by_shop | cancelled_by_requester';

notify pgrst, 'reload schema';
