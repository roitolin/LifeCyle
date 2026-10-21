-- Safely release a terminal Xendit Payment Session so the customer can create
-- a fresh hosted checkout. This remains idempotent when an expiry webhook or
-- active status sync has already processed the same session.
create or replace function public.reset_expired_xendit_service_checkout(
  p_request_id uuid,
  p_checkout_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_checkout_id text := nullif(trim(p_checkout_id), '');
  reset_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'This function is restricted to the Xendit payment service.';
  end if;

  if p_request_id is null
     or normalized_checkout_id is null
     or char_length(normalized_checkout_id) > 128 then
    raise exception 'A valid service request and checkout ID are required.';
  end if;

  update public.funeral_service_requests
  set status = 'awaiting_payment',
      "providerStatus" = 'expired',
      "providerCheckoutId" = null,
      "providerCheckoutUrl" = null,
      "providerCheckoutCreatedAt" = null,
      "providerCheckoutClaimId" = null,
      "providerCheckoutClaimedAt" = null,
      "updatedAt" = now()
  where id = p_request_id
    and "paymentProvider" = 'xendit'
    and status = 'awaiting_payment'
    and "providerPaymentCompletedAt" is null
    and "providerCheckoutId" = normalized_checkout_id;

  get diagnostics reset_count = row_count;

  if reset_count = 1 then
    return true;
  end if;

  -- A previous webhook/sync may already have cleared the same session.
  return exists (
    select 1
    from public.funeral_service_requests
    where id = p_request_id
      and "paymentProvider" = 'xendit'
      and status = 'awaiting_payment'
      and "providerPaymentCompletedAt" is null
      and "providerCheckoutId" is null
      and "providerCheckoutUrl" is null
  );
end;
$$;

revoke all on function public.reset_expired_xendit_service_checkout(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reset_expired_xendit_service_checkout(uuid, text)
  to service_role, postgres;
