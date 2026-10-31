-- Let a buyer choose the full product price or the seller-configured down
-- payment. Financial values are snapshotted server-side from the live product
-- so clients cannot submit an arbitrary lower amount.

alter table public.funeral_service_requests
  add column if not exists "paymentOption" text not null default 'full',
  add column if not exists "productFullPrice" numeric(12, 2),
  add column if not exists "downpaymentAmountSnapshot" numeric(12, 2),
  add column if not exists "downpaymentPercentageSnapshot" numeric(5, 2),
  add column if not exists "remainingBalance" numeric(12, 2);

update public.funeral_service_requests
set
  "paymentOption" = 'full',
  "productFullPrice" = case when "productPrice" > 0 then round("productPrice", 2) else null end,
  "downpaymentAmountSnapshot" = null,
  "downpaymentPercentageSnapshot" = null,
  "remainingBalance" = case when "productPrice" > 0 then 0 else null end
where "paymentOption" = 'full';

alter table public.funeral_service_requests
  drop constraint if exists funeral_service_requests_payment_option_valid;

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
          and "downpaymentAmountSnapshot" is null
          and "downpaymentPercentageSnapshot" is null
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
      and "productPrice" = "downpaymentAmountSnapshot"
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
begin
  if tg_op = 'UPDATE' then
    if old."requestType" = 'catalog_product'
       and (
         old."productId" is distinct from new."productId"
         or old."shopId" is distinct from new."shopId"
         or old."variationId" is distinct from new."variationId"
         or old."paymentOption" is distinct from new."paymentOption"
         or old."productPrice" is distinct from new."productPrice"
         or old."productFullPrice" is distinct from new."productFullPrice"
         or old."downpaymentAmountSnapshot" is distinct from new."downpaymentAmountSnapshot"
         or old."downpaymentPercentageSnapshot" is distinct from new."downpaymentPercentageSnapshot"
         or old."remainingBalance" is distinct from new."remainingBalance"
       ) then
      raise exception 'Catalog payment terms cannot be changed after the request is created.';
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

  new."productFullPrice" := full_price;

  if new."paymentOption" = 'downpayment' then
    if not product_row."downpaymentEnabled"
       or product_row."downpaymentAmount" is null
       or product_row."downpaymentPercentage" is null
       or product_row."downpaymentAmount" <= 0
       or product_row."downpaymentAmount" > full_price then
      raise exception 'Down payment is not available for the selected product option.';
    end if;

    new."productPrice" := round(product_row."downpaymentAmount", 2);
    new."downpaymentAmountSnapshot" := round(product_row."downpaymentAmount", 2);
    new."downpaymentPercentageSnapshot" := product_row."downpaymentPercentage";
    new."remainingBalance" := full_price - round(product_row."downpaymentAmount", 2);
  elsif new."paymentOption" = 'full' then
    new."productPrice" := full_price;
    new."downpaymentAmountSnapshot" := null;
    new."downpaymentPercentageSnapshot" := null;
    new."remainingBalance" := 0;
  else
    raise exception 'Choose either full payment or down payment.';
  end if;

  return new;
end;
$$;

drop trigger if exists set_funeral_request_payment_terms
  on public.funeral_service_requests;
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

comment on column public.funeral_service_requests."paymentOption" is
  'Buyer choice: full or downpayment.';
comment on column public.funeral_service_requests."productFullPrice" is
  'Server-verified full product or variation price when the request was created.';
comment on column public.funeral_service_requests."remainingBalance" is
  'Full price less the selected initial down payment. Zero for full payment.';

notify pgrst, 'reload schema';
