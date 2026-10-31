-- Store the shop-defined down payment amount and keep its percentage derived
-- from the product's original/base price.

alter table public.funeral_products
  add column if not exists "downpaymentAmount" numeric(12, 2);

update public.funeral_products
set "downpaymentAmount" = round(price * "downpaymentPercentage" / 100, 2)
where "downpaymentEnabled" = true
  and "downpaymentAmount" is null
  and "downpaymentPercentage" is not null
  and price > 0;

-- Legacy zero-priced rows cannot have a valid amount-based down payment.
update public.funeral_products
set
  "downpaymentEnabled" = false,
  "downpaymentAmount" = null,
  "downpaymentPercentage" = null
where "downpaymentEnabled" = true
  and (price <= 0 or coalesce("downpaymentAmount", 0) <= 0);

alter table public.funeral_products
  drop constraint if exists funeral_products_downpayment_percentage_valid;

alter table public.funeral_products
  add constraint funeral_products_downpayment_terms_valid
  check (
    (
      "downpaymentEnabled" = false
      and "downpaymentAmount" is null
      and "downpaymentPercentage" is null
    )
    or
    (
      "downpaymentEnabled" = true
      and price > 0
      and "downpaymentAmount" > 0
      and "downpaymentAmount" <= price
      and "downpaymentPercentage" > 0
      and "downpaymentPercentage" <= 100
      and abs(
        "downpaymentPercentage"
        - round(("downpaymentAmount" * 100) / price, 2)
      ) < 0.01
    )
  );

comment on column public.funeral_products."downpaymentAmount" is
  'Shop-defined down payment amount in Philippine pesos for the product base price.';

comment on column public.funeral_products."downpaymentPercentage" is
  'Percentage automatically derived from downpaymentAmount divided by the product base price.';
