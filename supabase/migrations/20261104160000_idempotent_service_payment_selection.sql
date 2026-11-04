begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Reopening an existing checkout repeats the saved selection. Return its
-- current terms without attempting the update forbidden by the checkout lock.
create or replace function public.choose_funeral_request_payment_option(
  p_request_id uuid,
  p_payment_option text
)
returns setof public.funeral_service_requests
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  request_row public.funeral_service_requests%rowtype;
begin
  select * into request_row
  from public.funeral_service_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Service request not found.';
  end if;
  if request_row."requesterId" is distinct from (select auth.uid()) then
    raise exception 'Only the customer who created this request can choose its payment option.';
  end if;
  if request_row.status <> 'awaiting_payment' then
    raise exception 'The shop must approve this request before payment.';
  end if;
  if p_payment_option is null or p_payment_option not in ('full', 'downpayment') then
    raise exception 'Choose either full payment or down payment.';
  end if;
  if request_row."requestType" is distinct from 'catalog_product'
     and p_payment_option <> 'full' then
    raise exception 'Down payment is not available for this custom request.';
  end if;
  if request_row."providerCheckoutId" is not null
     or request_row."providerCheckoutClaimId" is not null then
    if request_row."paymentOption" = p_payment_option then
      return next request_row;
      return;
    end if;
    raise exception 'The payment option is locked because checkout has already started.';
  end if;

  perform set_config('lifecycle.payment_selection', 'on', true);
  return query
  update public.funeral_service_requests
  set "paymentOption" = p_payment_option,
      "updatedAt" = now()
  where id = p_request_id
  returning *;
end;
$$;

revoke all on function public.choose_funeral_request_payment_option(uuid, text)
  from public, anon, authenticated;
grant execute on function public.choose_funeral_request_payment_option(uuid, text)
  to authenticated;

comment on function public.choose_funeral_request_payment_option(uuid, text) is
  'Lets the requesting customer choose full or configured down payment, and safely repeat the saved choice after checkout starts.';

notify pgrst, 'reload schema';
commit;
