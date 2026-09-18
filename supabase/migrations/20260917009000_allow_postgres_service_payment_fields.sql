-- =============================================================================
-- Migration: 20260917009000_allow_postgres_service_payment_fields.sql
-- Description: Allow postgres / supabase_admin in protect_xendit_service_payment_fields
-- =============================================================================

create or replace function public.protect_xendit_service_payment_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_is_service_role boolean := coalesce(auth.role(), '') = 'service_role' or current_user in ('postgres', 'supabase_admin');
begin
  if actor_is_service_role then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new."paymentProvider" = 'xendit'
       or new."providerIdempotencyKey" is not null
       or new."providerReferenceId" is not null
       or new."providerShopAccountId" is not null
       or new."providerSplitRuleId" is not null
       or new."providerSplitDestinationAccountId" is not null
       or new."providerCheckoutClaimId" is not null
       or new."providerCheckoutClaimedAt" is not null
       or new."providerPaymentCompletedAt" is not null
       or new."providerSplitCompletedAt" is not null
       or new."commissionRate" is not null
       or new."commissionAmount" is not null
       or new."shopNetAmount" is not null
       or new."commissionStatus" is not null
       or new."providerSplitPaymentId" is not null
       or new."providerCurrency" is not null
       or new."payoutId" is not null
       or new."payoutStatus" is not null
       or new."payoutAmount" is not null
       or new."payoutCompletedAt" is not null
       or new."payoutFailureCode" is not null
       or new."payoutChannelCode" is not null
       or new."payoutReferenceId" is not null then
      raise exception 'Xendit payment fields can be set only by the payment service.';
    end if;
    return new;
  end if;

  if old."providerIdempotencyKey" is distinct from new."providerIdempotencyKey"
     or old."providerReferenceId" is distinct from new."providerReferenceId"
     or old."providerShopAccountId" is distinct from new."providerShopAccountId"
     or old."providerSplitRuleId" is distinct from new."providerSplitRuleId"
     or old."providerSplitDestinationAccountId" is distinct from new."providerSplitDestinationAccountId"
     or old."providerCheckoutClaimId" is distinct from new."providerCheckoutClaimId"
     or old."providerCheckoutClaimedAt" is distinct from new."providerCheckoutClaimedAt"
     or old."providerPaymentCompletedAt" is distinct from new."providerPaymentCompletedAt"
     or old."providerSplitCompletedAt" is distinct from new."providerSplitCompletedAt"
     or old."commissionRate" is distinct from new."commissionRate"
     or old."commissionAmount" is distinct from new."commissionAmount"
     or old."shopNetAmount" is distinct from new."shopNetAmount"
     or old."commissionStatus" is distinct from new."commissionStatus"
     or old."providerSplitPaymentId" is distinct from new."providerSplitPaymentId"
     or old."providerCurrency" is distinct from new."providerCurrency"
     or old."payoutId" is distinct from new."payoutId"
     or old."payoutStatus" is distinct from new."payoutStatus"
     or old."payoutAmount" is distinct from new."payoutAmount"
     or old."payoutCompletedAt" is distinct from new."payoutCompletedAt"
     or old."payoutFailureCode" is distinct from new."payoutFailureCode"
     or old."payoutChannelCode" is distinct from new."payoutChannelCode"
     or old."payoutReferenceId" is distinct from new."payoutReferenceId" then
    raise exception 'Xendit payment fields can be changed only by the payment service.';
  end if;

  -- Allow the initial shop acceptance or response transition from pending_shop_acceptance
  if old.status = 'pending_shop_acceptance'
     and new.status in ('awaiting_payment', 'declined_by_shop', 'cancelled_by_requester') then
    if old."providerCheckoutId" is distinct from new."providerCheckoutId"
       or old."providerCheckoutUrl" is distinct from new."providerCheckoutUrl"
       or old."providerPaymentId" is distinct from new."providerPaymentId"
       or old."providerPaymentMethod" is distinct from new."providerPaymentMethod"
       or old."providerStatus" is distinct from new."providerStatus"
       or old."providerLivemode" is distinct from new."providerLivemode"
       or old."providerEventId" is distinct from new."providerEventId"
       or old."providerCheckoutCreatedAt" is distinct from new."providerCheckoutCreatedAt"
       or old."paymentSubmittedAt" is distinct from new."paymentSubmittedAt"
       or old."paymentVerifiedAt" is distinct from new."paymentVerifiedAt" then
      raise exception 'Xendit checkout fields can be changed only by the payment service.';
    end if;
    return new;
  end if;

  if old."paymentProvider" = 'xendit' or new."paymentProvider" = 'xendit' then
    if old."paymentProvider" is distinct from new."paymentProvider"
       or old."paymentAmount" is distinct from new."paymentAmount"
       or old."providerCheckoutId" is distinct from new."providerCheckoutId"
       or old."providerCheckoutUrl" is distinct from new."providerCheckoutUrl"
       or old."providerPaymentId" is distinct from new."providerPaymentId"
       or old."providerPaymentMethod" is distinct from new."providerPaymentMethod"
       or old."providerStatus" is distinct from new."providerStatus"
       or old."providerLivemode" is distinct from new."providerLivemode"
       or old."providerEventId" is distinct from new."providerEventId"
       or old."providerCheckoutCreatedAt" is distinct from new."providerCheckoutCreatedAt"
       or old."paymentSubmittedAt" is distinct from new."paymentSubmittedAt"
       or old."paymentVerifiedAt" is distinct from new."paymentVerifiedAt" then
      raise exception 'Xendit payment state can be changed only by the payment service.';
    end if;

    if old.status is distinct from new.status
       and not (
         (old.status = 'awaiting_payment' and new.status = 'cancelled_by_requester')
         or (old.status = 'payment_verified' and new.status = 'awaiting_customer_confirmation')
         or (old.status = 'awaiting_customer_confirmation' and new.status in ('completed', 'payment_verified'))
       ) then
      raise exception 'Only a verified Xendit webhook can change the payment state.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_xendit_service_payment_fields() from public, anon, authenticated;
