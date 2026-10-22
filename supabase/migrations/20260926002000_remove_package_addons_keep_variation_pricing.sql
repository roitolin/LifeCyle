drop trigger if exists set_funeral_catalog_request_price_trigger
  on public.funeral_service_requests;

create or replace function public.set_funeral_catalog_request_price()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  base_price numeric;
  variation_price numeric;
  product_shop_id uuid;
begin
  if new."requestType" is distinct from 'catalog_product' or new."productId" is null then
    return new;
  end if;

  select product.price, product."shopId"
    into base_price, product_shop_id
  from public.funeral_products as product
  where product.id = new."productId";

  if not found then
    raise exception 'Selected funeral product does not exist.';
  end if;

  new."shopId" := product_shop_id;

  if new."variationId" is not null then
    select variation.price, variation.name
      into variation_price, new."variationName"
    from public.funeral_product_variations as variation
    where variation.id = new."variationId"
      and variation."productId" = new."productId";

    if not found then
      raise exception 'Selected product variation is invalid.';
    end if;
  elsif nullif(btrim(coalesce(new."variationName", '')), '') is not null then
    select variation.price, variation.id
      into variation_price, new."variationId"
    from public.funeral_product_variations as variation
    where variation."productId" = new."productId"
      and variation.name = new."variationName"
    order by variation.id
    limit 1;

    if not found then
      raise exception 'Selected product variation is invalid.';
    end if;
  elsif exists (
    select 1
    from public.funeral_product_variations as variation
    where variation."productId" = new."productId"
  ) then
    raise exception 'A product variation must be selected.';
  end if;

  new."productPrice" := round(coalesce(variation_price, base_price, 0), 2);
  return new;
end;
$$;

alter table public.funeral_shop_packages
  drop constraint if exists funeral_shop_packages_add_ons_is_array;

alter table public.funeral_service_requests
  drop constraint if exists funeral_service_requests_package_add_ons_is_array;

alter table public.funeral_shop_packages
  drop column if exists "addOns";

alter table public.funeral_service_requests
  drop column if exists "packageAddOns";

comment on function public.set_funeral_catalog_request_price() is
  'Validates the selected casket variation and stores its authoritative full price. Package inclusions do not change the price.';

create trigger set_funeral_catalog_request_price_trigger
before insert or update of "productId", "variationId", "variationName"
on public.funeral_service_requests
for each row
execute function public.set_funeral_catalog_request_price();
