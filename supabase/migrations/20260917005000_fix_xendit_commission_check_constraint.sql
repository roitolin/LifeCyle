-- =============================================================================
-- Migration: 20260917005000_fix_xendit_commission_check_constraint.sql
-- Fix: Relax funeral_service_requests_xendit_commission_check to allow
-- orders in awaiting_payment state before customer initiates checkout
-- (when providerReferenceId and commissionStatus are not yet generated).
-- =============================================================================

alter table public.funeral_service_requests
  drop constraint if exists funeral_service_requests_xendit_commission_check;

alter table public.funeral_service_requests
  add constraint funeral_service_requests_xendit_commission_check
  check (
    "paymentProvider" is distinct from 'xendit'
    or (
      -- Pre-checkout / awaiting customer checkout initiation
      "providerReferenceId" is null
      and "commissionStatus" is null
    )
    or (
      -- Active or completed checkout: enforce 30% admin commission and 70% shop payout
      "providerCurrency" = 'PHP'
      and "providerReferenceId" is not null
      and "commissionRate" = 0.3000
      and "paymentAmount" > 0
      and "commissionAmount" = round("paymentAmount" * "commissionRate", 2)
      and "shopNetAmount" = round("paymentAmount" - "commissionAmount", 2)
      and "commissionStatus" in ('pending', 'completed', 'failed')
    )
  ) not valid;

notify pgrst, 'reload schema';
