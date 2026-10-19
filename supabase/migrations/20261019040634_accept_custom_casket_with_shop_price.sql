-- Accept custom-casket requests with a shop-authored price in one atomic action.
-- The optional parameter keeps catalog-product and existing mobile callers compatible.
drop function if exists public.accept_funeral_service_request(uuid);

create function public.accept_funeral_service_request(
  p_request_id uuid,
  p_custom_price numeric default null
)
returns setof public.funeral_service_requests
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.funeral_service_requests%rowtype;
  shop_qr text;
  shop_amount numeric;
  actor_is_admin boolean := false;
  is_custom_request boolean := false;
  computed_amount numeric;
begin
  select *
  into request_row
  from public.funeral_service_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Service request not found.';
  end if;

  select exists (
    select 1
    from public.users
    where id = (select auth.uid())
      and role in ('admin', 'super_admin', 'funeral_admin')
  ) into actor_is_admin;

  if (select auth.uid()) is distinct from request_row."shopId" and not actor_is_admin then
    raise exception 'Only the assigned shop can accept this request.';
  end if;

  if request_row.status <> 'pending_shop_acceptance' then
    raise exception 'This request has already been processed.';
  end if;

  is_custom_request := request_row."requestType" = 'custom_casket'
    or request_row."productId" = 'custom_casket_design';

  select nullif(trim("paymentQrUrl"), ''), "serviceFeeAmount"
  into shop_qr, shop_amount
  from public.funeral_shops
  where id = request_row."shopId";

  if is_custom_request then
    if p_custom_price is null or p_custom_price <= 0 then
      raise exception 'Enter the custom casket price before accepting this request.';
    end if;
    if p_custom_price > 999999999.99 then
      raise exception 'The custom casket price is too large.';
    end if;
    computed_amount := round(p_custom_price, 2);
  else
    if p_custom_price is not null then
      raise exception 'A custom price can only be supplied for a custom casket request.';
    end if;
    computed_amount := coalesce(nullif(request_row."productPrice", 0), shop_amount, 0);
  end if;

  if computed_amount <= 0 then
    raise exception 'Configure the casket product price or shop default amount before accepting requests.';
  end if;

  return query
  update public.funeral_service_requests
  set
    status = 'awaiting_payment',
    "productPrice" = case when is_custom_request then computed_amount else request_row."productPrice" end,
    "paymentProvider" = 'xendit',
    "paymentQrUrl" = coalesce(shop_qr, 'xendit://hosted'),
    "paymentAmount" = computed_amount,
    "paymentPayerName" = null,
    "paymentGcashName" = null,
    "paymentGcashNumber" = null,
    "paymentReferenceNumber" = null,
    "paymentProofImageUrl" = null,
    "paymentSubmittedAt" = null,
    "paymentVerifiedAt" = null,
    "paymentRejectionReason" = null,
    "acceptedAt" = now(),
    "shopRespondedAt" = now(),
    "handledByShopId" = (select auth.uid()),
    "updatedAt" = now()
  where id = p_request_id
  returning *;
end;
$$;

revoke all on function public.accept_funeral_service_request(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.accept_funeral_service_request(uuid, numeric)
  to authenticated;

comment on function public.accept_funeral_service_request(uuid, numeric) is
  'Accepts an assigned service request. Custom casket requests require a positive shop-authored price, saved atomically when acceptance opens customer payment.';

notify pgrst, 'reload schema';
