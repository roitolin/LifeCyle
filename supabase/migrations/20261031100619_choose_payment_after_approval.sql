-- Enable the buyer's full/down-payment choice only when an accepted request is
-- actually being paid. The product price stays the full catalog price while
-- paymentAmount stores the amount that Xendit must charge.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop trigger if exists set_funeral_request_payment_terms
  on public.funeral_service_requests;

alter table public.funeral_service_requests
  drop constraint if exists funeral_service_requests_payment_option_valid;

-- Make the seller's current down-payment offer available to approved requests
-- created before this workflow change, provided checkout has not been locked.
update public.funeral_service_requests as request
set
  "downpaymentAmountSnapshot" = round(product."downpaymentAmount", 2),
  "downpaymentPercentageSnapshot" = product."downpaymentPercentage",
  "updatedAt" = now()
from public.funeral_products as product
where request."requestType" = 'catalog_product'
  and request."productId" = product.id::text
  and request."shopId" = product."shopId"
  and request.status in ('pending_shop_acceptance', 'awaiting_payment')
  and request."providerCheckoutId" is null
  and request."providerCheckoutClaimId" is null
  and request."paymentOption" = 'full'
  and request."downpaymentAmountSnapshot" is null
  and request."downpaymentPercentageSnapshot" is null
  and product."downpaymentEnabled" = true
  and product."downpaymentAmount" > 0
  and product."downpaymentPercentage" > 0
  and product."downpaymentPercentage" <= 100
  and product."downpaymentAmount" <= coalesce(request."productFullPrice", request."productPrice");

alter table public.funeral_service_requests
  add constraint funeral_service_requests_payment_option_valid
  check (
    (
      "paymentOption" = 'full'
      and (
        "productFullPrice" is null
        or (
          "productFullPrice" > 0
          and round("productPrice", 2) = "productFullPrice"
          and coalesce("remainingBalance", 0) = 0
        )
      )
    )
    or
    (
      "paymentOption" = 'downpayment'
      and "productFullPrice" > 0
      and "downpaymentAmountSnapshot" > 0
      and "downpaymentAmountSnapshot" <= "productFullPrice"
      and "downpaymentPercentageSnapshot" > 0
      and "downpaymentPercentageSnapshot" <= 100
      -- Keep historical rows valid while all new selections retain full price.
      and "productPrice" in ("productFullPrice", "downpaymentAmountSnapshot")
      and "remainingBalance" = "productFullPrice" - "downpaymentAmountSnapshot"
    )
  );

create or replace function public.set_funeral_request_payment_terms()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  product_row public.funeral_products%rowtype;
  variation_price numeric;
  variation_found boolean := false;
  full_price numeric;
  selecting_after_approval boolean :=
    coalesce(current_setting('lifecycle.payment_selection', true), '') = 'on';
begin
  if tg_op = 'UPDATE' then
    if old."requestType" = 'catalog_product' then
      if selecting_after_approval then
        if old.status <> 'awaiting_payment'
           or old."providerCheckoutId" is not null
           or old."providerCheckoutClaimId" is not null then
          raise exception 'The payment option can no longer be changed.';
        end if;

        full_price := round(coalesce(old."productFullPrice", old."productPrice"), 2);
        if full_price <= 0 then
          raise exception 'The saved product price is invalid.';
        end if;

        new."productPrice" := full_price;
        new."productFullPrice" := full_price;
        if new."paymentOption" = 'downpayment' then
          if old."downpaymentAmountSnapshot" is null
             or old."downpaymentPercentageSnapshot" is null
             or old."downpaymentAmountSnapshot" <= 0
             or old."downpaymentAmountSnapshot" > full_price then
            raise exception 'Down payment is not available for this request.';
          end if;
          new."downpaymentAmountSnapshot" := old."downpaymentAmountSnapshot";
          new."downpaymentPercentageSnapshot" := old."downpaymentPercentageSnapshot";
          new."remainingBalance" := full_price - old."downpaymentAmountSnapshot";
          new."paymentAmount" := old."downpaymentAmountSnapshot";
        elsif new."paymentOption" = 'full' then
          new."downpaymentAmountSnapshot" := old."downpaymentAmountSnapshot";
          new."downpaymentPercentageSnapshot" := old."downpaymentPercentageSnapshot";
          new."remainingBalance" := 0;
          new."paymentAmount" := full_price;
        else
          raise exception 'Choose either full payment or down payment.';
        end if;
        return new;
      end if;

      if old."productId" is distinct from new."productId"
         or old."shopId" is distinct from new."shopId"
         or old."variationId" is distinct from new."variationId"
         or old."paymentOption" is distinct from new."paymentOption"
         or old."productPrice" is distinct from new."productPrice"
         or old."productFullPrice" is distinct from new."productFullPrice"
         or old."downpaymentAmountSnapshot" is distinct from new."downpaymentAmountSnapshot"
         or old."downpaymentPercentageSnapshot" is distinct from new."downpaymentPercentageSnapshot"
         or old."remainingBalance" is distinct from new."remainingBalance" then
        raise exception 'Catalog payment terms can only be selected before checkout.';
      end if;
    end if;
    return new;
  end if;

  if new."requestType" is distinct from 'catalog_product'
     or new."productId" is null
     or new."productId" = 'custom_casket_design' then
    new."paymentOption" := 'full';
    new."productFullPrice" := case when new."productPrice" > 0 then round(new."productPrice", 2) else null end;
    new."downpaymentAmountSnapshot" := null;
    new."downpaymentPercentageSnapshot" := null;
    new."remainingBalance" := case when new."productPrice" > 0 then 0 else null end;
    return new;
  end if;

  select *
  into product_row
  from public.funeral_products
  where id::text = new."productId"
    and "shopId" = new."shopId"
    and active = true;

  if not found then
    raise exception 'The selected product is unavailable.';
  end if;

  if new."variationId" is not null then
    select price, true
    into variation_price, variation_found
    from public.funeral_product_variations
    where id = new."variationId"
      and "productId" = product_row.id;
    if not variation_found then
      raise exception 'The selected product variation is unavailable.';
    end if;
  end if;

  full_price := round(coalesce(variation_price, product_row.price), 2);
  if full_price <= 0 then
    raise exception 'The selected product price is invalid.';
  end if;

  -- No payment choice is accepted from the service-request form. Start at the
  -- full amount and preserve any down-payment offer for the later Pay Now step.
  new."paymentOption" := 'full';
  new."productPrice" := full_price;
  new."productFullPrice" := full_price;
  new."remainingBalance" := 0;
  if product_row."downpaymentEnabled"
     and product_row."downpaymentAmount" > 0
     and product_row."downpaymentAmount" <= full_price
     and product_row."downpaymentPercentage" > 0
     and product_row."downpaymentPercentage" <= 100 then
    new."downpaymentAmountSnapshot" := round(product_row."downpaymentAmount", 2);
    new."downpaymentPercentageSnapshot" := product_row."downpaymentPercentage";
  else
    new."downpaymentAmountSnapshot" := null;
    new."downpaymentPercentageSnapshot" := null;
  end if;
  return new;
