alter table public.funeral_product_variations
  add column if not exists price numeric;

alter table public.funeral_product_variations
  drop constraint if exists funeral_product_variations_price_positive;

alter table public.funeral_product_variations
  add constraint funeral_product_variations_price_positive
  check (price is null or price > 0);

alter table public.funeral_shop_packages
  add column if not exists "addOns" jsonb not null default '[]'::jsonb;

alter table public.funeral_shop_packages
  drop constraint if exists funeral_shop_packages_add_ons_is_array;

alter table public.funeral_shop_packages
  add constraint funeral_shop_packages_add_ons_is_array
  check (jsonb_typeof("addOns") = 'array');

alter table public.funeral_service_requests
  add column if not exists "variationId" uuid references public.funeral_product_variations(id) on delete set null,
  add column if not exists "packageAddOns" jsonb not null default '[]'::jsonb;

alter table public.funeral_service_requests
  drop constraint if exists funeral_service_requests_package_add_ons_is_array;

alter table public.funeral_service_requests
  add constraint funeral_service_requests_package_add_ons_is_array
  check (jsonb_typeof("packageAddOns") = 'array');

comment on column public.funeral_product_variations.price is
  'Optional full price for this variation. Null uses the parent product price.';

comment on column public.funeral_shop_packages."addOns" is
  'Optional owner-defined add-ons. Each array entry contains id, name, price, and imageUrl.';

comment on column public.funeral_service_requests."packageAddOns" is
  'Server-validated snapshot of optional package add-ons selected for this request.';

create or replace function public.set_funeral_catalog_request_price()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  base_price numeric;
  variation_price numeric;
  product_shop_id uuid;
  available_add_ons jsonb := '[]'::jsonb;
  selected_add_ons jsonb := coalesce(new."packageAddOns", '[]'::jsonb);
  canonical_add_ons jsonb := '[]'::jsonb;
  add_on_total numeric := 0;
  selected_count integer := 0;
  unique_selected_count integer := 0;
  matched_count integer := 0;
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

  if jsonb_typeof(selected_add_ons) <> 'array' then
    raise exception 'Package add-ons must be an array.';
  end if;

  select coalesce(package."addOns", '[]'::jsonb)
    into available_add_ons
  from public.funeral_shop_packages as package
  where package."shopId" = product_shop_id
    and package.active = true;

  available_add_ons := coalesce(available_add_ons, '[]'::jsonb);

  select count(*), count(distinct selected.item ->> 'id')
    into selected_count, unique_selected_count
  from jsonb_array_elements(selected_add_ons) as selected(item);

  if selected_count <> unique_selected_count then
    raise exception 'Package add-ons contain missing or duplicate identifiers.';
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', available.item ->> 'id',
          'name', available.item ->> 'name',
          'price', round((available.item ->> 'price')::numeric, 2),
          'imageUrl', available.item ->> 'imageUrl'
        )
        order by selected.ordinality
      ),
      '[]'::jsonb
    ),
    coalesce(sum((available.item ->> 'price')::numeric), 0),
    count(*)
    into canonical_add_ons, add_on_total, matched_count
  from jsonb_array_elements(selected_add_ons) with ordinality as selected(item, ordinality)
  join jsonb_array_elements(available_add_ons) as available(item)
    on available.item ->> 'id' = selected.item ->> 'id';

  if matched_count <> selected_count then
    raise exception 'One or more selected package add-ons are unavailable.';
  end if;

  new."packageAddOns" := canonical_add_ons;
  new."productPrice" := round(coalesce(nullif(variation_price, 0), base_price, 0) + add_on_total, 2);

  return new;
end;
$$;

drop trigger if exists set_funeral_catalog_request_price_trigger
  on public.funeral_service_requests;

create trigger set_funeral_catalog_request_price_trigger
before insert or update of "productId", "variationId", "variationName", "packageAddOns"
on public.funeral_service_requests
for each row
execute function public.set_funeral_catalog_request_price();
