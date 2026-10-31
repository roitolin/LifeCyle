-- Allow shop owners to offer a percentage-based down payment for a product.
-- The percentage is stored on the product so mobile and web use one source of truth.

alter table public.funeral_products
  add column if not exists "downpaymentEnabled" boolean not null default false,
  add column if not exists "downpaymentPercentage" numeric(5, 2);

alter table public.funeral_products
  drop constraint if exists funeral_products_downpayment_percentage_valid;

alter table public.funeral_products
  add constraint funeral_products_downpayment_percentage_valid
  check (
    ("downpaymentEnabled" = false and "downpaymentPercentage" is null)
    or
    (
      "downpaymentEnabled" = true
      and "downpaymentPercentage" > 0
      and "downpaymentPercentage" <= 100
    )
  );

comment on column public.funeral_products."downpaymentEnabled" is
  'Whether the shop accepts a percentage-based down payment for this product.';

comment on column public.funeral_products."downpaymentPercentage" is
  'Percentage of the selected product or variation price required as down payment.';