end;
$$;

create trigger set_funeral_request_payment_terms
before insert or update of
  "productId",
  "shopId",
  "variationId",
  "paymentOption",
  "productPrice",
  "productFullPrice",
  "downpaymentAmountSnapshot",
  "downpaymentPercentageSnapshot",
  "remainingBalance"
on public.funeral_service_requests
for each row execute function public.set_funeral_request_payment_terms();

revoke all on function public.set_funeral_request_payment_terms()
  from public, anon, authenticated;

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
  select *
  into request_row
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
  if request_row."providerCheckoutId" is not null
     or request_row."providerCheckoutClaimId" is not null then
    raise exception 'The payment option is locked because checkout has already started.';
  end if;
  if p_payment_option is null or p_payment_option not in ('full', 'downpayment') then
    raise exception 'Choose either full payment or down payment.';
  end if;
  if request_row."requestType" is distinct from 'catalog_product'
     and p_payment_option <> 'full' then
    raise exception 'Down payment is not available for this custom request.';
  end if;

  perform set_config('lifecycle.payment_selection', 'on', true);
  return query
  update public.funeral_service_requests
  set
    "paymentOption" = p_payment_option,
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
  'Lets the requesting customer choose full or configured down payment after shop approval and before Xendit checkout is claimed.';
comment on column public.funeral_service_requests."productPrice" is
  'Full catalog price. The post-approval amount charged is stored in paymentAmount.';
comment on column public.funeral_service_requests."downpaymentAmountSnapshot" is
  'Seller-configured down-payment offer captured when the service request is created.';

-- Permit the approved requester to update the charge amount only inside the
-- payment-option RPC above. All provider checkout and payment state remains
-- protected from client-side edits as before.
create or replace function public.protect_xendit_service_payment_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_is_service_role boolean :=
    coalesce(auth.role(), '') = 'service_role'
    or (coalesce(auth.role(), '') = '' and session_user in ('postgres', 'supabase_admin'));
  authorized_payment_selection boolean := false;
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

  authorized_payment_selection :=
    coalesce(current_setting('lifecycle.payment_selection', true), '') = 'on'
    and old.status = 'awaiting_payment'
    and new.status = 'awaiting_payment'
    and old."requesterId" = auth.uid()
    and old."providerCheckoutId" is null
    and old."providerCheckoutClaimId" is null;

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
       or (old."paymentAmount" is distinct from new."paymentAmount" and not authorized_payment_selection)
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

-- An accepted full-price quote must not override the buyer's chosen initial
-- down payment when the payment service claims a new checkout.
do $migration$
declare
  definition text := pg_get_functiondef(
    'public.claim_xendit_service_checkout(uuid,text,text,boolean)'::regprocedure
  );
  original text := $original$authoritative_amount := coalesce(
      authoritative_amount,
      nullif(round(request_row."paymentAmount", 2), 0),
      nullif(round(request_row."productPrice", 2), 0)
    );$original$;
  replacement text := $replacement$authoritative_amount := coalesce(
      case when request_row."requestType" = 'catalog_product'
             and request_row."paymentOption" = 'downpayment'
        then nullif(round(request_row."downpaymentAmountSnapshot", 2), 0)
      end,
      authoritative_amount,
      nullif(round(request_row."paymentAmount", 2), 0),
      nullif(round(request_row."productPrice", 2), 0)
    );$replacement$;
begin
  if position(original in definition) = 0 then
    raise exception 'The Xendit claim function differs from the reviewed version; migration cancelled.';
  end if;
  execute replace(definition, original, replacement);
end;
$migration$;

notify pgrst, 'reload schema';

commit;
