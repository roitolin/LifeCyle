-- ═══════════════════════════════════════════════════════
-- LifeCycle — SERVICE REQUEST SINGLE STATUS FLOW
-- Run this AFTER service_request_payment_qr.sql.
--
-- Replaces the two parallel tracks (status + paymentStatus)
-- with ONE linear status field:
--
--   pending_shop_acceptance  (buyer submits)
--   awaiting_payment         (shop accepts; saved QR + amount are copied)
--   payment_submitted        (buyer uploads proof)
--   payment_verified         (shop confirms payment)
--   completed                (shop fulfils / delivers)
--   declined_by_shop         (terminal)
--   cancelled_by_requester   (terminal, only before payment submission)
--
-- When the shop rejects a proof, the status loops back to
-- awaiting_payment and paymentRejectionReason tells the buyer why.
-- ═══════════════════════════════════════════════════════

-- ── 1. Migrate legacy 'confirmed' rows ─────────────────
update public.funeral_service_requests
set status = 'payment_verified'
where status = 'confirmed';

-- ── 2. Fold the old parallel paymentStatus into status ─
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'funeral_service_requests'
      and column_name = 'paymentStatus'
  ) then
    update public.funeral_service_requests
      set status = 'awaiting_payment'
      where status = 'accepted_by_shop'
        and "paymentStatus" = 'pending'
        and ("paymentQrUrl" is not null or "paymentAmount" is not null);

    update public.funeral_service_requests
      set status = 'payment_submitted'
      where status = 'accepted_by_shop'
        and "paymentStatus" = 'submitted';

    update public.funeral_service_requests
      set status = 'payment_verified'
      where "paymentStatus" = 'verified';
  end if;
end $$;

-- ── 3. New columns ─────────────────────────────────────
alter table public.funeral_service_requests
  add column if not exists "paymentRejectionReason" text,
  add column if not exists "completionProofImageUrl" text,
  add column if not exists "shopMarkedCompletedAt" timestamptz,
  add column if not exists "completionProofSeenAt" timestamptz,
  add column if not exists "completedAt" timestamptz;

comment on column public.funeral_service_requests."paymentRejectionReason" is
  'Why the shop rejected the buyer''s payment proof (shown to the buyer when the status loops back to awaiting_payment).';
comment on column public.funeral_service_requests."completionProofImageUrl" is
  'Photo proof attached by the shop when it marks the request as delivered (status = awaiting_customer_confirmation).';
comment on column public.funeral_service_requests."shopMarkedCompletedAt" is
  'When the shop attached its completion proof and marked the request as delivered.';
comment on column public.funeral_service_requests."completionProofSeenAt" is
  'When the requester first viewed the shop''s completion proof (status = awaiting_customer_confirmation). Null until the family has seen it.';
comment on column public.funeral_service_requests."completedAt" is
  'When the requester confirmed the request as done (status = completed).';

-- ── 4. Remove the old parallel paymentStatus column ────
-- Single source of truth is the status field.
alter table public.funeral_service_requests drop column if exists "paymentStatus";

-- ── 5. Document the new status flow ────────────────────
comment on column public.funeral_service_requests.status is
  '''pending_shop_acceptance'' | ''awaiting_payment'' | ''payment_submitted'' | ''payment_verified'' | ''awaiting_customer_confirmation'' | ''completed'' | ''declined_by_shop'' | ''cancelled_by_requester'' (accepted_by_shop is legacy transitional only)';

notify pgrst, 'reload schema';
